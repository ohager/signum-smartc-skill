# SmartC Testbed Reference

`signum-smartc-testbed` is the automated testing harness for SmartC contracts.
It runs the contract through the `smartc-signum-simulator` in-process, letting
you write Vitest/Jest tests that exercise the full AT execution path without
deploying to the blockchain.

Package: `signum-smartc-testbed`  
Docs: https://ohager.github.io/signum-smartc-testbed/  
Starter template: https://github.com/ohager/signum-smartc-testbed-starter

---

## Table of Contents
1. [Project Structure](#project-structure)
2. [Setup](#setup)
3. [Core Concepts](#core-concepts)
4. [SimulatorTestbed API](#simulatortestbed-api)
5. [TransactionObj Reference](#transactionobj-reference)
6. [context.ts — The Contract Constants File](#contextts--the-contract-constants-file)
7. [lib.ts — Shared Test Helpers](#libts--shared-test-helpers)
8. [Test File Structure](#test-file-structure)
9. [Assertion Patterns](#assertion-patterns)
10. [Common Testing Scenarios](#common-testing-scenarios)
11. [Known Limitations](#known-limitations)

---

## Project Structure

```
contract/
├── context.ts                    ← ALL constants: account IDs, method codes, map keys, data offsets
├── lib.ts                        ← Shared helpers: attack(), timeLapse(), getCurrentHp(), etc.
├── compile.test.ts               ← Sanity check: compiles successfully, code size within limit
├── contract.smart.c              ← The contract source
├── <feature-1>/
│   └── feature-1.test.ts         ← Tests grouped by feature/method
├── <feature-2>/
│   └── feature-2.test.ts
└── creator-configuration/
    └── creator-configuration.test.ts
```

**One directory per feature/method.** Keep `describe` blocks focused.  
**No parallel test execution** — set Vitest to run serially (`sequence.concurrent: false`).  
**Reset testbed per test** — create a fresh `SimulatorTestbed` in every `test()`.

---

## Setup

```bash
bun add signum-smartc-testbed smartc-signum-compiler -D
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        sequence: { concurrent: false },  // REQUIRED — no parallel execution
    },
});
```

`tsconfig.json` — needs `moduleResolution: "bundler"` or `"node16"` for the
ESM imports from testbed.

---

## Core Concepts

**Scenario:** an array of `TransactionObj` that defines what transactions arrive
at the contract, in what block, from whom, with what amount/tokens/message.

**loadContract:** reads the `.smart.c` source, injects `TESTBED_` initializers,
compiles it, and deploys it in the simulator.

**runScenario:** feeds the scenario transactions through the simulator, forging
blocks as needed.

**TESTBED initializers:** the mechanism to set initializable contract variables
without deploying. Requires the contract to have `#ifdef TESTBED` const blocks.

```c
// In the contract:
long owner;
long usageFee;

#ifdef TESTBED
    const owner    = TESTBED_owner;
    const usageFee = TESTBED_usageFee;
#endif
```

```ts
// In the test:
SimulatorTestbed
    .loadContract(ContractPath, {
        owner: 555n,
        usageFee: 5_0000_0000n,
    })
```

---

## SimulatorTestbed API

```ts
import { SimulatorTestbed } from 'signum-smartc-testbed';

// Fluent construction
const testbed = new SimulatorTestbed(optionalBootstrapScenario)
    .loadContract(codePath, initializers?)    // load + compile + deploy
    .runScenario(transactions?);              // forge all blocks

// ── Inspection ──────────────────────────────────────────────────

// Read a contract memory variable by name (struct fields use underscore: "stats_count")
testbed.getContractMemoryValue('variableName')         // → bigint | null
testbed.getContractMemory()                            // → MemoryObj[]  (all vars)

// Read a map entry
testbed.getContractMapValue(key1: bigint, key2: bigint) // → bigint (0 if unset)
testbed.getContractMapValues(key1: bigint)              // → MapObj[] (all k2 for k1)
testbed.getContractMap()                               // → MapObj[] (entire map)

// Transactions
testbed.getTransactions()                              // → BlockchainTransactionObj[]
testbed.getTransaction(index)                          // → BlockchainTransactionObj
testbed.getTransactionById(id: bigint)                 // → BlockchainTransactionObj | null
testbed.getTransactionsSentByContract(blockheight)     // → BlockchainTransactionObj[]

// Accounts
testbed.getAccount(accountId: bigint)                  // → AccountObj | null

// Contract
testbed.getContract(address?)                          // → CONTRACT

// Low-level blockchain (leaky abstraction — use sparingly)
testbed.blockchain       // → BLOCKCHAIN (forgeBlock, transactions, Contracts, accounts)

// ── Interaction ─────────────────────────────────────────────────

// Send transactions and get the contract's response transactions from next block
testbed.sendTransactionAndGetResponse(
    transactions: TransactionObj[],
    address?: bigint    // defaults to last deployed contract
)    // → BlockchainTransactionObj[]

// Switch active contract (multi-contract tests)
testbed.selectContract(address: bigint)     // → SimulatorTestbed (fluent)

// ── Utilities ────────────────────────────────────────────────────

import { utils } from 'signum-smartc-testbed';
utils.long2string(bigint)     // decode a packed 8-char string from a long
```

### BlockchainTransactionObj fields
```ts
{
    id: bigint,
    sender: bigint,
    recipient: bigint,
    amount: bigint,           // in planck (NQT)
    type: number,
    messageArr: bigint[],     // decoded message words [0..3]
    messageText: string,      // decoded as UTF-8 string (if applicable)
    tokens: Array<{asset: bigint, quantity: bigint}>,
    blockheight: number,
}
```

---

## TransactionObj Reference

```ts
interface TransactionObj {
    blockheight?: number;          // optional; auto-increments if omitted
    amount: bigint;                // in planck (NQT), must include activation fee
    sender: bigint;
    recipient: bigint;             // the contract address
    messageArr?: bigint[];         // up to 4 words: [methodCode, arg1, arg2, arg3]
    tokens?: Array<{
        asset: bigint;
        quantity: bigint;
    }>;
}
```

**Amount = activation fee + actual payment.** The activation fee must always be
included or the contract won't execute.

```ts
// Correct — 100 SIGNA attack + 2 SIGNA activation fee
{
    amount: (100n * 1_0000_0000n) + ACTIVATION_FEE,
    sender: PlayerAccount,
    recipient: ContractAddress,
}

// Method call — no actual payment, just activation fee
{
    amount: ACTIVATION_FEE,
    sender: CreatorAccount,
    recipient: ContractAddress,
    messageArr: [Context.Methods.SetBreachLimit, 50n],
}
```

---

## context.ts — The Contract Constants File

`context.ts` is the single source of truth for all test constants. It mirrors
the `#define` values from the contract so tests never hardcode magic numbers.

```ts
// context.ts — canonical structure
import { join } from 'path';

export const Context = {
    // File paths
    ContractPath: join(__dirname + '/contract.smart.c'),

    // Account IDs (use distinct values, never 0)
    CreatorAccount:  555n,
    SenderAccount1:  10n,
    SenderAccount2:  20n,
    ThisContract:    999n,   // used when no NFT/secondary contract is loaded

    // Fees
    ActivationFee: 2_0000_0000n,   // must match #program activationAmount

    // Method codes — mirror the #define METHOD_* values
    Methods: {
        SetActive:    1n,
        SetBreachLimit: 2n,
        // ...
    },

    // Map keys — mirror the #define MAP_KEY_* values
    Maps: {
        DamageMultiplier:   1n,
        AttackersLastAttack: 2n,
        KeyError:           99n,
    },

    // Error codes — mirror ERROR_CODE_* defines
    ErrorCodes: {
        NoPermission: 3n,
        FeeTooLow:    5n,
    },

    // Struct field memory offsets (get from verbose assembly output)
    // struct fields are named "structname_field" in getContractMemoryValue
    Data: {
        isActive:     12n,
        isDefeated:   23n,
        hpTokenId:    26n,
        // ...
    },
}
```

**Getting struct field names:** SmartC names struct fields `structName_fieldName`
in memory. Use `getContractMemory()` once to discover all variable names, then
add them to `Context.Data`.

---

## lib.ts — Shared Test Helpers

Extract repeated test operations into typed helper functions in `lib.ts`.

```ts
// lib.ts — standard helpers

import type { SimulatorTestbed, TransactionObj } from 'signum-smartc-testbed';
import { Context } from './context';

// ─── Domain-specific helpers ─────────────────────────────────────────────────

export function getCurrentHitpoints(testbed: SimulatorTestbed): bigint | undefined {
    const hpTokenId = testbed.getContractMemoryValue('hpTokenId');
    const token = testbed.getContract().tokens.find(t => t.asset === hpTokenId);
    return token?.quantity;
}

export type AttackParams = {
    testbed: SimulatorTestbed;
    signa: bigint;
    tokens?: Array<{ asset: bigint; quantity: bigint }>;
    sender?: bigint;
};

export function attack({ testbed, sender = Context.SenderAccount1, signa, tokens = [] }: AttackParams) {
    if (tokens.length > 4) throw new Error('Max 4 tokens allowed');
    return testbed.sendTransactionAndGetResponse([{
        sender,
        recipient: Context.ThisContract,
        amount: (signa * 1_0000_0000n) + Context.ActivationFee,
        tokens,
    }]);
}

// ─── Time helpers ────────────────────────────────────────────────────────────

export function timeLapse({ testbed, blocks }: { testbed: SimulatorTestbed; blocks: bigint }) {
    for (let i = 0; i < blocks; i++) {
        testbed.blockchain.forgeBlock();
    }
}

// ─── Default initializers ────────────────────────────────────────────────────

export const DefaultRequiredInitializers = {
    name: 'CT000001',        // packed 8-char string
    xpTokenId: Context.XPTokenId,
    maxHp: 50_000n,
    breachLimit: 0n,         // keep contract default
    coolDownInBlocks: 0n,    // keep contract default
    firstBloodBonus: 0n,
    finalBlowBonus: 0n,
    isActive: 0n,
    rewardNftId: 0n,
    eventListenerAccountId: 0n,
};

// ─── Standard bootstrap scenario ────────────────────────────────────────────

export const BootstrapScenario: TransactionObj[] = [
    {
        blockheight: 1,
        amount: 200_0000_0000n,       // fund the contract
        sender: Context.CreatorAccount,
        recipient: Context.ThisContract,
        tokens: [{ asset: Context.XPTokenId, quantity: 50_000n }],
    },
    {
        blockheight: 2,
        amount: 2_0000_0000n,         // trigger init/minting
        sender: Context.CreatorAccount,
        recipient: Context.ThisContract,
    },
];
```

---

## Test File Structure

Every test file follows this pattern:

```ts
import { describe, expect, test } from 'vitest';
import { SimulatorTestbed } from 'signum-smartc-testbed';
import { Context } from '../context';
import { DefaultRequiredInitializers, BootstrapScenario, attack, timeLapse } from '../lib';

describe('Feature Name', () => {

    // ── Happy path ──────────────────────────────────────────────────────────

    test('should do the thing', () => {
        const testbed = new SimulatorTestbed(BootstrapScenario)
            .loadContract(Context.ContractPath, DefaultRequiredInitializers)
            .runScenario();

        // Act
        attack({ testbed, signa: 100n });

        // Assert
        expect(testbed.getContractMemoryValue('someVar')).toBe(expectedValue);
    });

    // ── Permission gates ────────────────────────────────────────────────────

    test('should NOT do thing when sender is not creator', () => {
        const testbed = new SimulatorTestbed([
            ...BootstrapScenario,
            {
                blockheight: 2,
                amount: Context.ActivationFee,
                sender: Context.SenderAccount1,    // ← not creator
                recipient: Context.ThisContract,
                messageArr: [Context.Methods.SetBreachLimit, 50n],
            },
        ])
            .loadContract(Context.ContractPath, DefaultRequiredInitializers)
            .runScenario();

        // Value should remain at default
        expect(testbed.getContractMemoryValue('breachLimit')).toBe(20n);
    });

    // ── Error registration ───────────────────────────────────────────────────

    test('should register error on invalid input', () => {
        const testbed = new SimulatorTestbed(BootstrapScenario)
            .loadContract(Context.ContractPath, DefaultRequiredInitializers)
            .runScenario();

        const responses = testbed.sendTransactionAndGetResponse([{
            sender: Context.SenderAccount1,
            recipient: Context.ThisContract,
            amount: Context.ActivationFee,
            messageArr: [Context.Methods.SomeAction, 0n],  // 0 = invalid
        }]);

        // Check error map: MAP_KEY_ERRORS[txId] = errorCode
        const errors = testbed.getContractMap()
            .filter(m => m.k1 === Context.Maps.KeyError);
        expect(errors.some(e => e.value === Context.ErrorCodes.NoPermission)).toBe(true);
    });

    // ── Edge cases ────────────────────────────────────────────────────────────

    test.skip('skipped due to known bug in testbed bigint handling', () => {
        // Document WHY it is skipped
    });
});
```

---

## Assertion Patterns

### Memory variables
```ts
// Simple variable
expect(testbed.getContractMemoryValue('isPaused')).toBe(1n);

// Struct field (underscore separator)
expect(testbed.getContractMemoryValue('stats_stockQuantity')).toBe(400n);
expect(testbed.getContractMemoryValue('rewardDistribution_players')).toBe(85n);

// String encoded in long (use utils.long2string)
import { utils } from 'signum-smartc-testbed';
const name = testbed.getContractMemoryValue('name') ?? 0n;
expect(utils.long2string(name)).toBe('CT000001');
```

### Map values
```ts
// Single entry
expect(testbed.getContractMapValue(Context.Maps.AttackersLastAttack, Context.SenderAccount1))
    .toBe(6n);

// With MAP_SET_FLAG (token decimals pattern)
const MAP_SET_FLAG = 1024n;
expect(testbed.getContractMapValue(Context.Maps.TokenDecimalsInfo, tokenId))
    .toBe(2n + MAP_SET_FLAG);

// Error map
const errors = testbed.getContractMap()
    .filter(m => m.k1 === 99n);  // MAP_KEY_ERRORS = 99
expect(errors).toHaveLength(1);
expect(errors[0].value).toBe(Context.ErrorCodes.NoPermission);
```

### Transactions
```ts
const txs = testbed.getTransactions();

// Check a message was sent
const hasCooldownMsg = txs.some(tx =>
    tx.recipient === Context.SenderAccount1 &&
    tx.messageText?.startsWith('COOLDOWN')
);
expect(hasCooldownMsg).toBe(true);

// Check an amount was sent
expect(txs.some(tx =>
    tx.recipient === Context.SenderAccount1 &&
    tx.amount === 90_0000_0000n
)).toBe(true);

// Burn transaction (recipient = 0)
expect(txs.some(tx => tx.recipient === 0n && tx.amount === 10_0000_0000n)).toBe(true);

// Token transfer
const response = testbed.sendTransactionAndGetResponse([...]);
expect(response[0].tokens).toEqual([{ asset: tokenId, quantity: 5n }]);

// Structured event (messageArr)
const hitEvent = txs.find(tx => tx.messageArr[0] === 601n);
expect(hitEvent?.messageArr).toEqual([601n, Context.SenderAccount1, 10n, 49990n]);
```

### Accounts
```ts
const attacker = testbed.getAccount(Context.SenderAccount1)!;
expect(attacker.balance).toBeGreaterThan(0n);

// Token holdings
const xpToken = attacker.tokens.find(t => t.asset === Context.XPTokenId);
expect(xpToken?.quantity).toBe(10n);
```

---

## Common Testing Scenarios

### Compile sanity check (always include)
```ts
import { readFileSync } from 'fs';
import { SmartC } from 'smartc-signum-compiler';

const MAX_CODE_SIZE = 40 * 256; // 10240 bytes

describe('Compile Test', () => {
    test('should compile and be within maximum code limit', () => {
        const code = readFileSync(Context.ContractPath, 'utf8');
        const compiler = new SmartC({ language: 'C', sourceCode: code });
        const compiled = compiler.compile();
        const machinedata = compiled.getMachineCode();
        const codeSize = machinedata.ByteCode.length / 2;
        expect(machinedata).toBeDefined();
        expect(codeSize).toBeLessThanOrEqual(MAX_CODE_SIZE);
    });
});
```

### Fee gate test
```ts
test('should register FEE_TOO_LOW error when amount is insufficient', () => {
    const testbed = new SimulatorTestbed(BootstrapScenario)
        .loadContract(Context.ContractPath, DefaultRequiredInitializers)
        .runScenario();

    testbed.sendTransactionAndGetResponse([{
        sender: Context.SenderAccount1,
        recipient: Context.ThisContract,
        amount: 1n,   // way below usageFee
        messageArr: [Context.Methods.SomeAction, 1n],
    }]);

    const errors = testbed.getContractMap().filter(m => m.k1 === 99n);
    expect(errors.some(e => e.value === 5n)).toBe(true); // ERROR_CODE_FEE_TOO_LOW
});
```

### Paused contract test
```ts
test('should refund sender when contract is paused', () => {
    const testbed = new SimulatorTestbed(BootstrapScenario)
        .loadContract(Context.ContractPath, DefaultRequiredInitializers)
        .runScenario();

    // Pause
    testbed.sendTransactionAndGetResponse([{
        sender: Context.CreatorAccount,
        recipient: Context.ThisContract,
        amount: Context.ActivationFee,
        messageArr: [Context.Methods.SetContractPaused, 1n],
    }]);

    // Attempt action while paused
    const amount = 5_0000_0000n;
    testbed.sendTransactionAndGetResponse([{
        sender: Context.SenderAccount1,
        recipient: Context.ThisContract,
        amount: Context.ActivationFee + amount,
        messageArr: [Context.Methods.SomeAction, 1n],
    }]);

    // Verify full refund
    const refundTx = testbed.getTransactions()
        .filter(tx => tx.recipient === Context.SenderAccount1).at(-1);
    expect(refundTx?.amount).toBe(Context.ActivationFee + amount);
});
```

### Time-based test
```ts
test('should allow action after cooldown expires', () => {
    const testbed = new SimulatorTestbed(BootstrapScenario)
        .loadContract(Context.ContractPath, {
            ...DefaultRequiredInitializers,
            coolDownInBlocks: 10n,
        })
        .runScenario();

    attack({ testbed, signa: 100n });
    const hpAfterFirst = getCurrentHitpoints(testbed)!;

    timeLapse({ testbed, blocks: 5n });    // still in cooldown
    attack({ testbed, signa: 100n });
    expect(getCurrentHitpoints(testbed)).toBe(hpAfterFirst); // no change

    timeLapse({ testbed, blocks: 6n });    // now past cooldown
    attack({ testbed, signa: 100n });
    expect(getCurrentHitpoints(testbed)).toBeLessThan(hpAfterFirst); // damage dealt
});
```

---

## Known Limitations

- **No parallel test execution** — testbed is stateful; always set `sequence.concurrent: false`.
- **Negative bigints in messageArr** — there is a known bug in bigint-to-AT-word conversion for negative values. Use `test.skip` and document with a `FIXME` comment.
- **`getWeakRandomNumber` is weaker** in the simulator than on mainnet — don't write probabilistic tests that assert exact RNG outcomes. Instead, run many iterations and assert distributions (e.g. "at least 20% debuffed out of 50 runs").
- **Multi-contract tests with `getCreatorOf`** — there is a known bug when loading multiple contracts: `rewardNftId` (set via `getCreatorOf`) may read as `0n`. Use `test.skip` for affected tests.
- **No real-network testing** — testbed only simulates; deploy to testnet for final verification.
- **Code size limit** — AT machine code is limited to `40 × 256 = 10240` bytes per contract. Always include the compile sanity test.
