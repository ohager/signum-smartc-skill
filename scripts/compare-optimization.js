#!/usr/bin/env bun
/**
 * SmartC Optimization-Level Comparison
 * ------------------------------------
 * Compiles the same .smart.c source at every optimization level (0..3) and
 * prints a comparison table of code bytes, instruction count, and data pages.
 *
 * Important: optimization levels are NOT monotonic — level 3 can produce
 * LARGER code than level 2 and may even exceed the 10240-byte cap. This
 * script presents the raw table and flags non-monotonic surprises; it does
 * NOT recommend "highest level wins".
 *
 * Usage:
 *   bun compare-optimization.js <contract.smart.c> [--json] [--verbose] [--help]
 *
 * Options:
 *   --json     Write full results to <contract>.optimization.json
 *   --verbose  Print compile errors in full instead of one-liners
 */

import { SmartC } from 'smartc-signum-compiler';

// ─── Argument parsing ────────────────────────────────────────────────────────

const args = Bun.argv.slice(2);
const flags = {
    json:    args.includes('--json'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    help:    args.includes('--help')    || args.includes('-h'),
};
const sourceFile = args.find(a => !a.startsWith('-'));

if (flags.help || !sourceFile) {
    console.log(`
SmartC Optimization-Level Comparison (Bun)
Usage: bun compare-optimization.js <contract.smart.c> [--json] [--verbose]

Compiles the source at optimizationLevel 0/1/2/3 and at level 3 with
globalOptimization, then prints a comparison table.

Note: levels are NOT monotonic. Level 3 sometimes produces larger code
than level 2 and may exceed the 10240-byte deployment cap.
`);
    process.exit(0);
}

const file = Bun.file(sourceFile);
if (!(await file.exists())) {
    console.error(`Error: File not found: ${sourceFile}`);
    process.exit(1);
}

const rawSource = await file.text();
const contractName = sourceFile.replace(/\.[^.]+$/, '').replace(/.*\//, '');

// ─── Detect & strip existing pragmas we control ──────────────────────────────

const ORIG_LEVEL_MATCH = rawSource.match(/^[ \t]*#pragma[ \t]+optimizationLevel[ \t]+(\d+)/m);

const strippedSource = rawSource
    .replace(/^[ \t]*#pragma[ \t]+optimizationLevel\b.*$/gm, '');

console.log(`\n╔══════════════════════════════════════════════════════╗`);
console.log(`║  Optimization compare — ${contractName.padEnd(28)}║`);
console.log(`╚══════════════════════════════════════════════════════╝\n`);

if (ORIG_LEVEL_MATCH) {
    console.log(`  Note: source had #pragma optimizationLevel ${ORIG_LEVEL_MATCH[1]} — overriding for comparison.`);
}
console.log('');

// ─── Run all configurations ──────────────────────────────────────────────────

const CODE_CAP_BYTES = 10240;

function countInstructions(assembly) {
    // AT instructions are non-blank lines that are not directives (^...)
    // and not bare labels (ending in :)
    return assembly.split('\n').filter(line => {
        const t = line.trim();
        if (t.length === 0) return false;
        if (t.startsWith('^')) return false;
        if (t.startsWith('//')) return false;
        if (/^\w+:\s*$/.test(t)) return false;
        return true;
    }).length;
}

function tryCompile(level) {
    const sourceCode = `#pragma optimizationLevel ${level}\n` + strippedSource;

    try {
        const c = new SmartC({ language: 'C', sourceCode });
        c.compile();
        const assembly = c.getAssemblyCode();
        const machine  = c.getMachineCode();
        const codeHex  = machine.ByteCode ?? '';
        const codeBytes = codeHex.length / 2;
        return {
            ok: true,
            level,
            codeBytes,
            instructions: countInstructions(assembly),
            dataPages: machine.DataPages,
            codeStackPages: machine.CodeStackPages,
            userStackPages: machine.UserStackPages,
            codePages: machine.CodePages,
            codeHashId: machine.MachineCodeHashId,
            machineHex: codeHex,
        };
    } catch (err) {
        return {
            ok: false,
            level,
            error: err.message ?? String(err),
        };
    }
}

const cases = [
    tryCompile(0),
    tryCompile(1),
    tryCompile(2),
    tryCompile(3),
];

// ─── Render table ────────────────────────────────────────────────────────────

function caseLabel(c) {
    return `L${c.level}`;
}

const rowsOk = cases.filter(c => c.ok);
const minBytes = rowsOk.length ? Math.min(...rowsOk.map(c => c.codeBytes)) : null;
const minInsns = rowsOk.length ? Math.min(...rowsOk.map(c => c.instructions)) : null;

console.log('─── Results ──────────────────────────────────────────');
console.log('  Config  Bytes    Instr    DataPages  Status');
console.log('  ──────  ───────  ───────  ─────────  ──────');

for (const c of cases) {
    const label = caseLabel(c).padEnd(6);
    if (!c.ok) {
        console.log(`  ${label}  ─        ─        ─          ✗ compile error`);
        continue;
    }
    const bytes = String(c.codeBytes).padStart(7);
    const insn  = String(c.instructions).padStart(7);
    const pages = String(c.dataPages).padStart(9);
    const tags  = [];
    if (c.codeBytes === minBytes && c.instructions === minInsns) tags.push('✓ smallest');
    else if (c.codeBytes === minBytes) tags.push('✓ smallest bytes');
    else if (c.instructions === minInsns) tags.push('✓ fewest instr');
    if (c.codeBytes > CODE_CAP_BYTES) tags.push('✗ EXCEEDS 10240B cap');
    console.log(`  ${label}  ${bytes}  ${insn}  ${pages}  ${tags.join(', ')}`);
}
console.log('');

// ─── Surface non-monotonic surprises ─────────────────────────────────────────

const surprises = [];
for (let i = 0; i < cases.length - 1; i++) {
    const lo = cases[i];
    const hi = cases[i + 1];
    if (!lo.ok || !hi.ok) continue;
    if (hi.codeBytes > lo.codeBytes) {
        surprises.push(`  ⚠️  ${caseLabel(hi)} is +${hi.codeBytes - lo.codeBytes} bytes vs ${caseLabel(lo)} — higher level produced LARGER code.`);
    }
    if (hi.instructions > lo.instructions) {
        surprises.push(`  ⚠️  ${caseLabel(hi)} is +${hi.instructions - lo.instructions} instructions vs ${caseLabel(lo)} — higher level added instructions.`);
    }
}

if (surprises.length > 0) {
    console.log('─── Non-monotonic results ────────────────────────────');
    surprises.forEach(s => console.log(s));
    console.log('  Optimization levels are not strictly monotonic — the smallest deployable result may be at a lower level.');
    console.log('');
}

// ─── Compile errors detail ───────────────────────────────────────────────────

const errored = cases.filter(c => !c.ok);
if (errored.length > 0) {
    console.log('─── Compile errors ───────────────────────────────────');
    for (const c of errored) {
        const msg = flags.verbose ? c.error : (c.error.split('\n')[0]).slice(0, 100);
        console.log(`  ${caseLabel(c)}: ${msg}`);
    }
    console.log('');
}

// ─── Recommendation ──────────────────────────────────────────────────────────

const deployable = rowsOk.filter(c => c.codeBytes <= CODE_CAP_BYTES);
if (deployable.length > 0) {
    const best = deployable.reduce((a, b) =>
        (b.codeBytes < a.codeBytes) ||
        (b.codeBytes === a.codeBytes && b.instructions < a.instructions) ? b : a
    );
    console.log('─── Recommendation ───────────────────────────────────');
    console.log(`  Smallest deployable: ${caseLabel(best)}  (${best.codeBytes} bytes, ${best.instructions} instr)`);
    console.log(`  Set in source:`);
    console.log(`      #pragma optimizationLevel ${best.level}`);
    console.log('');
} else if (rowsOk.length > 0) {
    console.log('─── Recommendation ───────────────────────────────────');
    console.log(`  ✗ No configuration produces deployable code (all exceed ${CODE_CAP_BYTES} bytes).`);
    console.log(`  Reduce contract size before tuning optimization level.`);
    console.log('');
}

// ─── JSON output ─────────────────────────────────────────────────────────────

if (flags.json) {
    const outputPath = `${contractName}.optimization.json`;
    await Bun.write(outputPath, JSON.stringify({
        source: sourceFile,
        originalOptimizationLevel: ORIG_LEVEL_MATCH ? Number(ORIG_LEVEL_MATCH[1]) : null,
        codeCapBytes: CODE_CAP_BYTES,
        cases: cases.map(c => c.ok
            ? { level: c.level, codeBytes: c.codeBytes, instructions: c.instructions, dataPages: c.dataPages, codeHashId: c.codeHashId }
            : { level: c.level, error: c.error }
        ),
    }, null, 2));
    console.log(`JSON output written to: ${outputPath}`);
}
