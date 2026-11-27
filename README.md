# signum-smartc — Agent Skill for SmartC

A skill for writing, reviewing, compiling, and testing
**Signum blockchain Smart Contracts** using the
[SmartC](https://github.com/deleterium/SmartC) C-dialect compiler. It works with
Claude Code, Codex and other agents that read Agent Skills (`SKILL.md`), and pairs
with [SmartC Studio](https://smartc-studio.signum-network.dev), where the agent can
compile, lint, analyse gas and run tests for you.

---

## What this skill does

When active, this skill gives Claude deep context about:

- **SmartC language** — types (`long`, `fixed`), control flow, contract lifecycle
  (`sleep`/`halt`/`exit`/`void catch()`), gas optimization, inline assembly
- **High-level API** — all built-in blockchain functions (`getNextTx`, `setMapValue`,
  `sendAmount`, assets, KKV maps, cross-contract reads, etc.)
- **Low-level API** — A/B pseudo-registers, hash operations, raw AT opcodes
- **Canonical contract structure** — section order, the `getNextTx` loop,
  switch dispatch, TESTBED overrides
- **Established patterns** — permission system, error registration, cross-contract
  auth, event listeners, token-as-HP, text messages, downstream triggers, and more
- **Gas estimation** — how to trace a specific execution path through verbose
  assembly output and set `activationAmount` correctly
- **Testing** — full test suite setup with `signum-smartc-testbed` and Vitest,
  including `context.ts`, `lib.ts`, `BootstrapScenario`, and assertion patterns

---

## Installation

### Claude Code plugin (recommended)

One command installs the skill together with the
[SmartC Studio relay](https://www.npmjs.com/package/@smartc-studio/mcp), the MCP
server that lets Claude work in SmartC Studio:

```bash
claude plugin install signum-smartc --marketplace ohager/signum-smartc-skill
```

Then **restart Claude Code**. The skill is available as `signum-smartc:signum-smartc`,
and `/plugin` keeps both up to date.

- On Claude Code older than 2.1.275, add the marketplace first:
  `claude plugin marketplace add ohager/signum-smartc-skill`, then
  `claude plugin install signum-smartc@signum`.
- Registered the relay by hand before with the default command
  (`claude mcp add --scope user smartc-studio -- npx -y @smartc-studio/mcp`)? Claude
  Code keeps that entry and skips the plugin's identical copy. A hand-registered relay
  with other arguments (`--port`, `--allow-origin`, `--dev`, `cmd /c`) is not identical:
  remove it first (`claude mcp remove smartc-studio --scope user`), or the agent sees
  two relays.
- The plugin's relay uses the defaults: port 6890 and the hosted Studio. For another
  port or a self-hosted Studio, register the relay by hand as the Studio's Connect
  dialog shows, and install only the skill (next section).
- Already installed the skill with `npx skills` or `install.sh`? Remove that copy, or
  Claude sees the skill twice.

### Any agent (Claude Code, Codex, …)

```bash
npx skills add ohager/signum-smartc-skill -g
```

Installs the skill globally into every agent the
[skills CLI](https://github.com/vercel-labs/skills) finds. Restart the agent. To let
it work in SmartC Studio, also register the relay; the Studio's Connect dialog shows
the command for your agent.

### Local scripts (clone + installer)

Needed only for the local scripts (`scripts/compile.js`, `scripts/gas-analysis.js`)
on contracts on disk. With SmartC Studio connected, the agent uses the Studio's
tools instead.

```bash
git clone https://github.com/ohager/signum-smartc-skill.git ~/signum-smartc-skill && bash ~/signum-smartc-skill/scripts/install.sh
```

This clones the repo to `~/signum-smartc-skill` and runs the installer. The
checkout must stay in place — the skill is symlinked into `~/.claude/skills`
from there. Then **restart Claude Code**.

#### Step by step

1. **Clone** this repository anywhere on your machine:
   ```bash
   git clone https://github.com/ohager/signum-smartc-skill
   cd signum-smartc-skill
   ```

2. **Run the install script:**
   ```bash
   bash scripts/install.sh
   ```
   This will:
   - Link the skill into `~/.claude/skills/signum-smartc` (Claude Code's skill directory)
   - Install [Bun](https://bun.sh) if not already present
   - Install `smartc-signum-compiler` so `scripts/compile.js` works

3. **Restart Claude Code** to activate the skill.

4. **Testing dependencies** (optional, for writing contract test suites):
   ```bash
   bun add signum-smartc-testbed smartc-signum-compiler -D
   ```

### Windows

On native Windows (not WSL), agents cannot start `npx` directly as an MCP server;
wrap it in `cmd /c`:

```bash
claude mcp add --scope user smartc-studio -- cmd /c npx -y @smartc-studio/mcp
codex mcp add smartc-studio -- cmd /c npx -y @smartc-studio/mcp
```

If the plugin's relay does not start on Windows, disable the plugin's server in
`/mcp` and register it this way; the plugin's skill keeps working.

### Updating

- **Plugin:** `/plugin` in Claude Code, or `claude plugin update signum-smartc@signum`.
- **skills CLI:** run `npx skills add ohager/signum-smartc-skill -g` again.
- **Clone + installer:**

  ```bash
  bash ~/signum-smartc-skill/scripts/update.sh
  ```

  Pulls the latest release, prints the changelog entries since your version and
  refreshes the compiler dependency. Then restart Claude Code. The installed
  version is in `VERSION`; installs from before 1.0.0 need one manual
  `git pull` in the checkout to get the update script.

### Versioning

Releases follow [Semantic Versioning](https://semver.org/) and are tagged
`vX.Y.Z`; see `CHANGELOG.md`. Each release documents one compiler line
(currently **smartc-signum-compiler 2.3.x**), and the installer pins the
compiler to it.

---

## Usage

The skill activates automatically when you mention SmartC, Signum smart contracts,
CIYAM AT, `.smart.c` files, or related terms. You can also trigger it explicitly:

> *"Using the signum-smartc skill, write a contract that..."*

### Example prompts

- *"Write a SmartC contract that tracks ownership of items using a KKV map"*
- *"Review this contract for gas efficiency and safety issues"*
- *"Add a test suite for the SetBreachLimit method"*
- *"Estimate the activation amount for the worst-case execution path in this contract"*
- *"What's the difference between `exit` and `halt` in SmartC?"*

---

## Reference files

| File | Contents |
|---|---|
| `SKILL.md` | Recommended contract structure, core rules, analysis checklist |
| `references/language.md` | Language syntax, types, lifecycle, gas optimisation & estimation |
| `references/api-highlevel.md` | All built-in C functions including KKV maps |
| `references/api-lowlevel.md` | Low-level C API via `#include APIFunctions` |
| `references/assembler-ciyam.md` | Raw CIYAM AT bytecode — opcodes, hex tables, inline assembly |
| `references/patterns.md` | Optional, battle-tested contract patterns |
| `references/testing.md` | Test suite setup, SimulatorTestbed API, assertion patterns |
| `scripts/compile.js` | Local compile script (Bun runtime) |
| `scripts/install.sh` | Installer — links the skill, installs Bun and compiler |
| `scripts/update.sh` | Updater — pulls the latest release, shows what changed |
| `scripts/link-skill.sh` | Links the skill into `~/.claude/skills` (skipped for a plugin install) |
| `VERSION` / `CHANGELOG.md` | Installed version and release history |
| `.claude-plugin/` / `.mcp.json` | Claude Code plugin and marketplace manifests, the plugin's SmartC Studio relay |

---

## Disclaimer

This skill was built to assist with Signum SmartC development, but **AI can make
mistakes**. Always verify generated contract code carefully before deploying,
especially regarding:

- **Gas / activationAmount** — an incorrect estimate can freeze or kill a contract
- **Fund handling** — every incoming Signa must have a defined exit path
- **Permission checks** — missing guards can expose admin functions to anyone
- **Cross-contract authentication** — always verify `getCodeHashOf()` before
  trusting a contract's message
- **Division by zero** — will kill the contract permanently unless `void catch()`
  is defined

**Test on Signum testnet before deploying to mainnet.** The testbed simulator
is not a substitute for real-network validation.

The reference material in this skill is based on the official
[SmartC documentation](https://github.com/deleterium/SmartC/tree/main/docs)
by [@deleterium](https://github.com/deleterium). Discrepancies between this skill
and the official docs should be resolved in favour of the official docs.
