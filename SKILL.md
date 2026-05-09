---
name: signum-smartc
description: >
  Write, review, compile, analyse, and structure Signum blockchain Smart Contracts
  using the SmartC C-dialect compiler targeting the CIYAM Automated Transactions (AT)
  virtual machine. Use this skill whenever the user mentions SmartC, Signum smart
  contracts, CIYAM AT, Burstcoin contracts, AT assembly, Signum blockchain development,
  .smart.c files, or asks to write/compile/debug/optimise/analyse/test any Signum contract.
  Also triggers for: AT opcodes, Signum tokenomics in contracts, #pragma directives,
  activationAmount, codeHashId, contract deployment on Signum testnet/mainnet,
  getNextTx, sendAmount, setMapValue, usageFee, isPaused, PERMISSION_ADMIN, TESTBED,
  registerError, struct TXINFO, struct TX, struct STATS, switch/case dispatch,
  multi-page readMessage, cross-contract auth, token minting, event listeners,
  signum-smartc-testbed, SimulatorTestbed, vitest smart contract, unit test AT contract,
  context.ts contract, BootstrapScenario, sendTransactionAndGetResponse, timeLapse,
  getContractMemoryValue, getContractMapValue, TDD SmartC.
---

# Signum SmartC Skill

SmartC is a C-dialect compiler that targets the CIYAM Automated Transactions (AT)
bytecode VM on the Signum blockchain (formerly Burstcoin). Every instruction costs
**0.001 Signa** at runtime, so gas efficiency is a first-class concern.

## Quick Reference Index

- **Language essentials** → `references/language.md`
- **High-level API (built-in C functions, KKV maps)** → `references/api-highlevel.md`
- **Low-level C API (`#include APIFunctions`)** → `references/api-lowlevel.md`
- **CIYAM AT bytecode & inline assembly opcodes** → `references/assembler-ciyam.md`
- **Optional patterns & idioms** → `references/patterns.md`
- **Test suite reference** → `references/testing.md`
- **Compile script** → `scripts/compile.js`  (`bun scripts/compile.js <file.smart.c>`)
- **Analysis checklist** → below (§ Analysis)

---

## Recommended Contract Structure

A consistent layout used across production contracts. Sections 1–13 are the
essential skeleton — most contracts need them in some form. The handler/helper
sections after `main()` are organisational suggestions.

### Section Order (always in this order)

```
1.  #program metadata
2.  #pragma tuning
3.  #define METHOD codes
4.  #define MAP keys
5.  #define STATUS / ERROR codes
6.  Initializable long variables  (set by deployer via TESTBED / SIMULATOR const overrides)
7.  #ifdef TESTBED / SIMULATOR const blocks
8.  Internal state variables  (runtime state, not deployer-set)
9.  struct STATS { ... } stats;
10. struct TXINFO / struct TX { ... } currentTx;
11. Auxiliary buffers  (messageBuffer, eventBuffer, etc.)
12. Top-level init code  (runs at deploy: getActivationOf, setMapValue, defaults)
13. void main()  { tx loop → switch dispatch → post-loop effects }
14. ---- HANDLER FUNCTIONS ----  (one per METHOD code)
15. ---- HELPER / INTERNAL FUNCTIONS ----  (prefix with _)
16. ---- MESSAGE HELPERS ----  (sendMsg*, sendEvent*)
```

### Template

