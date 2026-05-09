# signum-smartc — Claude Code Skill

A Claude Code skill for writing, reviewing, compiling, and testing
**Signum blockchain Smart Contracts** using the
[SmartC](https://github.com/deleterium/SmartC) C-dialect compiler.

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

This skill requires [Claude Code](https://claude.ai/code).

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
