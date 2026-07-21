/**
 * SmartC gas analyzer — core (I/O-free, unit-testable).
 * ----------------------------------------------------
 * Parses CIYAM AT assembly (as emitted by `SmartC.getAssemblyCode()`) into a
 * control-flow graph and computes, per handler, the MIN and MAX number of
 * executed instructions — hence the MIN/MAX cost in SIGNA (0.001 SIGNA per
 * instruction).
 *
 * Scope decisions (see scripts/gas-analysis.js for rationale):
 *   - The outer getNextTx() transaction loop is ignored: back-edges that jump
 *     to or before the tx-loop body entry are treated as a normal activation
 *     exit, never multiplied.
 *   - Data-dependent inner loops are bounded to `loopCap` iterations for MAX.
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

        function dfs(node) {
            if (++expansions > COMPUTE_GUARD) { capHit = true; return 0; }
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
                    best = Math.max(best, dfs(s));
                    backUse.set(key, used);
                } else {
                    best = Math.max(best, dfs(s));
                }
            }
            if (best === -Infinity) return -Infinity; // all continuations blocked → invalid path
            return w + best;
        }

        const total = dfs(entry);
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

    return { minCost, maxCost, hasSuspend, hasVariableApi, recursive };
}

/** Locate the tx-loop body entry: the branch target that guards the main FIN. */
function findBodyEntry(instrs) {
    const finIdx = instrs.findIndex((ins) => ins.kind === 'fin');
    if (finIdx > 0) {
        const guard = instrs[finIdx - 1];
        if (guard.kind === 'branch' && guard.target != null) return guard.target;
    }
    return 0;
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

/** Deterministic step count from bodyEntry to entering method `caseIndex`. */
function dispatchCost(instrs, bodyEntry, caseIndex, dispatchBeq) {
    let cur = bodyEntry;
    let count = 0;
    let guard = 0;
    while (cur !== caseIndex && guard++ < instrs.length * 2) {
        const ins = instrs[cur];
        count += stepCost(ins);
        if (cur === dispatchBeq) { cur = ins.target; continue; }      // take our case
        if (ins.mnemonic === 'BEQ' && ins.targetLabel?.startsWith('__switch')) { cur += 1; continue; } // skip other case
        if (ins.kind === 'jmp' && ins.target != null) { cur = ins.target; continue; }
        cur += 1;
    }
    return count;
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
    const bodyEntry = findBodyEntry(instrs);

    // Handler functions (bodies): standalone __fn_* subroutines, cost via RET.
    const fnGraph = makeGraph(instrs, { loopCap, txLoopExit: -1 });
    const handlers = Object.entries(labels)
        .filter(([label]) => label.startsWith('__fn_'))
        .map(([label, entry]) => ({ label, name: label.replace(/^__fn_/, ''), entry }))
        .sort((a, b) => a.entry - b.entry)
        .map(({ name, entry }) => {
            const minSteps = fnGraph.minCost(entry, new Set([entry]));
            const { total: maxSteps, capHit } = fnGraph.maxCost(entry, new Set([entry]));
            return withCost({
                name, minSteps, maxSteps, capHit,
                suspend: fnGraph.hasSuspend(entry),
                variableApi: fnGraph.hasVariableApi(entry),
            });
        });

    // Methods: full per-invocation cost = dispatch selection + case body (handler inlined).
    // Case bodies may JMP back to the tx loop, so treat tx-loop back-edges as exits.
    const caseGraph = makeGraph(instrs, { loopCap, txLoopExit: bodyEntry });
    const methods = decodeDispatch(instrs, labels)
        .filter((m) => m.caseIndex != null)
        .map((m) => {
            const dispatch = dispatchCost(instrs, bodyEntry, m.caseIndex, m.dispatchBeq);
            const bodyMin = caseGraph.minCost(m.caseIndex, new Set([m.caseIndex]));
            const { total: bodyMax, capHit } = caseGraph.maxCost(m.caseIndex, new Set([m.caseIndex]));
            return withCost({
                code: m.code != null ? Number(m.code) : null,
                handler: handlerForCase(instrs, m.caseIndex),
                dispatchSteps: dispatch,
                minSteps: dispatch + bodyMin,
                maxSteps: dispatch + bodyMax,
                capHit,
                suspend: caseGraph.hasSuspend(m.caseIndex),
                variableApi: caseGraph.hasVariableApi(m.caseIndex),
            });
        });

    return {
        totalInstructions: instrs.length,
        loopCap,
        handlers,
        methods,
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
    return {
        ...row,
        minSigna: +(row.minSteps * SIGNA_PER_STEP).toFixed(6),
        maxSigna: +(row.maxSteps * SIGNA_PER_STEP).toFixed(6),
    };
}
