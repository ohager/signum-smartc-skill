/**
 * SmartC gas analyzer — core (I/O-free, unit-testable).
 * ----------------------------------------------------
 * Parses CIYAM AT assembly (as emitted by `SmartC.getAssemblyCode()`) into a
 * control-flow graph and computes, per handler, the MIN and MAX number of
 * executed instructions — hence the MIN/MAX cost in SIGNA (0.001 SIGNA per
 * instruction).
 *
 * Scope decisions (see scripts/gas-analysis.js for rationale):
 *   - No multi-tx activation: each tx is its own single run through the
 *     getNextTx() loop, so the tx-loop back-edge is treated as an activation
 *     exit and never multiplied. main()'s post-loop effects (after the loop)
 *     run once per activation and are reported as a separate `postLoop` cost.
 *   - Data-dependent inner loops are bounded to `loopCap` iterations for MAX;
 *     a recursion-depth guard keeps a huge cap from overflowing the stack.
 *   - MIN is the shortest path; loops never help it.
 *   - JSR subroutine calls are inlined; recursion is detected and flagged.
 */

import { SmartC } from 'smartc-signum-compiler';

// Fee model (verified against signum-node src/brs/at/AtMachineProcessor.getNumSteps
// and AtConstants for AT version 3):
//   fee = steps * stepFee,  stepFee = FEE_QUANT_SIP34 / 10 = 100_000 NQT = 0.001 SIGNA.
//   Ordinary opcodes cost 1 step; every EXT_FUN API call (the `FUN` mnemonic)
//   costs apiStepMultiplier = 10 steps. ISSUE_ASSET / DIST_TO_ASSET_HOLDERS cost
//   more and are partly data-dependent — flagged, not modelled exactly.
export const SIGNA_PER_STEP = 0.001;
export const API_STEP_MULTIPLIER = 10;
export const DEFAULT_LOOP_CAP = 10;
const COMPUTE_GUARD = 5_000_000;
// Recursion-depth guard for the maxCost DFS. A large loopCap over nested loops
// makes the longest path (hence the DFS depth) explode; without this the walk
// overflows the JS call stack and the whole analysis throws ("Maximum call
// stack size exceeded"). Hitting it degrades gracefully: the branch is treated
// as blocked and capHit is raised, so MAX becomes a flagged lower bound instead
// of a crash. Kept well under the engine's native frame limit.
const MAX_DFS_DEPTH = 6000;
// getNextTx() compiles to this CIYAM AT API function — the tx-loop anchor.
const GET_NEXT_TX_API = /a_to_tx_after_timestamp/i;

const BRANCH_2WAY = new Set(['BZR', 'BNZ', 'BGT', 'BLT', 'BGE', 'BLE', 'BEQ', 'BNE']);
const SUSPEND = new Set(['STP', 'SLP']);
// API operands whose real step cost exceeds the 10-step floor / is data-dependent.
const VARIABLE_COST_API = /issue_asset|mint_asset|dist.*asset|asset.*holder|dividend/i;

/** Step cost of a single instruction (see fee-model note above). */
function stepCost(ins) {
    return ins.mnemonic === 'FUN' ? API_STEP_MULTIPLIER : 1;
}

/** Does this instruction invoke an asset op whose cost is a lower bound only? */
function isVariableCostApi(ins) {
    return ins.mnemonic === 'FUN' && ins.operands.some((o) => VARIABLE_COST_API.test(o));
}