```c
#program name MyContract
#program description MyProject - One-line description visible on-chain
#program activationAmount 1_0000_0000

#pragma maxAuxVars 3
#pragma optimizationLevel 3
#pragma version 2.3.0

// ---- METHOD CODES ----
#define METHOD_ACTION_ONE   1
#define METHOD_ACTION_TWO   2

// ---- MAP KEYS ----
#define MAP_KEY_DATA        1
#define MAP_KEY_ERRORS     99

// ---- STATUS / ERROR CODES ----
#define STATUS_NONE         0
#define STATUS_ACTIVE       1

#define ERROR_CODE_NO_PERMISSION   3

// ---- INITIALIZABLE PARAMETERS ----
// Set by the deployer. Use const overrides in TESTBED/SIMULATOR.
long owner;
// long someOtherContractId;

#ifdef SIMULATOR
    const owner = 100;
#endif
#ifdef TESTBED
    const owner = TESTBED_owner;
#endif

// ---- INTERNAL STATE ----

struct STATS {
    long actionCount;
} stats;

struct TXINFO {
    long txId;
    long sender;
    long message[4];
    long amount;
} currentTx;

// ---- TOP-LEVEL INIT CODE (runs once at deploy) ----
// one-time setup: e.g. getActivationOf, setMapValue defaults

// ---- MAIN LOOP ----
void main() {
    while ((currentTx.txId = getNextTx()) != 0) {
        currentTx.sender = getSender(currentTx.txId);
        currentTx.amount = getAmount(currentTx.txId);

        readMessage(currentTx.txId, 0, currentTx.message);
        switch (currentTx.message[0]) {
            case METHOD_ACTION_ONE:
                actionOne(currentTx.message[1]);
                break;
            case METHOD_ACTION_TWO:
                actionTwo(currentTx.message[1], currentTx.message[2]);
                break;
        }
    }
    // Post-loop effects (e.g. trigger downstream contract after processing all txs)
}

// ---- HANDLER FUNCTIONS ----

void actionOne(long param) {
    // ...
    ++stats.actionCount;
}

void actionTwo(long p1, long p2) {
    // ...
}

// ---- HELPERS ----

void _registerError(long errorCode) {
    setMapValue(MAP_KEY_ERRORS, currentTx.txId, errorCode);
}
```

---

## Core Rules

These few rules really do matter — getting them wrong breaks the contract or its
testability.

1. **`getNextTx()` loop must drain the full queue.** Never `break` early — unprocessed
   transactions accumulate and execute on the next activation, often with stale state.
2. **`readMessage(txId, 0, buffer)` before dispatching.** The switch needs the message
   contents loaded.
3. **`switch` on `message[0]`** is the conventional dispatcher; `message[1..3]` carry
   arguments.
4. **Multi-page messages** use `readMessage(txId, page, buffer)` with page ≥ 1,
   iterating `(count + 4) / 4` times — see `references/patterns.md`.
5. **Errors recorded, not thrown.** `_registerError(code)` writes to a designated map
   key on `currentTx.txId` — never throws or halts. The contract keeps running.
6. **Post-loop effects** (downstream `sendAmountAndMessage` triggers) go AFTER the
   `while` loop, not inside it, to batch cross-contract calls.
7. **TESTBED const block** is the testability escape hatch. Every initializable
   parameter must have a `TESTBED_` override or it cannot be set in tests.

## Conventions

Non-binding but consistent across the codebase:

- **`struct TXINFO` / `struct TX`** — group per-tx state in one struct rather than
  loose globals. `TXINFO` for full-fledged contracts; `TX` for lightweight ones.
- **`struct STATS`** — central place for counters; expose via the KKV map if
  external contracts need to read them.
- **`_` prefix** for internal helpers — a readability convention, not a compiler
  feature.

---

## Pragma Directives Cheatsheet

| Pragma | Typical Value | Effect |
|---|---|---|
| `#pragma maxAuxVars 3` | 1–9 | Scratch register count. Start at 3; reduce to minimum that compiles. |
| `#pragma maxConstVars 2` | 0–9 | Constant-folding slots; compiler auto-generates `n1`…`nN` variables. |
| `#pragma optimizationLevel 3` | 0–3 | 3 = VM-trace optimizer (beta but recommended); 2 = default safe optimizer. |
| `#pragma reuseAssignedVar` | true | Reuse LHS variable as register — saves one instruction per expression. Default true; keep it. |
| `#pragma version 2.3.0` | string | Lock compiler version (optional but good practice). |
| `#pragma verboseAssembly` | flag | Annotate assembly with source lines — dev/debug only, remove for production. |
| `#pragma verboseScope` | flag | Show register usage at scope boundaries — dev/debug only. |

## Program Directives Cheatsheet

| Directive | Notes |
|---|---|
| `#program name` | Max 30 chars, shown on explorer |
| `#program description` | Max 1000 chars |
| `#program activationAmount` | Signa; use `N_NNNN_NNNN` underscore format |
| `#program codeHashId` | uint64; add after first successful deploy |

---

## Analysis Checklist

When reviewing or auditing a SmartC contract:

**Safety**
- [ ] `getNextTx()` loop drains all transactions — no early `break`
- [ ] Cross-contract calls gated by `getCodeHashOf()` comparison
- [ ] No division without guard against zero divisor

