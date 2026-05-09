#!/usr/bin/env bun
/**
 * SmartC Decompile Script
 * -----------------------
 * Decompiles AT machine code (hex) back to readable AT assembly using the
 * vendored Signum-D-Or decompiler. Optionally runs the optimizer pass.
 *
 * Usage:
 *   bun decompile.js <hex-file | .compiled.json> [--optimize] [--json] [--verbose]
 *   bun decompile.js --hex <hex-string>          [--optimize] [--json] [--verbose]
 *
 * Output:
 *   - AT assembly (human-readable)
 *   - Optimized assembly + line-count diff (with --optimize)
 *   - JSONmap (variable / label table) with --verbose or --json
 *
 * Vendored library: lib/decompile/{decompiler,optimizer}.js
 * Source:           https://github.com/deleterium/Signum-D-Or (GPL-3.0)
 */

import decompiler from '../lib/decompile/decompiler.js';
import optimizer  from '../lib/decompile/optimizer.js';

// ─── Argument parsing ────────────────────────────────────────────────────────

const args = Bun.argv.slice(2);
const flags = {
    optimize: args.includes('--optimize') || args.includes('-O'),
    verbose:  args.includes('--verbose')  || args.includes('-v'),
    json:     args.includes('--json'),
    help:     args.includes('--help')     || args.includes('-h'),
};

const hexFlagIdx = args.indexOf('--hex');
const hexInline  = hexFlagIdx !== -1 ? args[hexFlagIdx + 1] : null;
const hexValueIdx = hexFlagIdx !== -1 ? hexFlagIdx + 1 : -1;
const inputFile  = args.find((a, i) => !a.startsWith('-') && i !== hexValueIdx);

if (flags.help || (!inputFile && !hexInline)) {
    console.log(`
SmartC Decompile Script (Bun)
Usage:
  bun decompile.js <hex-file | .compiled.json> [options]
  bun decompile.js --hex <hex-string>          [options]

Options:
  --optimize, -O   Run optimizer pass on the decompiled assembly
  --json           Write assembly + JSONmap to <input>.decompiled.json
  --verbose, -v    Print full JSONmap (memory + label tables)
  --help, -h       Show this help

Input formats accepted:
  - Raw hex file (any extension): contents read as hex, 0x prefix and
    whitespace stripped.
  - .compiled.json (from compile.js): MachineCode field is extracted.
  - --hex <string>: hex string passed directly on the command line.
`);
    process.exit(0);
}

// ─── Load hex bytecode ───────────────────────────────────────────────────────

function normalizeHex(raw) {
    const cleaned = raw.replace(/0x/gi, '').replace(/\s+/g, '');
    if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
        throw new Error('Input is not valid hex (after stripping 0x and whitespace).');
    }
    if (cleaned.length % 2 !== 0) {
        throw new Error(`Hex length is odd (${cleaned.length}); expected even number of hex chars.`);
    }
    return cleaned.toLowerCase();
}

let hex;
let inputLabel;

try {
    if (hexInline) {
        hex = normalizeHex(hexInline);
        inputLabel = '<--hex>';
    } else {
        const file = Bun.file(inputFile);
        if (!(await file.exists())) {
            console.error(`Error: File not found: ${inputFile}`);
            process.exit(1);
        }
        const text = await file.text();
        if (inputFile.endsWith('.json')) {
            const parsed = JSON.parse(text);
            if (!parsed.MachineCode) {
                throw new Error(`${inputFile} has no MachineCode field.`);
            }
            hex = normalizeHex(parsed.MachineCode);
        } else {
            hex = normalizeHex(text);
        }
        inputLabel = inputFile;
    }
} catch (err) {
    console.error('─── Input load FAILED ────────────────────────────────');
    console.error(err.message ?? err);
    process.exit(1);
}

const inputName = (inputFile ?? 'inline').replace(/\.[^.]+$/, '').replace(/.*\//, '');

console.log(`\n╔══════════════════════════════════════════════════════╗`);
console.log(`║  SmartC Decompiler — ${inputName.padEnd(30)}║`);
console.log(`╚══════════════════════════════════════════════════════╝\n`);
console.log(`  Source       : ${inputLabel}`);
console.log(`  Code size    : ${hex.length / 2} bytes (${hex.length} hex chars)`);
console.log('');

// ─── Decompile ───────────────────────────────────────────────────────────────

let JSONmap;
let assembly;

try {
    const result = decompiler(hex, undefined);
    JSONmap  = result.JSONmap;
    assembly = result.AssemblyProgram;
} catch (err) {
    console.error('─── Decompilation FAILED ─────────────────────────────');
    console.error(err.message ?? err);
    process.exit(1);
}

const assemblyLineCount = assembly.split('\n').length;

console.log('─── AT Assembly ──────────────────────────────────────');
console.log(assembly);
console.log('──────────────────────────────────────────────────────');
console.log(`  ${assemblyLineCount} lines\n`);

// ─── Optimize (optional) ─────────────────────────────────────────────────────

let optimized = null;

if (flags.optimize) {
    try {
        optimized = optimizer(assembly);
    } catch (err) {
        console.error('─── Optimization FAILED ──────────────────────────────');
        console.error(err.message ?? err);
        process.exit(1);
    }
    const optimizedLineCount = optimized.split('\n').length;
    const removed = assemblyLineCount - optimizedLineCount;

    console.log('─── Optimized Assembly ───────────────────────────────');
    console.log(optimized);
    console.log('──────────────────────────────────────────────────────');
    console.log(`  ${optimizedLineCount} lines  (${removed >= 0 ? '−' : '+'}${Math.abs(removed)} vs raw decompile)\n`);
}

// ─── JSONmap (verbose) ───────────────────────────────────────────────────────

if (flags.verbose) {
    console.log('─── JSONmap ──────────────────────────────────────────');
    console.log(`  Memory (${JSONmap.Memory?.length ?? 0} vars):`);
    (JSONmap.Memory ?? []).forEach((name, i) => {
        console.log(`    [${i.toString().padStart(3, ' ')}] ${name}`);
    });
    console.log(`  Labels (${JSONmap.Labels?.length ?? 0}):`);
    (JSONmap.Labels ?? []).forEach((l) => {
        console.log(`    @${l.address?.toString(16).padStart(4, '0')}  ${l.label}`);
    });
    console.log('');
}

// ─── JSON output ─────────────────────────────────────────────────────────────

if (flags.json) {
    const outputPath = `${inputName}.decompiled.json`;
    await Bun.write(outputPath, JSON.stringify({
        source: inputLabel,
        codeBytes: hex.length / 2,
        assembly,
        ...(optimized ? { optimizedAssembly: optimized } : {}),
        JSONmap,
    }, null, 2));
    console.log(`JSON output written to: ${outputPath}`);
}

console.log('─── ✓ Decompilation successful ───────────────────────\n');