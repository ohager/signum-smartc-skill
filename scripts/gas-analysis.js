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
 *   - The outer getNextTx() transaction loop is IGNORED. Activation cost is
 *     charged per invocation, and one invocation processes one transaction, so
 *     the meaningful figure is the cost of a single handler pass. The fixed
 *     getNextTx loop-header overhead (a handful of instructions per activation)
 *     sits outside the reported per-method dispatch cost.
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
                 (default ${DEFAULT_LOOP_CAP}). The outer getNextTx() loop is always ignored.
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

if (result.methods.length > 0) {
    console.log('  Per method (dispatch + handler = full per-invocation cost)');
    console.log('  Code  Handler          Dispatch  Min steps  Max steps   Min SIGNA   Max SIGNA');
    console.log('  ────  ───────────────  ────────  ─────────  ─────────   ─────────   ─────────');
    for (const m of result.methods) {
        const code = (m.code ?? '?').toString().padStart(4);
        const handler = (m.handler ?? '(inline)').padEnd(15);
        console.log(
            `  ${code}  ${handler}  ${String(m.dispatchSteps).padStart(8)}  ${String(m.minSteps).padStart(9)}  ${String(m.maxSteps).padStart(9)}` +
            `   ${fmt(m.minSigna)}   ${fmt(m.maxSigna)}${rowFlag(m)}`
        );
    }
    console.log('');
}

if (result.handlers.length > 0) {
    console.log('  Handler bodies (function cost only, sub-calls inlined)');
    console.log('  Handler              Min steps  Max steps   Min SIGNA   Max SIGNA');
    console.log('  ───────────────────  ─────────  ─────────   ─────────   ─────────');
    for (const h of result.handlers) {
        console.log(
            `  ${h.name.padEnd(19)}  ${String(h.minSteps).padStart(9)}  ${String(h.maxSteps).padStart(9)}` +
            `   ${fmt(h.minSigna)}   ${fmt(h.maxSigna)}${rowFlag(h)}`
        );
    }
    console.log('');
} else if (result.methods.length === 0) {
    console.log('  No handler functions (__fn_*) or switch dispatch found — logic may be inline in main().\n');
}

const warns = [];
if (result.recursionDetected) warns.push('Recursion detected — recursive calls counted as 0; MAX is a lower bound.');
if ([...result.methods, ...result.handlers].some((r) => r.capHit)) warns.push(`Loop-cap reached — MAX assumes ≤ ${loopCap} iterations; raise --loop-cap if a loop can run longer.`);
if ([...result.methods, ...result.handlers].some((r) => r.variableApi)) warns.push('Asset issue/mint/distribute on a path — real cost exceeds the 10-step API floor and is partly data-dependent; MAX is a lower bound.');
if ([...result.methods, ...result.handlers].some((r) => r.suspend)) warns.push('sleep/stop inside a handler — cost shown is for one activation only.');
if (warns.length) {
    console.log('─── Warnings ─────────────────────────────────────────');
    warns.forEach((w) => console.log(`  ⚠️  ${w}`));
    console.log('');
}

const costed = result.methods.length ? result.methods : result.handlers;
if (costed.length) {
    const worst = costed.reduce((a, b) => (b.maxSigna > a.maxSigna ? b : a));
    const worstName = worst.handler ?? worst.name ?? `code ${worst.code}`;
    console.log('─── Activation guidance ──────────────────────────────');
    console.log(`  Most expensive path: ${worstName} — up to ${worst.maxSigna} SIGNA per invocation.`);
    console.log(`  activationAmount must cover this worst-case path (plus a safety margin and`);
    console.log(`  the fixed getNextTx loop-header overhead, which is excluded above).`);
    console.log('');
}

if (flags.json) {
    const outputPath = `${contractName}.gas.json`;
    await Bun.write(outputPath, JSON.stringify({ source: sourceFile, signaPerStep: SIGNA_PER_STEP, ...result }, null, 2));
    console.log(`JSON output written to: ${outputPath}`);
}
