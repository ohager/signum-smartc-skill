import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Keeps the Claude Code plugin consistent with the skill: same name, same version
// (otherwise /plugin never delivers an update), and the relay started with the
// defaults the Studio Quick Start relies on.
const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const json = (file: string) => JSON.parse(read(file));

const frontmatterName = (md: string) => /^---\n[\s\S]*?^name:\s*(\S+)[\s\S]*?^---$/m.exec(md)?.[1];

describe('plugin manifests', () => {
    const plugin = json('.claude-plugin/plugin.json');

    it('plugin.json is named like the skill', () => {
        expect(plugin.name).toBe('signum-smartc');
        expect(frontmatterName(read('SKILL.md'))).toBe(plugin.name);
    });

    it('plugin.json version is VERSION', () => {
        expect(plugin.version).toBe(read('VERSION').trim());
    });

    it('the marketplace lists this repo as the plugin', () => {
        const market = json('.claude-plugin/marketplace.json');
        expect(market.name).toBe('signum');
        expect(market.plugins).toEqual([expect.objectContaining({ name: plugin.name, source: './' })]);
    });

    it('the plugin starts the Studio relay with defaults', () => {
        expect(json('.mcp.json').mcpServers['smartc-studio']).toEqual({ command: 'npx', args: ['-y', '@smartc-studio/mcp'] });
    });
});
