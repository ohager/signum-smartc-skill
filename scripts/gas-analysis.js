#!/usr/bin/env bun
/**
 * SmartC Gas Analysis (per-handler execution cost)
 * ------------------------------------------------
 * Compiles a .smart.c contract and reports the MIN and MAX instruction count —
 * hence MIN/MAX execution cost in SIGNA (0.001 SIGNA per instruction) — for
 * every handler, plus a per-method table mapping each dispatched method code to
 * its full per-invocation cost.
 *
 * Scope (by design):
 *   - There is no multi-tx activation: each transaction is its own single run
 *     through the getNextTx() loop and carries its own activationAmount, so the
 *     outer loop is never multiplied and cost is charged per invocation (one tx).
 *   - main()'s post-loop effects (trailing statements after the while loop) run
 *     once per activation and are reported as a separate Post-loop cost; the
 *     worst-case activation is `worst single-tx handler + post-loop`.
 *   - Data-dependent inner loops are bounded: MAX assumes each runs at most N
 *     iterations (default 10). MIN is the shortest path.
 *   - Subroutine calls (JSR) are inlined; recursion / sleep are flagged.
 *
 * Core logic lives in ../lib/gas/analyzer.js (I/O-free, unit-tested).
 *
 * Usage:
 *   bun gas-analysis.js <contract.smart.c> [--loop-cap N] [--json] [--help]
 */

import { analyzeContract, SIGNA_PER_STEP, DEFAULT_LOOP_CAP } from '../lib/gas/analyzer.js';

// ─── Argument parsing ────────────────────────────────────────────────────────

const args = Bun.argv.slice(2);
const flags = {
    json: args.includes('--json'),
    help: args.includes('--help') || args.includes('-h'),
};
const capArg = args.indexOf('--loop-cap');
const loopCap = capArg >= 0 ? Math.max(1, parseInt(args[capArg + 1], 10) || DEFAULT_LOOP_CAP) : DEFAULT_LOOP_CAP;
const sourceFile = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '--loop-cap');

if (flags.help || !sourceFile) {
    console.log(`
SmartC Gas Analysis — per-handler MIN/MAX execution cost (Bun)
Usage: bun gas-analysis.js <contract.smart.c> [--loop-cap N] [--json]

Reports, for every handler, the minimum and maximum number of executed AT steps
on any path and the resulting cost in SIGNA (${SIGNA_PER_STEP} SIGNA per step; ordinary
opcodes = 1 step, API calls = 10 steps), plus a per-method table (dispatch +
handler = full per-invocation cost).

Options:
  --loop-cap N   Assume each data-dependent inner loop runs at most N times
                 (default ${DEFAULT_LOOP_CAP}). The outer getNextTx() loop is never multiplied
                 (each tx is its own single run); main()'s post-loop effects are
                 reported separately.
  --json         Write full results to <contract>.gas.json
`);
    process.exit(0);
}

const file = Bun.file(sourceFile);
if (!(await file.exists())) {
    console.error(`Error: File not found: ${sourceFile}`);
    process.exit(1);
}

