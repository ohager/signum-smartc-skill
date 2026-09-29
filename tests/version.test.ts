import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Keeps the release metadata consistent: VERSION, CHANGELOG.md, the compiler
// range the installer pins, and the compiler line SKILL.md claims to document.
const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const version = read('VERSION').trim();

describe('release metadata', () => {
    it('VERSION is a semver version', () => {
        expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('the newest CHANGELOG entry is the current VERSION', () => {
        const newest = /^## \[(\d+\.\d+\.\d+)\]/m.exec(read('CHANGELOG.md'));
        expect(newest?.[1]).toBe(version);
    });

    it('the installer pins the compiler line SKILL.md documents', () => {
        const documented = /Documents smartc-signum-compiler (\d+)\.(\d+)\.x/.exec(read('SKILL.md'));
        const pinned = /COMPILER_RANGE="~(\d+)\.(\d+)\.\d+"/.exec(read('scripts/install.sh'));
        expect(documented).not.toBeNull();
        expect(pinned).not.toBeNull();
        expect(pinned!.slice(1)).toEqual(documented!.slice(1));
    });
});
