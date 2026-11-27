import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The installer links the skill into ~/.claude/skills, except for a plugin install:
// Claude Code already loads the plugin's skill, and a link into the versioned plugin
// cache would show the skill twice and dangle after the next plugin update.
const script = join(import.meta.dirname, '..', 'scripts', 'link-skill.sh');

function run(skillDir: string, home: string) {
    mkdirSync(skillDir, { recursive: true });
    return spawnSync('bash', [script, skillDir], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
}

describe('link-skill.sh', () => {
    it('links a clone into ~/.claude/skills', () => {
        const home = mkdtempSync(join(tmpdir(), 'skill-home-'));
        const result = run(join(home, 'signum-smartc-skill'), home);
        expect(result.status).toBe(0);
        expect(lstatSync(join(home, '.claude/skills/signum-smartc')).isSymbolicLink()).toBe(true);
    });

    it('does not link a plugin install', () => {
        const home = mkdtempSync(join(tmpdir(), 'skill-home-'));
        const result = run(join(home, '.claude/plugins/cache/signum/signum-smartc/1.1.0'), home);
        expect(result.status).toBe(0);
        expect(existsSync(join(home, '.claude/skills/signum-smartc'))).toBe(false);
        expect(result.stdout).toContain('plugin');
    });
});
