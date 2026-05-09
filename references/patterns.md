# SmartC Patterns Reference

A library of optional, battle-tested idioms for Signum SmartC contracts.
Use any pattern that fits the contract's requirements — none is mandatory.

## Table of Contents
1. [Multi-Page Batch Message Reads](#multi-page-batch-message-reads)
2. [Permission System](#permission-system)
3. [Error Registration](#error-registration)
4. [Cross-Contract Authentication](#cross-contract-authentication)
5. [Post-Loop Downstream Trigger](#post-loop-downstream-trigger)
6. [Event System (Event Listener Pattern)](#event-system-event-listener-pattern)
7. [Token as HP / State (Asset Balance Pattern)](#token-as-hp--state-asset-balance-pattern)
8. [Token Decimal Math](#token-decimal-math)
9. [Initializable Params + TESTBED Overrides](#initializable-params--testbed-overrides)
10. [Flag Encoding in Map Values](#flag-encoding-in-map-values)
11. [Unrolled Asset Loops (4-slot AT limit)](#unrolled-asset-loops-4-slot-at-limit)
12. [Inline Helper Functions](#inline-helper-functions)
13. [Sending Text Messages](#sending-text-messages)
14. [getActivationOf + Cached Activation Fee](#getactivationof--cached-activation-fee)
15. [Self Contract ID Bootstrap](#self-contract-id-bootstrap)
16. [Burn Address](#burn-address)

---

## Multi-Page Batch Message Reads

AT messages are 32 bytes (4 × long) per page. To pass more than 3 arguments,
use additional pages starting at page 1.

**Message layout convention:**
```
page 0: [METHOD_CODE, arg1, arg2, arg3]
page 1: [id_0, id_1, id_2, id_3]
page 2: [id_4, id_5, id_6, id_7]
...
```

**Reading pattern (ceiling division loop):**
```c
#define ITEMS_PER_PAGE 4

void processBatch(long itemCount) {
    long items[4];
    long page = 1;
    for (long i = 0; i < (itemCount + 4) / 4; ++i) {
        readMessage(currentTx.txId, page, items);
        _processItem(items[0]);
        _processItem(items[1]);
        _processItem(items[2]);
        _processItem(items[3]);
        ++page;
    }
}

void _processItem(long itemId) {
    if (itemId == 0) return;  // always guard zero — last page may be partial
    // ...
}
```

**Key rule:** Always guard `if (itemId == 0) return;` inside the per-item
helper because the last page may have fewer than 4 valid IDs.

---

## Permission System

Store permission levels in a map keyed by account ID. Level `0` (the map default)
means no access; higher values grant more rights. Define as many levels as the
contract needs.

```c
// ---- Define levels to match contract needs (0 = no access is mandatory) ----
#define PERMISSION_NONE  0
// #define PERMISSION_USER  1
// #define PERMISSION_ADMIN 2  (or whatever levels make sense)

// ---- Choose a map key in your namespace ----
#define MAP_KEY_PERMISSIONS  6

// Lookup helper — cache the result locally if called more than once in a function
long _getSenderPermission() {
    return getMapValue(MAP_KEY_PERMISSIONS, currentTx.sender);
}

// Permission gate — use == PERMISSION_NONE to exclude everyone with no rights,
// or >= REQUIRED_LEVEL for threshold-based checks:
void protectedAction(long param) {
    if (_getSenderPermission() == PERMISSION_NONE) {
        _registerError(ERROR_CODE_NO_PERMISSION);
        return;
    }
    // ...
}

// On deploy: seed initial permissions
setMapValue(MAP_KEY_PERMISSIONS, owner, PERMISSION_ADMIN);
```

**Changing permissions at runtime** — gate the setter on creator or the highest
role level; clamp the incoming value to the valid range:

```c
void setPermission(long accountId, long level) {
    if (currentTx.sender != getCreator() && _getSenderPermission() < PERMISSION_ADMIN) {
        _registerError(ERROR_CODE_NO_PERMISSION);
        return;
    }
    if (level < PERMISSION_NONE) level = PERMISSION_NONE;
    if (level > PERMISSION_ADMIN) level = PERMISSION_ADMIN;
    setMapValue(MAP_KEY_PERMISSIONS, accountId, level);
}
```

---

## Error Registration

Never halt execution on error. Record the error and `return` or `continue`.

```c
#define MAP_KEY_ERRORS 99  // conventional key — choose a key that doesn't clash with your domain

void _registerError(long errorCode) {
    setMapValue(MAP_KEY_ERRORS, currentTx.txId, errorCode);
}
```

This lets external observers query `map[99][txId]` to see what went wrong.
The contract keeps running; no Signa is locked.

**Standard error codes (use these across all contracts for consistency):**
```c
#define ERROR_CODE_NO_STOCK                  1
#define ERROR_CODE_INVALID_OR_EMPTY_LOT      2
#define ERROR_CODE_NO_PERMISSION             3
#define ERROR_CODE_ALREADY_DONE              4
#define ERROR_CODE_FEE_TOO_LOW               5
#define ERROR_CODE_WRONG_ACTION              6
#define ERROR_CODE_INVALID_ITEM              7
#define ERROR_CODE_NOT_AUTHORIZED_BY_REGISTRY 8
#define ERROR_CODE_NOT_INITIALIZED           9
```

---

## Cross-Contract Authentication

Use `getCodeHashOf()` to verify that a sending contract is the genuine expected
implementation, not a spoofed account.

```c
#define AUTHORIZED_CONTRACT_CODE_HASH 12345678901234567890

// In the tx processing loop:
long codeHash = getCodeHashOf(currentTx.sender);
if (codeHash != AUTHORIZED_CONTRACT_CODE_HASH) {
    sendAmount(currentTx.amount, currentTx.sender); // refund impostor
    continue;
}
// Now safe to process
```

**Registry-based auth** (dynamic — code hash stored in a registry contract):
```c
// From character_contract: construct code hash stored in gamemaster registry
long senderIsConstruct() {
    long codehash = getExtMapValue(GAMEMASTER_MAP_KEY1_CONSTRUCT_HASH, 0, GAMEMASTER_REGISTRY);
    return getCodeHashOf(currentTx.sender) == codehash;
}
```

**Always add `#program codeHashId`** to the source after deploying, so OTHER
contracts can reference it for authentication.

---

## Post-Loop Downstream Trigger

Cross-contract activation calls are batched and sent ONCE after the tx loop,
using an accumulated counter. Never send a downstream activation per incoming tx
(gas cost explosion).

```c
// Accumulate in main():
long acknowledgedCount = 0;
while ((currentTx.txId = getNextTx()) != 0) {
    // ...
    acknowledgedCount += processReceipt(...);
}

// Trigger downstream ONCE per activation:
if (acknowledgedCount > 0 && downstreamContractId != 0) {
    long args[4];
    args[0] = acknowledgedCount;
    args[1] = owner;
    sendAmountAndMessage(downstreamActivationFee, args, downstreamContractId);
}
```

---

## Event System (Event Listener Pattern)

Contracts emit structured events to an optional `eventListenerAccountId`.
This decouples the game/app backend from blockchain polling.

```c
long eventListenerAccountId;
long eventBuffer[4];

void sendEvent(long *buffer) {
    // Only send if listener configured, and not caused by the listener itself
    if (eventListenerAccountId != 0 && currentTx.sender != eventListenerAccountId) {
        sendMessage(buffer, eventListenerAccountId);
    }
}

// Typed event emitters — use numeric event codes:
#define EVENT_HIT     601
#define EVENT_HEALED  602
#define EVENT_DEFEATED 666

inline void sendEventHit(long damage, long currentHp) {
    eventBuffer[0] = EVENT_HIT;
    eventBuffer[1] = currentTx.sender;
    eventBuffer[2] = damage;
    eventBuffer[3] = currentHp - damage;
    sendEvent(eventBuffer);
}

// Setting the listener (creator only):
void setEventListener(long accountId) {
    eventListenerAccountId = accountId;
}
```

**Convention:** event code goes in `buffer[0]`, payload in `buffer[1..3]`.
Use unique numeric codes per event type. Document them in a `#define` block.

---

## Token as HP / State (Asset Balance Pattern)

Use an on-chain token (asset) to represent mutable game state that external
contracts and wallets can observe. HP is the canonical example.

```c
long hpTokenId;
long maxHp;

void init() {
    // Issue a new asset at deploy; supply starts at 0
    hpTokenId = issueAsset(name, "", 0);
    // ...
}

long getCurrentHitpoints() {
    return getAssetBalance(hpTokenId);  // contract's own balance = current HP
}

// "Damage" = burn HP tokens by sending them to attackers
sendQuantity(damage, hpTokenId, attacker);  // attacker receives HP tokens as proof

// "Heal" = mint new HP tokens back (up to maxHp)
mintAsset(healAmount, hpTokenId);

// At defeat: distribute remaining HP tokens as proportional reward
distributeToHolders(1, hpTokenId, prizePool, 0, 0);
```

This makes HP transparent on-chain, enables holder-based reward distribution,
and lets external tools query HP without any special API.

---

## Token Decimal Math

Tokens can have 0–6 decimal places. All quantities are in raw QNT units.
Use a `pow10` helper and a stored decimals map to handle fractional tokens.

```c
#define MAP_TOKEN_DECIMALS_INFO 3
#define MAP_SET_FLAG            1024  // distinguishes "set to 0" from "not set"

void setTokenDecimals(long tokenId, long decimals) {
    if (decimals >= 0 && decimals <= 6) {
        // OR in the flag so we can distinguish "decimals=0" from "not registered"
        setMapValue(MAP_TOKEN_DECIMALS_INFO, tokenId, decimals + MAP_SET_FLAG);
    }
}

long getTokenDecimals(long tokenId, long shouldNotify) {
    long val = getMapValue(MAP_TOKEN_DECIMALS_INFO, tokenId);
    if (val >= MAP_SET_FLAG) return val - MAP_SET_FLAG;
    if (shouldNotify) {
        messageBuffer[] = "Unregistered Token detected!";
        sendMessage(messageBuffer, getCreator());
    }
    return 0;
}

// Fixed pow10 lookup — decimals capped at 6 so this is exhaustive:
long pow10(long exp) {
    switch (exp) {
        case 0: return 1;       case 1: return 10;
        case 2: return 100;     case 3: return 1000;
        case 4: return 10000;   case 5: return 100000;
        case 6: return 1000000;
        default: return 1;
    }
}

// Usage:
long decimals = getTokenDecimals(tokenId, 0);
long effectiveQty = quantity / pow10(decimals);  // whole units
long fractional   = quantity % pow10(decimals);  // sub-unit remainder
```

---

## Initializable Params + TESTBED Overrides

Parameters the deployer sets at deploy time are declared as plain `long` at
file scope, then overridden via `const` in the `#ifdef TESTBED` block.

```c
// Deployment parameters — set via transaction or pre-seeded in testbed
long owner;
long partnerContractId;
long usageFee;

// Testbed overrides — makes automated testing possible without deploying
#ifdef TESTBED
    const owner               = TESTBED_owner;
    const partnerContractId   = TESTBED_partnerContractId;
    const usageFee            = TESTBED_usageFee;
#endif

// Defensive defaults at deploy time (top-level init code):
if (usageFee == 0) {
    usageFee = 5_0000_0000;  // 0.5 Signa default
}
```

**Rule:** Every `long` that a deployer must configure gets a `TESTBED_` override.
`#ifdef SIMULATOR` uses hardcoded numeric values for quick manual testing.

---

## Flag Encoding in Map Values

When 0 is a valid data value AND "not set" also maps to 0 (the default), you
cannot distinguish them. Solution: OR in a sentinel flag constant.

```c
#define MAP_SET_FLAG 1024

// Store: value + flag
setMapValue(myKey, id, realValue + MAP_SET_FLAG);

// Read: check for flag, subtract it
long raw = getMapValue(myKey, id);
if (raw >= MAP_SET_FLAG) {
    long realValue = raw - MAP_SET_FLAG;
    // use realValue...
} else {
    // key was never set
}
```

Choose a flag value well outside your valid data range. `1024` works when
values are 0–6 (decimal places). Pick larger values for wider ranges.

---

## Unrolled Asset Loops (4-slot AT limit)

AT transactions support at most 4 attached assets. Always unroll asset processing
loops rather than using a `for` loop — it's more gas-efficient and matches the
fixed 4-slot structure.

```c
struct TX {
    long txId;
    long sender;
    long message[4];
    long assetIds[4];   // ← readAssets fills this
} currentTx;

// After readAssets(currentTx.txId, currentTx.assetIds):
void processAllAssets() {
    if (currentTx.assetIds[0] != 0) handleAsset(currentTx.assetIds[0]);
    if (currentTx.assetIds[1] != 0) handleAsset(currentTx.assetIds[1]);
    if (currentTx.assetIds[2] != 0) handleAsset(currentTx.assetIds[2]);
    if (currentTx.assetIds[3] != 0) handleAsset(currentTx.assetIds[3]);
}

// Refund all assets (full refund pattern):
void refundAllAssets() {
    if (currentTx.assetIds[0] != 0)
        sendQuantity(getQuantity(currentTx.txId, currentTx.assetIds[0]), currentTx.assetIds[0], currentTx.sender);
    if (currentTx.assetIds[1] != 0)
        sendQuantity(getQuantity(currentTx.txId, currentTx.assetIds[1]), currentTx.assetIds[1], currentTx.sender);
    if (currentTx.assetIds[2] != 0)
        sendQuantity(getQuantity(currentTx.txId, currentTx.assetIds[2]), currentTx.assetIds[2], currentTx.sender);
    if (currentTx.assetIds[3] != 0)
        sendQuantity(getQuantity(currentTx.txId, currentTx.assetIds[3]), currentTx.assetIds[3], currentTx.sender);
}
```

---

## Inline Helper Functions

Mark small, frequently-called functions `inline` to avoid call overhead.
Particularly useful for functions called inside the main tx loop or on every
attacker round.

```c
inline void refundPowerUpsWithPenalty() { ... }
inline long calculateSignaDamage() { ... }
inline long shouldCounterAttack(long rawDamage) { ... }

// Also use inline for event emitters — they're called often and are small:
inline void sendEventHit(long damage, long currentHp) { ... }
```

---

## Sending Text Messages

An AT message is 4 × 8-byte longs = **32 bytes per send**. The compiler packs
ASCII characters into longs 8 chars at a time, left-to-right:

```
"DEFEATED! You lo"  →  [long0="DEFEATED", long1="! You lo", long2="se.     ", long3=0]
  chars 0–7            chars 8–15            chars 16–23         (zero-padded)
```

```c
long messageBuffer[4];

messageBuffer[] = "DEFEATED! You lose.";
sendMessage(messageBuffer, recipient);          // sends all 4 longs

messageBuffer[] = "COOLDOWN!";
sendShortMessage(messageBuffer, 2, recipient);  // sends only first 2 longs (cheaper)
```

**`sendMessage` vs `sendShortMessage`:**
- `sendMessage(buffer, recipient)` — always sends all 4 longs (32 bytes)
- `sendShortMessage(buffer, n, recipient)` — sends only first `n` longs; use when text fits in fewer than 4 longs to save gas

**Limitations — read before using:**

1. **32-character hard cap.** 4 longs × 8 chars = 32 bytes maximum per message. There is no multi-page text send.

2. **Compile-time string literals only.** `buffer[] = "..."` is the only way to put text into a buffer. The compiler resolves the packing statically — you cannot build or concatenate strings at runtime. There is no `sprintf`, no number-to-string, no dynamic text.

3. **ASCII only.** Each byte maps to a 7-bit ASCII character. No Unicode, no UTF-8.

4. **Zero-padded, no null terminator.** Strings shorter than the sent longs are zero-padded. Receivers interpret trailing zero bytes as end-of-text by convention, not by protocol.

5. **No numbers in text.** If you need to communicate a numeric value alongside a label, send it as a separate `long` field rather than trying to stringify it.

6. **Not indexed or searchable on-chain.** Messages are stored as raw transaction data. Off-chain tools must decode the bytes; the blockchain has no text search.

---

## getActivationOf + Cached Activation Fee

Before calling a downstream contract, cache its activation fee at deploy time
rather than querying it on every tx.

```c
long certContractActivationFee = 0;

// In top-level init code:
if (certContractId != 0) {
    certContractActivationFee = getActivationOf(certContractId);
}

// When updating the contract reference (setter function):
void setCertContract(long newId) {
    if (currentTx.sender == getCreator()) {
        certContractId = newId;
        certContractActivationFee = getActivationOf(newId);  // refresh cache
    } else {
        _registerError(ERROR_CODE_NO_PERMISSION);
    }
}
```

---

## Self Contract ID Bootstrap

SmartC has no built-in `getContractId()` for the contract to know its own
address. Use a one-shot creator-callable setter after deployment.

```c
long selfContractId;  // 0 until bootstrapped

void setSelfContractId(long id) {
    // One-shot: can only be set once (prevents re-assignment after bootstrap)
    if (currentTx.sender != getCreator()) {
        _registerError(ERROR_CODE_NO_PERMISSION);
        return;
    }
    if (selfContractId != 0) return;  // already set
    selfContractId = id;
}

// Then guard any logic that needs it:
if (selfContractId == 0) {
    _registerError(ERROR_CODE_NOT_INITIALIZED);
    return;
}
```

**Deployment workflow:**
1. Deploy contract → blockchain assigns contract ID
2. Creator calls `setSelfContractId(assignedId)` once
3. Contract can now reference its own ID (e.g. for registry authorization checks)

---

## Burn Address

Signum uses account ID `0` as the canonical burn address.
Sending Signa or tokens to `0` permanently removes them from supply.

```c
// Burn Signa:
sendAmount(burnAmount, 0);

// Burn tokens:
sendQuantity(quantity, tokenId, 0);

// Useful pattern: burn residual balance on contract destruction
sendAmount(getCurrentBalance(), 0);
```