const contractName = sourceFile.replace(/\.[^.]+$/, '').replace(/.*\//, '');

let result;
try {
    result = analyzeContract(await file.text(), { loopCap });
} catch (err) {
    console.error(`Compile error: ${err.message ?? String(err)}`);
    process.exit(1);
}

// ─── Report ─────────────────────────────────────────────────────────────────

const fmt = (n) => n.toFixed(4).padStart(9);

console.log(`\n╔══════════════════════════════════════════════════════╗`);
console.log(`║  Gas analysis — ${contractName.padEnd(37)}║`);
console.log(`╚══════════════════════════════════════════════════════╝\n`);
console.log(`  Total AT instructions: ${result.totalInstructions}   (loop cap N=${loopCap}, ${SIGNA_PER_STEP} SIGNA/step; API call = 10 steps)\n`);

const rowFlag = (r) => r.capHit ? ' ⚠loop-cap' : r.variableApi ? ' ⚠asset-op' : r.suspend ? ' ⚠sleep' : '';
const one = (r) => (r.oneRunSigna ?? r.minSigna); // single-pass estimate (loops ×1)

if (result.methods.length > 0) {
    console.log('  Per method — SIGNA per invocation (per-tx preamble + dispatch + handler)');
    console.log('  Code  Handler                 Min     1×loop        Max');
    console.log('  ────  ───────────────────  ───────   ───────   ────────');
    for (const m of result.methods) {
        const code = (m.code ?? '?').toString().padStart(4);
        const handler = (m.handler ?? '(inline)').padEnd(19);
        console.log(
            `  ${code}  ${handler}  ${fmt(m.minSigna)}  ${fmt(one(m))}  ${fmt(m.maxSigna)}${rowFlag(m)}`
        );
    }
    console.log('');
}

if (result.handlers.length > 0) {
    console.log('  Handler bodies — SIGNA (function only, sub-calls inlined)');
    console.log('  Handler                     Min     1×loop        Max');
    console.log('  ───────────────────────  ───────   ───────   ────────');
    for (const h of result.handlers) {
        console.log(
            `  ${h.name.padEnd(21)}  ${fmt(h.minSigna)}  ${fmt(one(h))}  ${fmt(h.maxSigna)}${rowFlag(h)}`
        );
    }
    console.log('');
} else if (result.methods.length === 0) {
    console.log('  No handler functions (__fn_*) or switch dispatch found — logic may be inline in main().\n');
}

if (result.postLoop) {
    const p = result.postLoop;
    console.log('  Post-loop — SIGNA (runs once per activation, after the tx loop drains)');
    console.log('  effects/publish            Min     1×loop        Max');
    console.log('  ───────────────────────  ───────   ───────   ────────');
    console.log(`  ${'(trailing effects)'.padEnd(21)}  ${fmt(p.minSigna)}  ${fmt(one(p))}  ${fmt(p.maxSigna)}${rowFlag(p)}`);
    console.log('');
}

console.log('─── How to read these numbers ────────────────────────');
console.log('  These are STATIC ESTIMATES from the compiled assembly, not measured');
console.log('  runs — treat them as guidance and validate against the testbed.');
console.log(`  • Min    — shortest path; data-dependent loops skipped (0 iterations).`);
console.log(`  • 1×loop — each data-dependent loop runs once; closest to a typical run`);
console.log(`             and to empirical/TDD figures.`);
console.log(`  • Max    — every such loop runs the full --loop-cap (=${loopCap}) times on the`);
console.log(`             most expensive branch. A conservative UPPER BOUND, usually well`);
console.log(`             above real cost — API-heavy loops are charged a flat 10 steps`);
console.log(`             per call × ${loopCap}, so Max overstates loops that really run fewer times.`);
console.log('');

const allRows = [...result.methods, ...result.handlers, ...(result.postLoop ? [result.postLoop] : [])];
const warns = [];
if (result.recursionDetected) warns.push('Recursion detected — recursive calls counted as 0; MAX is a lower bound.');
if (allRows.some((r) => r.capHit)) warns.push(`Loop-cap reached — MAX assumes ≤ ${loopCap} iterations; raise --loop-cap if a loop can run longer.`);
if (allRows.some((r) => r.variableApi)) warns.push('Asset issue/mint/distribute on a path — real cost exceeds the 10-step API floor and is partly data-dependent; MAX is a lower bound.');
if (allRows.some((r) => r.suspend)) warns.push('sleep/stop inside a handler — cost shown is for one activation only.');
if (warns.length) {
    console.log('─── Warnings ─────────────────────────────────────────');
    warns.forEach((w) => console.log(`  ⚠️  ${w}`));
    console.log('');
}

const costed = result.methods.length ? result.methods : result.handlers;
if (costed.length) {
    const worst = costed.reduce((a, b) => (b.maxSigna > a.maxSigna ? b : a));
    const worstName = worst.handler ?? worst.name ?? `code ${worst.code}`;
    const postMax = result.postLoop ? result.postLoop.maxSigna : 0;
    const postOne = result.postLoop ? (result.postLoop.oneRunSigna ?? result.postLoop.minSigna) : 0;
    const worstOne = worst.oneRunSigna ?? worst.minSigna;
    const perActMax = +(worst.maxSigna + postMax).toFixed(4);
    const perActOne = +(worstOne + postOne).toFixed(4);
    const HIGH = 5, CEILING = 100;
    console.log('─── Activation guidance ──────────────────────────────');
    console.log(`  Each incoming tx is its own single run through the tx loop and carries its`);
    console.log(`  own activation amount — costs are NEVER summed across transactions.`);
    console.log(`  Worst path: ${worstName}${result.postLoop ? ' + post-loop' : ''}`);
    console.log(`    typical (1×loop):  ${perActOne} SIGNA`);
    console.log(`    upper bound (Max): ${perActMax} SIGNA`);
    console.log(`  → Size activationAmount off the upper bound: ~${+(perActMax * 1.2).toFixed(4)} SIGNA`);
    console.log(`    (${perActMax} × 1.2 margin), plus the getNextTx header. If real loop counts are`);
    console.log(`    known to stay low, the true cost is nearer the ${perActOne} SIGNA typical figure.`);
    if (perActMax > CEILING) {
        console.log('');
        console.log(`  ⚠️  Max ${perActMax} SIGNA exceeds the ${CEILING} SIGNA / 100,000-step hard ceiling`);
        console.log(`      per activation — if a run actually hits it the AT VM stops mid-execution.`);
        console.log(`      Confirm real loop bounds; reduce work per activation or defer via sleep.`);
    } else if (perActMax > HIGH) {
        console.log('');
        console.log(`  ⚠️  ${perActMax} SIGNA (upper bound) is high for a single activation — most`);
        console.log(`      contracts sit well under ${HIGH} SIGNA. This is likely the --loop-cap`);
        console.log(`      worst case; verify against testbed runs before committing to it.`);
    }
    console.log('');
}

if (flags.json) {
    const outputPath = `${contractName}.gas.json`;
    await Bun.write(outputPath, JSON.stringify({ source: sourceFile, signaPerStep: SIGNA_PER_STEP, ...result }, null, 2));
    console.log(`JSON output written to: ${outputPath}`);
}
