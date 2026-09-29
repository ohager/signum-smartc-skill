import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// references/assembler-ciyam.md transcribes the assembler's opcode and API
// tables. This re-reads both from the installed compiler and diffs them, so a
// compiler upgrade (or a typo) fails here instead of misleading the model.
const require = createRequire(import.meta.url);
const assembler = readFileSync(
    require.resolve('smartc-signum-compiler/dist/assembler/assembler.js'),
    'utf8',
);
const doc = readFileSync(
    join(import.meta.dirname, '..', 'references', 'assembler-ciyam.md'),
    'utf8',
);

const hex = (n: number, digits: number) => `0x${n.toString(16).padStart(digits, '0')}`;

describe('assembler-ciyam.md', () => {
    it('opcode table matches the assembler (opcode, internal name, size)', () => {
        const fromCompiler = [...assembler.matchAll(
            /\{ opCode: (0x[0-9a-f]+), name: '([A-Z_0-9]+)', size: (\d+)/g,
        )].map((m) => `${hex(Number(m[1]), 2)} ${m[2]} ${m[3]}`);
        const fromDoc = [...doc.matchAll(
            /^\| `(0x[0-9a-f]{2})` \| `[^`]+` \| ([A-Z_0-9]+) \| (\d+) \|$/gm,
        )].map((m) => `${m[1]} ${m[2]} ${m[3]}`);
        expect(fromDoc.length).toBeGreaterThan(40);
        expect(fromDoc.sort()).toEqual(fromCompiler.sort());
    });

    it('API function code table matches the assembler (code, name, opcode)', () => {
        const fromCompiler = [...assembler.matchAll(
            /\{ name: '(\w+)', apiCode: (0x[0-9a-f]+), opCode: (0x[0-9a-f]+) \}/g,
        )].map((m) => `${hex(Number(m[2]), 4)} ${m[1]} ${m[3]}`);
        const fromDoc = [...doc.matchAll(
            /^\| `(0x[0-9a-f]{4})` \| (\w+) \| `(0x[0-9a-f]{2})` \|$/gm,
        )].map((m) => `${m[1]} ${m[2]} ${m[3]}`);
        expect(fromDoc.length).toBeGreaterThan(70);
        expect(fromDoc.sort()).toEqual(fromCompiler.sort());
    });
});