/** Parse assembly text into instructions + a label→index map. */
function parseAssembly(asm) {
    const raw = [];
    const labels = {};

    for (const line of asm.split('\n')) {
        const t = line.trim();
        if (t.length === 0 || t.startsWith('^')) continue; // blank / directive
        const labelMatch = t.match(/^([\w$]+):$/);
        if (labelMatch) {
            labels[labelMatch[1]] = raw.length;
            continue;
        }
        const parts = t.split(/\s+/);
        const mnemonic = parts[0].toUpperCase();
        const operands = parts.slice(1);
        const targetMatch = t.match(/:([\w$]+)\s*$/);
        const targetLabel = targetMatch ? targetMatch[1] : null;

        let kind = 'normal';
        if (BRANCH_2WAY.has(mnemonic)) kind = 'branch';
        else if (mnemonic === 'JMP') kind = 'jmp';
        else if (mnemonic === 'JSR') kind = 'call';
        else if (mnemonic === 'RET') kind = 'ret';
        else if (mnemonic === 'FIN') kind = 'fin';
        else if (SUSPEND.has(mnemonic)) kind = 'suspend';

        raw.push({ mnemonic, kind, operands, targetLabel });
    }

    const instrs = raw.map((ins) => {
        const targetIdx = ins.targetLabel != null ? labels[ins.targetLabel] ?? null : null;
        // SET @reg #imm — capture the register set and its immediate (for dispatch decoding).
        let setReg = null, setImm = null;
        if (ins.mnemonic === 'SET' && ins.operands.length === 2 && ins.operands[1].startsWith('#')) {
            setReg = ins.operands[0].replace(/^@/, '');
            setImm = BigInt('0x' + ins.operands[1].replace(/^#/, '')).toString();
        }
        return {
            mnemonic: ins.mnemonic,
            kind: ins.kind,
            operands: ins.operands,
            targetLabel: ins.targetLabel,
            target: ins.kind === 'call' ? null : targetIdx,
            callTarget: ins.kind === 'call' ? targetIdx : null,
            setReg,
            setImm,
        };
    });

    return { instrs, labels };
}

/** Build a graph analysis context over parsed instructions. */
function makeGraph(instrs, { loopCap, txLoopExit }) {
    const fnCache = new Map();
    const recursive = new Set();

    /** Successor indices for intra-routine flow (calls handled via inlining). */
    function successors(i) {
        const ins = instrs[i];
        if (!ins) return [];
        switch (ins.kind) {
            case 'ret':
            case 'fin':
            case 'suspend':
                return [];
            case 'jmp':
                return ins.target != null ? [ins.target] : [];
            case 'branch': {
                const out = [];
                if (ins.target != null) out.push(ins.target);
                if (i + 1 < instrs.length) out.push(i + 1);
                return out;
            }
            default:
                return i + 1 < instrs.length ? [i + 1] : [];
        }
    }

    // Edge classification relative to the current node.
    //   'exit'    → tx-loop back-edge: ends this activation (never multiplied)
    //   'loop'    → inner back-edge: capped at loopCap for MAX
    //   'forward' → ordinary edge
    function edgeKind(node, s) {
        if (s <= node) return s <= txLoopExit ? 'exit' : 'loop';
        return 'forward';
    }

    function callCost(target, inProgress, mode) {
        if (target == null) return 0;
        if (inProgress.has(target)) { recursive.add(target); return 0; }
        const key = `${target}:${mode}:${[...inProgress].join(',')}`;
        if (fnCache.has(key)) return fnCache.get(key);
        const next = new Set(inProgress).add(target);
        const value = mode === 'min' ? minCost(target, next) : maxCost(target, next).total;
        fnCache.set(key, value);
        return value;
    }

    /** Shortest path (instructions) from entry to any terminator / tx-loop exit. */
    function minCost(entry, inProgress) {
        const dist = new Map();
        const pq = [[0, entry]];
        let best = Infinity;
        while (pq.length) {
            pq.sort((a, b) => a[0] - b[0]);
            const [cost, node] = pq.shift();
            if (cost >= (dist.get(node) ?? Infinity)) continue;
            dist.set(node, cost);
            const ins = instrs[node];
            let w = stepCost(ins);
            if (ins.kind === 'call') w += callCost(ins.callTarget, inProgress, 'min');
            const succ = successors(node);
            const hasExit = succ.some((s) => edgeKind(node, s) === 'exit');
            const forward = succ.filter((s) => edgeKind(node, s) !== 'exit');
            if (succ.length === 0 || hasExit) best = Math.min(best, cost + w);
            for (const s of forward) pq.push([cost + w, s]);
        }
        return best === Infinity ? 0 : best;
    }

    /** Longest path with each inner back-edge taken at most `loopCap` times. */
    function maxCost(entry, inProgress) {
        const backUse = new Map();
        let expansions = 0;
        let capHit = false;

        function dfs(node, depth) {
            if (++expansions > COMPUTE_GUARD) { capHit = true; return 0; }
            // Bound recursion depth: a large loopCap over nested loops makes the
            // longest path deep enough to overflow the JS stack. Treat an
            // over-deep branch as blocked and flag it, rather than throwing.
            if (depth > MAX_DFS_DEPTH) { capHit = true; return 0; }
            const ins = instrs[node];
            let w = stepCost(ins);
            if (ins.kind === 'call') w += callCost(ins.callTarget, inProgress, 'max');

            const succ = successors(node);
            if (succ.length === 0) return w; // genuine terminator

            let best = -Infinity;
            for (const s of succ) {
                const ek = edgeKind(node, s);
                if (ek === 'exit') { best = Math.max(best, 0); continue; } // activation ends here
                if (ek === 'loop') {
                    const key = `${node}->${s}`;
                    const used = backUse.get(key) ?? 0;
                    if (used >= loopCap) { capHit = true; continue; }
                    backUse.set(key, used + 1);
                    best = Math.max(best, dfs(s, depth + 1));
                    backUse.set(key, used);
                } else {
                    best = Math.max(best, dfs(s, depth + 1));
                }
            }
            if (best === -Infinity) return -Infinity; // all continuations blocked → invalid path
            return w + best;
        }

        const total = dfs(entry, 0);
        return { total: total === -Infinity ? 0 : total, capHit };
    }

    /** Is any instruction satisfying `pred` reachable from `entry` (following calls, not tx-loop exits)? */
    function reaches(entry, pred) {
        const seen = new Set();
        const stack = [entry];
        while (stack.length) {
            const n = stack.pop();
            if (seen.has(n)) continue;
            seen.add(n);
            if (pred(instrs[n])) return true;
            for (const s of successors(n)) if (edgeKind(n, s) !== 'exit') stack.push(s);
            if (instrs[n].kind === 'call' && instrs[n].callTarget != null) stack.push(instrs[n].callTarget);
        }
        return false;
    }

    const hasSuspend = (entry) => reaches(entry, (ins) => ins.kind === 'suspend');
    const hasVariableApi = (entry) => reaches(entry, isVariableCostApi);

    /**
     * Cost (steps) of the path from `entry` that first ARRIVES at `target`,
     * NOT executing `target` itself. Used for dispatch: the steps spent reaching
     * a switch case (per-tx preamble — getSender/readMessage, the migrated &
     * senderIsOwner guards, receiveAssets(), and the compare chain up to this
     * case), before the case body runs. Exit edges are excluded (a case can't be
     * reached by leaving the activation) and calls are inlined, so this captures
     * data-dependent preamble cost (e.g. receiveAssets) that a naive linear walk
     * both missed and diverged on.
     */
    function minCostTo(entry, target, inProgress) {
        const dist = new Map();
        const pq = [[0, entry]];
        while (pq.length) {
            pq.sort((a, b) => a[0] - b[0]);
            const [cost, node] = pq.shift();
            if (node === target) return cost;
            if (cost >= (dist.get(node) ?? Infinity)) continue;
            dist.set(node, cost);
            const ins = instrs[node];
            let w = stepCost(ins);
            if (ins.kind === 'call') w += callCost(ins.callTarget, inProgress, 'min');
            for (const s of successors(node)) {
                if (edgeKind(node, s) === 'exit') continue;
                pq.push([cost + w, s]);
            }
        }
        return Infinity; // target unreachable without leaving the activation
    }

    function maxCostTo(entry, target, inProgress) {
        const backUse = new Map();
        let expansions = 0;
        let capHit = false;

        function dfs(node, depth) {
            if (node === target) return 0; // arrived — target's own cost belongs to the body
            if (++expansions > COMPUTE_GUARD) { capHit = true; return -Infinity; }
            if (depth > MAX_DFS_DEPTH) { capHit = true; return -Infinity; }
            const ins = instrs[node];
            let w = stepCost(ins);
            if (ins.kind === 'call') w += callCost(ins.callTarget, inProgress, 'max');

            let best = -Infinity;
            for (const s of successors(node)) {
                const ek = edgeKind(node, s);
                if (ek === 'exit') continue; // leaving the activation never reaches target
                if (ek === 'loop') {
                    const key = `${node}->${s}`;
                    const used = backUse.get(key) ?? 0;
                    if (used >= loopCap) { capHit = true; continue; }
                    backUse.set(key, used + 1);
                    best = Math.max(best, dfs(s, depth + 1));
                    backUse.set(key, used);
                } else {
                    best = Math.max(best, dfs(s, depth + 1));
                }
            }
            return best === -Infinity ? -Infinity : w + best; // -Infinity → no path to target
        }

        const total = dfs(entry, 0);
        return { total: total === -Infinity ? Infinity : total, capHit };
    }

    return { minCost, maxCost, minCostTo, maxCostTo, hasSuspend, hasVariableApi, recursive };
}

/** Intra-routine successors (no call edges) — used by tx-loop detection. */
function intraSuccessors(instrs, i) {
    const ins = instrs[i];
    if (!ins) return [];
    switch (ins.kind) {
        case 'ret':
        case 'fin':
        case 'suspend':
            return [];
        case 'jmp':
            return ins.target != null ? [ins.target] : [];
        case 'branch': {
            const out = [];
            if (ins.target != null) out.push(ins.target);
            if (i + 1 < instrs.length) out.push(i + 1);
            return out;
        }
        default:
            return i + 1 < instrs.length ? [i + 1] : [];
    }
}

/**
 * Locate the getNextTx() transaction loop and split main() into its three parts:
 *   - loopHead      : the loop-restart point (where getNextTx is re-evaluated)
 *   - bodyEntry     : first instruction of the per-tx body (after the exit guard)
 *   - postLoopEntry : first instruction after the loop drains (runs once per
 *                     activation), or null / == finIdx when there is none
 *
 * Handles both SmartC codegen layouts:
 *   A) bottom-tested, no post-loop code — the exit guard sits just before FIN
 *      (main() whose last statement is the while loop).
 *   B) top-tested with post-loop code between the loop and FIN — main() with
 *      trailing effects (publishProgression, refund, level-up, …). The legacy
 *      "branch immediately before FIN" heuristic silently failed on this layout,
 *      returning 0, which made the analyzer (a) walk dispatch from the top of the
 *      program through all init code, (b) treat the tx loop itself as an inner
 *      loop multiplied by loopCap, and (c) omit the post-loop cost entirely.
 *
 * Detection is layout-agnostic: anchor on the getNextTx API call, take the
 * nearest back-edge target at/above it as the loop head, then find the exit
 * guard as the branch whose two sides split into "loops back" vs "reaches FIN".
 */
function findTxLoop(instrs) {
    const finIdx = instrs.findIndex((ins) => ins.kind === 'fin');
    const legacyBodyEntry = () => {
        const guard = finIdx > 0 ? instrs[finIdx - 1] : null;
        return guard && guard.kind === 'branch' && guard.target != null ? guard.target : 0;
    };
    if (finIdx < 0) return { finIdx: -1, loopHead: 0, bodyEntry: 0, postLoopEntry: null };

    const gntIdx = instrs.findIndex(
        (ins) => ins.mnemonic === 'FUN' && ins.operands.some((o) => GET_NEXT_TX_API.test(o))
    );

    // Loop head = nearest back-edge target at/above the getNextTx call site.
    let loopHead = -1;
    for (let i = 0; i < instrs.length; i++) {
        const ins = instrs[i];
        const t = ins.target;
        if (t == null) continue;
        if ((ins.kind === 'jmp' || ins.kind === 'branch') && t <= i && gntIdx >= 0 && t <= gntIdx && t > loopHead) {
            loopHead = t;
        }
    }
    if (gntIdx < 0 || loopHead < 0) {
        return { finIdx, loopHead: 0, bodyEntry: legacyBodyEntry(), postLoopEntry: null };
    }

    // Forward-only reachability: does a walk from `start` cross a back-edge to
    // the loop head (i.e. is `start` on the per-tx body path)?
    const reachesLoopBack = (start) => {
        const seen = new Set();
        const stack = [start];
        while (stack.length) {
            const n = stack.pop();
            if (seen.has(n)) continue;
            seen.add(n);
            for (const s of intraSuccessors(instrs, n)) {
                if (s <= loopHead) return true; // back-edge to (or above) the loop head
                stack.push(s);
            }
        }
        return false;
    };

    // The exit guard is at/after the loop head and no later than the first
    // back-edge; its two successors split into the body vs the activation exit.
    let firstBack = finIdx;
    for (let i = loopHead; i < finIdx; i++) {
        const ins = instrs[i];
        if ((ins.kind === 'jmp' || ins.kind === 'branch') && ins.target != null && ins.target <= loopHead) {
            firstBack = i;
            break;
        }
    }
    for (let i = loopHead; i <= firstBack && i < instrs.length; i++) {
        const ins = instrs[i];
        if (ins.kind !== 'branch' || ins.target == null) continue;
        const a = ins.target;
        const b = i + 1;
        const ra = reachesLoopBack(a);
        const rb = reachesLoopBack(b);
        if (ra !== rb) {
            const bodyEntry = ra ? a : b;
            const exit = ra ? b : a;
            return { finIdx, loopHead, bodyEntry, postLoopEntry: exit };
        }
    }
    return { finIdx, loopHead, bodyEntry: legacyBodyEntry(), postLoopEntry: null };
}

/**
 * Decode the switch dispatcher: map each method code to its case label and the
 * handler function it calls. Recognises the standard `SET @reg #code; BEQ $msg
 * $reg :__switchN_k` chain.
 */
function decodeDispatch(instrs) {
    const lastSet = new Map(); // reg → immediate (decimal string)
    const methods = [];

    for (let i = 0; i < instrs.length; i++) {
        const ins = instrs[i];
        if (ins.setReg != null) lastSet.set(ins.setReg, ins.setImm);
        if (ins.mnemonic === 'BEQ' && ins.targetLabel && ins.targetLabel.startsWith('__switch')) {
            // Which operand is the const register we just SET?
            const regOperand = ins.operands
                .map((o) => o.replace(/^\$/, ''))
                .find((o) => lastSet.has(o));
            const code = regOperand != null ? lastSet.get(regOperand) : null;
            methods.push({ code, caseIndex: ins.target, dispatchBeq: i });
        }
    }
    return methods;
}

/** Find the handler function name called from a switch case body. */
function handlerForCase(instrs, caseIndex) {
    for (let i = caseIndex; i < instrs.length; i++) {
        const ins = instrs[i];
        if (i > caseIndex && (ins.kind === 'jmp' || ins.kind === 'ret')) break;
        if (ins.kind === 'call' && ins.targetLabel?.startsWith('__fn_')) return ins.targetLabel.replace(/^__fn_/, '');
    }
    return null; // inline case body
}

/**
 * Analyse already-compiled assembly text.
 * @returns {{ totalInstructions:number, loopCap:number, handlers:Array, methods:Array, recursionDetected:boolean }}
 */
export function analyzeAssembly(assembly, { loopCap = DEFAULT_LOOP_CAP } = {}) {
    const { instrs, labels } = parseAssembly(assembly);
    const { finIdx, bodyEntry, postLoopEntry } = findTxLoop(instrs);

    // Two graphs per scope: one at the user's loopCap (conservative MAX upper
    // bound — every data-dependent loop taken `loopCap` times on the worst
    // branch) and one at loopCap 1 (a realistic single-pass estimate — each loop
    // taken exactly once). The 1× figure tracks empirical/TDD runs far better
    // than the capped MAX, which is a worst-case bound, not a measured cost.
    const ONE_PASS = 1;

    // Handler functions (bodies): standalone __fn_* subroutines, cost via RET.
    const fnGraph = makeGraph(instrs, { loopCap, txLoopExit: -1 });
    const fnGraph1 = makeGraph(instrs, { loopCap: ONE_PASS, txLoopExit: -1 });
    const handlers = Object.entries(labels)
        .filter(([label]) => label.startsWith('__fn_'))
        // __fn_main is the dispatcher, not a handler: it contains the tx loop, so
        // a standalone (txLoopExit -1) walk would multiply that loop by loopCap and
        // report a meaningless inflated figure. Its real per-activation cost is the
        // per-method table (preamble+dispatch+handler) plus the post-loop row.
        .filter(([label]) => label !== '__fn_main')
        .map(([label, entry]) => ({ label, name: label.replace(/^__fn_/, ''), entry }))
        .sort((a, b) => a.entry - b.entry)
        .map(({ name, entry }) => {
            const minSteps = fnGraph.minCost(entry, new Set([entry]));
            const { total: maxSteps, capHit } = fnGraph.maxCost(entry, new Set([entry]));
            const { total: oneRunSteps } = fnGraph1.maxCost(entry, new Set([entry]));
            return withCost({
                name, minSteps, oneRunSteps, maxSteps, capHit,
                suspend: fnGraph.hasSuspend(entry),
                variableApi: fnGraph.hasVariableApi(entry),
            });
        });

    // Methods: full per-invocation cost = dispatch selection + case body (handler inlined).
    // Case bodies may JMP back to the tx loop, so treat tx-loop back-edges as exits.
    const caseGraph = makeGraph(instrs, { loopCap, txLoopExit: bodyEntry });
    const caseGraph1 = makeGraph(instrs, { loopCap: ONE_PASS, txLoopExit: bodyEntry });
    const finite = (n, fallback) => (Number.isFinite(n) ? n : fallback);
    const methods = decodeDispatch(instrs, labels)
        .filter((m) => m.caseIndex != null)
        .map((m) => {
            const seed = () => new Set([bodyEntry]);
            const caseSeed = () => new Set([m.caseIndex]);
            // Dispatch = cost to REACH this case from the tx-body entry (per-tx
            // preamble + receiveAssets + compare chain). Min/1×/max because that
            // preamble is itself data-dependent (e.g. receiveAssets).
            const dispatchMin = finite(caseGraph.minCostTo(bodyEntry, m.caseIndex, seed()), 0);
            const dMaxRes = caseGraph.maxCostTo(bodyEntry, m.caseIndex, seed());
            const dispatchMax = finite(dMaxRes.total, dispatchMin);
            const dispatchOne = finite(caseGraph1.maxCostTo(bodyEntry, m.caseIndex, seed()).total, dispatchMin);
            const bodyMin = caseGraph.minCost(m.caseIndex, caseSeed());
            const { total: bodyMax, capHit: bCap } = caseGraph.maxCost(m.caseIndex, caseSeed());
            const bodyOne = caseGraph1.maxCost(m.caseIndex, caseSeed()).total;
            return withCost({
                code: m.code != null ? Number(m.code) : null,
                handler: handlerForCase(instrs, m.caseIndex),
                dispatchMin,
                dispatchMax,
                minSteps: dispatchMin + bodyMin,
                oneRunSteps: dispatchOne + bodyOne,
                maxSteps: dispatchMax + bodyMax,
                capHit: dMaxRes.capHit || bCap,
                suspend: caseGraph.hasSuspend(m.caseIndex),
                variableApi: caseGraph.hasVariableApi(m.caseIndex),
            });
        });

    // Post-loop (per-activation) cost: the code that runs ONCE after the tx loop
    // drains — trailing effects in main() (level-up, refunds, publishing, …).
    // There is no multi-tx activation: each incoming tx is its own single run
    // through the loop carrying its own activation amount, so this cost is added
    // to a SINGLE tx's dispatch+handler when sizing activationAmount — never
    // summed across transactions.
    let postLoop = null;
    if (postLoopEntry != null && postLoopEntry !== finIdx) {
        const seed = () => new Set([postLoopEntry]);
        const minSteps = caseGraph.minCost(postLoopEntry, seed());
        const { total: maxSteps, capHit } = caseGraph.maxCost(postLoopEntry, seed());
        const oneRunSteps = caseGraph1.maxCost(postLoopEntry, seed()).total;
        postLoop = withCost({
            minSteps, oneRunSteps, maxSteps, capHit,
            suspend: caseGraph.hasSuspend(postLoopEntry),
            variableApi: caseGraph.hasVariableApi(postLoopEntry),
        });
    }

    return {
        totalInstructions: instrs.length,
        loopCap,
        handlers,
        methods,
        postLoop,
        recursionDetected: fnGraph.recursive.size > 0 || caseGraph.recursive.size > 0,
    };
}

/** Compile a .smart.c source string and analyse it. */
export function analyzeContract(sourceCode, opts = {}) {
    const c = new SmartC({ language: 'C', sourceCode });
    c.compile();
    return analyzeAssembly(c.getAssemblyCode(), opts);
}

function withCost(row) {
    const out = {
        ...row,
        minSigna: +(row.minSteps * SIGNA_PER_STEP).toFixed(6),
        maxSigna: +(row.maxSteps * SIGNA_PER_STEP).toFixed(6),
    };
    if (row.oneRunSteps != null) out.oneRunSigna = +(row.oneRunSteps * SIGNA_PER_STEP).toFixed(6);
    return out;
}
