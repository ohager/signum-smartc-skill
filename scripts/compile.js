#!/usr/bin/env bun
/**
 * SmartC Compile Script
 * ---------------------
 * Compiles a .smart.c file using smartc-signum-compiler (npm package).
 *
 * Usage:
 *   bun compile.js <contract.smart.c> [--verbose] [--json]
 *
 * Output:
 *   - Assembly code (human-readable AT assembly)
 *   - Machine code (hex string for deployment)
 *   - Deployment summary (data pages, code pages, activation amount)
 *   - Analysis warnings
 *
 * Prerequisites:
 *   bun add smartc-signum-compiler
 */

import { SmartC } from 'smartc-signum-compiler';

// ─── Argument parsing ────────────────────────────────────────────────────────

const args = Bun.argv.slice(2);
const flags = {
    verbose: args.includes('--verbose') || args.includes('-v'),
    json:    args.includes('--json'),
    help:    args.includes('--help') || args.includes('-h'),
};
const sourceFile = args.find(a => !a.startsWith('-'));

if (flags.help || !sourceFile) {
    console.log(`
SmartC Compile Script (Bun)
Usage: bun compile.js <contract.smart.c> [--verbose] [--json]

Options:
  --verbose   Print full AT assembly output
  --json      Write machine code + metadata to <contract>.compiled.json
  --help      Show this help
`);
    process.exit(0);
}

const file = Bun.file(sourceFile);
if (!(await file.exists())) {
    console.error(`Error: File not found: ${sourceFile}`);
    process.exit(1);
}

const sourceCode = await file.text();
const contractName = sourceFile.replace(/\.[^.]+$/, '').replace(/.*\//, '');

console.log(`\n╔══════════════════════════════════════════════════════╗`);
console.log(`║  SmartC Compiler — ${contractName.padEnd(32)}║`);
console.log(`╚══════════════════════════════════════════════════════╝\n`);

let compiler;
try {
    compiler = new SmartC({ language: 'C', sourceCode });
    compiler.compile();
} catch (err) {
    console.error('─── Compilation FAILED ──────────────────────────────');
    console.error(err.message ?? err);
    process.exit(1);
}

// ─── Extract results ─────────────────────────────────────────────────────────

const assemblyCode  = compiler.getAssemblyCode();
const machineObject = compiler.getMachineCode();

// ─── Assembly output ─────────────────────────────────────────────────────────

if (flags.verbose) {
    console.log('─── AT Assembly ──────────────────────────────────────');
    console.log(assemblyCode);
    console.log('──────────────────────────────────────────────────────\n');
}

// ─── Machine code / deployment summary ───────────────────────────────────────

const {
    ByteCode,
    ByteData,
    DataPages,
    CodeStackPages,
    UserStackPages,
    CodePages,
    PActivationAmount,
    MachineCodeHashId,
    MinimumFeeNQT,
    PName,
    PDescription,
    Warnings: compilerWarnings,
} = machineObject;

const codeHex   = ByteCode ?? '';
const codeBytes = codeHex.length / 2;

// PActivationAmount is a string. SmartC stores it in NQT (1 Signa = 1e8 NQT)
// regardless of whether the source wrote `0.5` or `50000000`.
const activationSigna = PActivationAmount
    ? (Number(PActivationAmount) / 1e8).toFixed(4) + ' Signa'
    : 'not set';

console.log('─── Deployment Summary ───────────────────────────────');
console.log(`  Name            : ${PName || '(none)'}`);
console.log(`  Description     : ${PDescription ? PDescription.slice(0, 60) : '(none)'}`);
console.log(`  Activation Amt  : ${activationSigna}`);
console.log(`  Machine Hash ID : ${MachineCodeHashId || '(not computed)'}`);
console.log(`  Min. Deploy Fee : ${MinimumFeeNQT ? (Number(MinimumFeeNQT) / 1e8).toFixed(4) + ' Signa' : '(unknown)'}`);
console.log('');
console.log('  Pages:');
console.log(`    Data          : ${DataPages}`);
console.log(`    Code          : ${CodePages}`);
console.log(`    Code Stack    : ${CodeStackPages}`);
console.log(`    User Stack    : ${UserStackPages}`);
console.log('');
console.log(`  Code size       : ${codeBytes} / 10240 bytes  (${((codeBytes / 10240) * 100).toFixed(1)}% of max)`);
console.log('');
console.log('  Note: per-activation gas cost = AT instruction count × 0.001 Signa.');
console.log('        Compile with #pragma verboseAssembly to count instructions');
console.log('        on your worst-case execution path.');
console.log('');
console.log('─── Machine Code (hex) ───────────────────────────────');
for (let i = 0; i < codeHex.length; i += 64) {
    console.log('  ' + codeHex.slice(i, i + 64));
}
console.log('');

if (ByteData?.length > 0) {
    console.log('─── Initial Data (hex) ───────────────────────────────');
    for (let i = 0; i < ByteData.length; i += 64) {
        console.log('  ' + ByteData.slice(i, i + 64));
    }
    console.log('');
}

// ─── JSON output ─────────────────────────────────────────────────────────────

if (flags.json) {
    const outputPath = `${contractName}.compiled.json`;
    await Bun.write(outputPath, JSON.stringify({
        PName,
        PDescription,
        PActivationAmount,
        MachineCodeHashId,
        MinimumFeeNQT,
        DataPages,
        CodePages,
        CodeStackPages,
        UserStackPages,
        ByteCode,
        ByteData,
        // Back-compat alias so decompile.js's --json input keeps working
        MachineCode: ByteCode,
        ...(flags.verbose ? { assembly: assemblyCode } : {}),
    }, null, 2));
    console.log(`JSON output written to: ${outputPath}`);
}

console.log('─── ✓ Compilation successful ─────────────────────────\n');

// ─── Analysis hints ───────────────────────────────────────────────────────────

const warnings = [];

if (!PActivationAmount || PActivationAmount === '0') {
    warnings.push('⚠️  activationAmount not set — contract will be unactivatable');
}
if (!PName) {
    warnings.push('⚠️  #program name not set — contract will show as unnamed on explorer');
}
if (!assemblyCode.includes('getNextTx') && !assemblyCode.includes('GET_NEXT_TX')) {
    warnings.push('⚠️  No getNextTx() detected — contract may not process incoming transactions');
}
if (codeBytes > 10240) {
    warnings.push(`✗  Code size ${codeBytes} bytes EXCEEDS max 10240 — contract cannot be deployed`);
}
if (DataPages > 4) {
    warnings.push(`ℹ️  DataPages=${DataPages} — large state footprint; review variable necessity`);
}
if (!assemblyCode.includes('verboseAssembly') && flags.verbose) {
    warnings.push('ℹ️  Add #pragma verboseAssembly to the source to annotate assembly with line numbers');
}
if (compilerWarnings && compilerWarnings.trim().length > 0) {
    warnings.push(`ℹ️  Compiler warnings: ${compilerWarnings.trim()}`);
}

if (warnings.length > 0) {
    console.log('─── Analysis Warnings ────────────────────────────────');
    warnings.forEach(w => console.log('  ' + w));
    console.log('');
}
