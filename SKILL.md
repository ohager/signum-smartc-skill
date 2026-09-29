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
bytecode VM on the Signum blockchain (formerly Burstcoin). Execution is charged per
**step** at **0.001 Signa/step**: an ordinary opcode costs 1 step, but every built-in
API call costs **10 steps** (0.01 Signa). Minimising API calls is therefore the biggest
gas lever, and gas efficiency is a first-class concern.

## Quick Reference Index

- **Language essentials** → `references/language.md`
- **High-level API (built-in C functions, KKV maps)** → `references/api-highlevel.md`
- **Low-level C API (`#include APIFunctions`)** → `references/api-lowlevel.md`
- **CIYAM AT bytecode & inline assembly opcodes** → `references/assembler-ciyam.md`
- **Optional patterns & idioms** → `references/patterns.md`
- **Test suite reference** → `references/testing.md`
- **Compile script** → `scripts/compile.js`  (`bun scripts/compile.js <file.smart.c>`)
- **Gas analysis script** → `scripts/gas-analysis.js`  (per-handler min/max execution cost)
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
#program activationAmount 1_0000_0000   // PLACEHOLDER — size to worst case via scripts/gas-analysis.js before deploy

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
- [ ] Worst-case per-handler cost measured with `scripts/gas-analysis.js`
- [ ] API calls (10 steps each) minimised — cache repeated `getSender`/`getCreator`/map reads
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
- [ ] `activationAmount` covers worst-case execution path (verify with `scripts/gas-analysis.js`)
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

## Gas Analysis Script

`scripts/gas-analysis.js` — computes the **min and max execution cost** (in steps and
Signa) of every handler by building a control-flow graph from the compiled AT assembly.
Core logic lives in `lib/gas/analyzer.js` (unit-tested in `tests/gas-analysis.test.ts`).

> **Run this by default when building.** After compiling a new or changed contract,
> run the analyzer, take the **worst tx handler Max SIGNA + the post-loop Max SIGNA**
> (the analyzer prints this sum under *Activation guidance*), and set
> `#program activationAmount` to `that sum × 1.1–1.2` (safety margin). Never ship
> the template's placeholder activation amount. Report the worst-case cost and the
> chosen activation amount to the user, and raise any warnings it emits (see below) —
> especially **recursion**, which on AT can overflow the code stack and send the
> contract to the **Dead** state (balance forfeited).

> **The figures are static ESTIMATES, not measured runs — say so to the user.**
> Each row shows three numbers: **Min** (loops skipped), **1×loop** (each
> data-dependent loop runs once — the realistic, near-empirical figure), and
> **Max** (every loop runs the full `--loop-cap`, default 10, on the worst branch —
> a conservative upper bound). Because every API call inside a loop is charged a
> flat 10 steps × the cap, **Max routinely overstates** loops that really run only
> a few times, and will read far higher than TDD/testbed measurements. Size
> `activationAmount` off Max (safe), but report the 1×loop figure as the expected
> cost and always frame both as estimates to validate against the testbed. A Max
> above ~**5 SIGNA** per activation is unusually high — flag it and re-check loop
> bounds rather than blindly shipping a large activation amount.

> **No multi-tx activation — never sum across transactions.** Each incoming
> transaction is its own single run through the `getNextTx()` loop and carries its
> own `activationAmount`. The loop body executes once per transaction, funded by
> that transaction's own fee — costs are **never** multiplied by, or summed over,
> the number of queued transactions. So `activationAmount` is sized to a **single**
> transaction's path, not to N of them. The only per-activation addition is the
> **post-loop** code (the trailing statements in `main()` after the `while` loop),
> which runs once after the queue drains; the analyzer reports it separately and
> the worst-case activation is `worst single-tx handler + post-loop`.

```bash
bun scripts/gas-analysis.js MyContract.smart.c
bun scripts/gas-analysis.js MyContract.smart.c --loop-cap 20   # bound inner loops (default 10)
bun scripts/gas-analysis.js MyContract.smart.c --json          # emit .gas.json
```

Prints a **per-method table** — each method code → handler, with the full
per-invocation cost (`per-tx preamble + dispatch + handler`) as **Min / 1×loop /
Max** SIGNA (see the estimate note above). The preamble is the guaranteed per-tx
overhead to reach a handler (getSender, readMessage, guards, `receiveAssets`, the
compare chain). Below it: per-handler bodies, and a **Post-loop** row for `main()`'s
trailing per-activation effects. A *How to read these numbers* block explains the
three columns, and the *Activation guidance* footer gives both the typical (1×loop)
and upper-bound (Max) per-activation cost and the recommended `activationAmount`.

**Fee model** (verified against signum-node `src/brs/at/AtMachineProcessor.getNumSteps`
+ `AtConstants`, AT v3): `0.001 Signa/step`; ordinary opcode = **1 step**; every API
call (the `FUN` mnemonic) = **10 steps**; `issueAsset` and `distributeToHolders` cost
more and are partly data-dependent. Hard ceiling: **100 000 steps (100 Signa) per
activation** — the VM stops before exceeding it.

**Hazards it flags** (each makes MAX a *lower bound*, so treat as a red flag, not just a note):
- **Recursion** — a handler that calls itself directly or transitively. Cost is
  unbounded *and* it risks a code-stack overflow → **Dead** contract. Refactor to a
  bounded loop.
- **Loop-cap reached** — a data-dependent loop could run more than `--loop-cap` times;
  the true worst case may be higher. Re-run with a larger cap or add an on-chain bound.
  Conversely, if the loop really runs fewer times, Max *overstates* — lean on the
  1×loop column and testbed measurements for the expected cost.
- **`sleep`/`stop` mid-handler** — the handler spans multiple activations; the figure
  is for one activation only.
- **Asset ops** (`issueAsset`/`distributeToHolders`) — real cost exceeds the 10-step
  API floor and scales with holder count.

**Scope & caveats:**
- The outer `getNextTx()` loop is not multiplied — cost is per invocation (one tx),
  because there is no multi-tx activation (see the note above). The loop is detected
  by anchoring on the getNextTx API call, so it works whether or not `main()` has
  post-loop code; post-loop cost is reported as its own row.
- Data-dependent inner loops are bounded to `--loop-cap` iterations for MAX. A very
  large `--loop-cap` over deeply nested loops is capped by a recursion-depth guard
  (flagged as loop-cap reached) rather than overflowing — MAX becomes a lower bound.
- Relies on the pinned compiler's label conventions (`__fn_`, `__switch`, backward
  edge = loop, `A_to_Tx_after_Timestamp` = getNextTx).

Use it to size `#program activationAmount` to the worst-case path.

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
