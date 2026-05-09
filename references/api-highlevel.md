# SmartC High-Level API Reference

All functions are built into SmartC — no imports needed.
Many functions have a `Fx` variant that accepts/returns `fixed` (8-decimal Signa)
instead of `long` (NQT). Use whichever fits the calculation.

## Table of Contents
1. [Transaction Loop](#transaction-loop)
2. [Receiving Transactions](#receiving-transactions)
3. [Sending Transactions](#sending-transactions)
4. [Blockchain & Contract Info](#blockchain--contract-info)
5. [KKV Maps](#kkv-maps)
6. [Assets](#assets)
7. [Message Signature Verification](#message-signature-verification)
8. [Math Utilities](#math-utilities)
9. [Type Casting Utilities](#type-casting-utilities)

---

## Transaction Loop

```c
// Returns next incoming tx ID; returns 0 when queue is empty.
// Advances internal counter _counterTimestamp on each call.
long getNextTx();

// Returns tx ID of first tx at or after 'blockheight'.
// Also sets _counterTimestamp — can be combined with getNextTx.
long getNextTxFromBlockheight(long blockheight);
```

**Rewinding the loop** — to re-visit a tx later:
```c
long saved = getNextTx();
long rewindPoint = _counterTimestamp - 1;
// ... later:
_counterTimestamp = rewindPoint;
saved = getNextTx();  // same tx again
```

---

## Receiving Transactions

```c
// Block height at which 'transaction' was included. Returns 4294967295 if invalid.
long getBlockheight(long transaction);

// Signa amount (NQT) sent with 'transaction' minus activation amount.
// Returns -1 if invalid.
long getAmount(long transaction);
fixed getAmountFx(long transaction);

// Sender account ID. Returns 0 if invalid.
long getSender(long transaction);

// Transaction type (see Signum API getConstants for type codes). Returns -1 if invalid.
long getType(long transaction);

// Read 32-byte message at 'page' into 'buffer' (must be long[4]).
// Page 0 is first page. Fills with zeros if invalid or no message.
void readMessage(long transaction, long page, long *buffer);

// Read first 'length' longs (0–4) from page 0 into 'buffer'. Remainder filled with zeros.
void readShortMessage(long transaction, long *buffer, long length);

// Read up to 4 asset IDs from 'transaction' into 'buffer' (must be long[4]).
// Remaining slots filled with zeros.
void readAssets(long transaction, long *buffer);

// QNT quantity of 'assetId' transferred in 'transaction'.
// Returns -1 if invalid tx; 0 if asset not present.
long getQuantity(long transaction, long assetId);
```

---

## Sending Transactions

Sends are enqueued and batched per block. Multiple sends to the same account
in the same block are merged (amounts summed, messages concatenated up to 31 pages).

### Signa

```c
// Enqueue Signa send. Halts (no gas) if amount > balance.
void sendAmount(long amount, long accountId);
void sendAmountFx(fixed amount, long accountId);

// Send entire Signa balance. Contract halts after.
void sendBalance(long accountId);

// Shorthand for sendAmount + sendMessage in one optimised instruction.
void sendAmountAndMessage(long amount, long *buffer, long accountId);
void sendAmountAndMessageFx(fixed amount, long *buffer, long accountId);
```

### Messages

```c
// Send 4-long (32-byte) message. Buffer must be long[4].
void sendMessage(long *buffer, long accountId);

// Send first 'length' longs only (cheaper when message is short). 0 <= length <= 4.
void sendShortMessage(long *buffer, long length, long accountId);
```

### Assets (tokens)

```c
// Transfer 'quantity' QNT of 'assetId'. Sends all if quantity > balance.
// Same-asset sends in one block are merged into one tx.
void sendQuantity(long quantity, long assetId, long accountId);

// Transfer asset + Signa together in one tx. No send if quantity == 0.
void sendQuantityAndAmount(long quantity, long assetId, long amount, long accountId);
void sendQuantityAndAmountFx(long quantity, long assetId, fixed amount, long accountId);
```

> Asset transfers cannot carry messages. Two different assets sent in the same
> block produce two separate transactions.

---

## Blockchain & Contract Info

```c
// Current block height at instruction execution time.
long getCurrentBlockheight();

// Pseudo-random number from last block signature. NOT cryptographically secure.
// Return can be negative — use right-shift to make positive: rnd >> 1
long getWeakRandomNumber();

// Creator account ID of this contract.
long getCreator();

// Creator account ID of 'contractId'. Returns 0 if not a contract.
long getCreatorOf(long contractId);

// Code hash of 'contractId'. Pass 0 to get own code hash.
// Returns 0 if not a contract. Use for cross-contract authentication.
long getCodeHashOf(long contractId);

// Minimum activation amount of 'contractId' (NQT). Pass 0 for own contract.
long getActivationOf(long contractId);
fixed getActivationOfFx(long contractId);

// Current Signa balance of this contract at instruction execution time.
long getCurrentBalance();
fixed getCurrentBalanceFx();

// Contract's balance of 'assetId' at instruction execution time.
// Pass assetId = 0 to get Signa balance (same as getCurrentBalance).
long getAssetBalance(long assetId);

// Signa balance of any 'accountId' as of the LAST block (not current execution).
long getAccountBalance(long accountId);
fixed getAccountBalanceFx(long accountId);

// QNT balance of 'assetId' owned by 'accountId' as of the LAST block.
// Includes quantities in sell orders.
long getAccountQuantity(long accountId, long assetId);
```

---

## KKV Maps

Every contract has a built-in persistent store: two `long` keys map to one
`long` (or `fixed`) value. Unset entries default to `0`. Deletion is not
supported — set to `0` to clear.

```
contract[key1][key2] → value
```

```c
void setMapValue(long key1, long key2, long value);
void setMapValueFx(long key1, long key2, fixed value);

long getMapValue(long key1, long key2);          // own map; 0 if unset
fixed getMapValueFx(long key1, long key2);

// Read any contract's map — contractId is the THIRD argument
long getExtMapValue(long key1, long key2, long contractId);
fixed getExtMapValueFx(long key1, long key2, long contractId);
```

### Why two keys?

A constant `key1` acts as a table/namespace; a variable `key2` acts as a row
key. One contract can maintain unlimited independent tables with no schema:

```c
#define MAP_BALANCES   1
#define MAP_COOLDOWNS  2
#define MAP_ERRORS    10   // choose any key that fits your namespace

setMapValue(MAP_BALANCES,  userId,  amount);
setMapValue(MAP_COOLDOWNS, userId,  blockHeight);
setMapValue(MAP_ERRORS,    txId,    errorCode);
```

Both keys can also be fully dynamic — e.g. `map[groupId][itemId]` — enabling
tree-like structures at runtime.

### Cross-contract reads

Any contract can read any other contract's map — no callback or oracle needed:

```c
// Read a permission level stored in a registry contract:
long level = getExtMapValue(MAP_KEY_PERMISSIONS, currentTx.sender, REGISTRY_CONTRACT_ID);

// Read a value from a gamemaster registry:
long hpTokenId = getExtMapValue(MAP_CHAR_HP_TOKEN, characterId, GAMEMASTER_REGISTRY);
```

**Design principle:** treat your KKV map as a public API. Use stable, documented
`key1` namespaces and never reuse a key for a different purpose after deployment.

---

## Assets

```c
// Issue a new asset. Returns its ID. Costs 150 Signa (contract halts until funded).
// name1 = first 8 chars, name2 = chars 9–10 (set to 0 if name ≤ 8 chars).
// decimals: 0–8.
long issueAsset(long name1, long name2, long decimals);

// Mint 'quantity' QNT of 'assetId'. Contract must be the issuer.
// Minted quantity is immediately available. No negative quantity.
void mintAsset(long quantity, long assetId);

// Distribute Signa and/or asset to all holders of 'holdersAsset' with
// at least 'holdersAssetMinQuantity'. Both amountToDistribute and
// quantityToDistribute can be distributed in the same call.
// Treasury accounts and sell-order quantities are excluded.
void distributeToHolders(
    long holdersAssetMinQuantity,
    long holdersAsset,
    long amountToDistribute,
    long assetToDistribute,
    long quantityToDistribute
);
void distributeToHoldersFx(
    long holdersAssetMinQuantity,
    long holdersAsset,
    fixed amountToDistribute,
    long assetToDistribute,
    long quantityToDistribute
);

// Number of accounts holding at least 'minimumQuantity' of 'assetId'.
// Excludes quantities in sell orders.
long getAssetHoldersCount(long minimumQuantity, long assetId);

// Total circulating supply of 'assetId'.
// Excludes treasury accounts, sell orders, and burn address (account 0).
long getAssetCirculating(long assetId);
```

---

## Message Signature Verification

```c
// Verify that 'accountId' signed the message at 'page'/'page+1' of 'transaction'
// with content [message2, message3, message4].
// Returns 1 if valid, 0 otherwise.
long checkSignature(
    long message2,
    long message3,
    long message4,
    long transaction,
    long page,
    long accountId
);
```

---

## Math Utilities

```c
// Multiply m1 × m2 with 128-bit precision (no overflow), then divide by div.
// The compiler may use this automatically in optimisation passes.
long mdv(long m1, long m2, long div);

// base ^ (expBy1e8 / 1e8)  — exponent uses 8-decimal fixed-point representation.
// Returns 0 on undefined result, negative base, or overflow.
// Examples: sqrt(49) = pow(49, 5000_0000)   5^4 = pow(5, 4_0000_0000)
long pow(long base, long expBy1e8);

// Same as pow but exponent is a fixed value.
// Examples: sqrt(49) = powf(49, 0.5)   5^4 = powf(5, 4.0)
long powf(long base, fixed exp);
```

---

## Type Casting Utilities

```c
// Copy binary value from source to destination without type conversion.
// Useful for passing fixed values to API functions expecting long.
void memcopy(void *destination, void *source);

// Binary cast fixed → long (no value change, just reinterprets bits).
// Example: bcftol(0.5) returns 5000_0000
long bcftol(fixed value);

// Binary cast long → fixed (no value change, just reinterprets bits).
// Example: bcltof(5000_0000) returns 0.5
fixed bcltof(long value);
```