**Gas**
- [ ] `optimizationLevel 3` set
- [ ] `maxAuxVars` at minimum required value
- [ ] `getCreator()` not called in hot loop (cache in variable if needed)
- [ ] Post-loop cross-contract sends use accumulated counter, not per-tx sends
- [ ] `inline` keyword used on hot helper functions (e.g. `refundPowerUpsWithPenalty`)
- [ ] Unrolled loops used for fixed-size asset arrays (4-slot AT limit)

**Correctness**
- [ ] `readMessage(txId, 0, msg)` called before `switch`
- [ ] Multi-page batch reads use `(count+4)/4` ceiling division
- [ ] Error map key does not overlap any domain map keys
- [ ] `codeHashId` set and used for contract authentication
- [ ] All `#define` codes unique and documented
- [ ] `TESTBED` const block present for all initializable params
- [ ] `struct STATS` fields updated on every relevant state change

**Deployment**
- [ ] `activationAmount` covers worst-case execution path
- [ ] `codeHashId` added to source after first deploy and verified
- [ ] Carbon-copy method used for testnet→mainnet migration

**Testing**
- [ ] `compile.test.ts` present and passes — code size ≤ 10240 bytes
- [ ] `context.ts` mirrors all `#define` codes and map keys
- [ ] Every method has: happy path + permission gate + invalid input + edge cases
- [ ] `DefaultRequiredInitializers` covers all `TESTBED_` vars
- [ ] `BootstrapScenario` correctly funds and initialises the contract
- [ ] No tests assert exact `getWeakRandomNumber` outcomes — use statistical assertions
- [ ] Skipped tests (`test.skip`) have documented `FIXME` reason
- [ ] Vitest config has `sequence.concurrent: false`

---

## Compile Script

`scripts/compile.js` — Bun runtime, uses `smartc-signum-compiler` npm package.
Run `scripts/install.sh` once to install Bun and the compiler.

```bash
bun scripts/compile.js MyContract.smart.c
bun scripts/compile.js MyContract.smart.c --verbose   # show AT assembly
bun scripts/compile.js MyContract.smart.c --json      # emit .compiled.json
```

Outputs: assembly (with `--verbose`), machine code hex, deployment summary
(data pages, activation amount, code hash), and analysis warnings.

---

## Reference Files (load on demand)

| File | Load when... |
|---|---|
| `references/language.md` | Syntax, types (`long`, `fixed`), operators, control flow, contract lifecycle (`sleep`/`halt`/`exit`/`catch`), gas optimisation and estimation |
| `references/api-highlevel.md` | Built-in C functions: tx loop, send/receive, assets, KKV maps, cross-contract reads, signature verification, math utilities |
| `references/api-lowlevel.md` | C wrappers via `#include APIFunctions` — A/B pseudo-registers, hash/signature ops, register-based map & asset ops, fixed-point variants |
| `references/assembler-ciyam.md` | Raw CIYAM AT bytecode — `asm { }` syntax, opcode mnemonics, hex opcode/function-code tables. Use when reading verbose assembly output or writing inline assembly |
| `references/patterns.md` | Optional patterns: multi-page batch reads, permission system, error registration, cross-contract auth, event system, asset HP, token decimals, text messages, burn address, etc. |
| `references/testing.md` | Writing unit tests: `SimulatorTestbed`, `context.ts`, `lib.ts`, `BootstrapScenario`, assertion patterns, known limitations |

---

## Testing Overview

All SmartC contracts should have a full test suite using `signum-smartc-testbed`
(Vitest recommended). Tests run entirely in-process — no blockchain required.

**Required test files for every contract:**

```
contract/
├── context.ts                    ← account IDs, method codes, map keys, error codes
├── lib.ts                        ← shared helpers, DefaultInitializers, BootstrapScenario, domain-specific test utilities
├── compile.test.ts               ← compile succeeds + code size ≤ 10240 bytes
├── creator-configuration/        ← one describe per setter method; happy + permission + edge cases
│   └── creator-configuration.test.ts
└── <feature>/
    └── <feature>.test.ts         ← one file per behavioural domain
```

**Mandatory test categories for every method:**
1. Happy path — correct inputs produce expected state change
2. Permission gate — unauthorized sender is rejected (`_registerError` called), where applicable
3. Invalid inputs — zero, negative, out-of-range values are rejected or clamped
4. Edge cases — boundary values (min, max, off-by-one)

**Run tests:**
```bash
bun add signum-smartc-testbed smartc-signum-compiler -D
bun vitest run           # single run
bun vitest               # watch mode
```

See `references/testing.md` for the full API, assertion patterns, and all common scenarios.
