# SmartC Low-Level API Reference

The low-level API exposes the AT machine's API calls as C functions that work
on the A/B pseudo-registers directly. The high-level built-ins in
`api-highlevel.md` are sufficient for most contracts — reach for these only
when you need fine-grained control over the registers, the hash operations, or
something the built-ins do not wrap.

```c
#include APIFunctions         // standard low-level functions
#include fixedAPIFunctions    // fixed-point variants (F_ prefix)
```

Both includes are independent: `fixedAPIFunctions` works without
`APIFunctions`. Each takes an optional value `true`/`false`/`1`/`0`
(default `true`); the last line wins.

Sources of truth: `APITableTemplate` / `fixedAPITableTemplate` in
`smartc-signum-compiler` (`dist/shaper/templates.js`) for names and
signatures; `API_MICROCODE` in `smartc-signum-simulator` (`dist/api.js`) and
the compiler's `builtinToAsm.js` for register semantics.

**Cost:** every API call costs **10 steps**, against 1 for a regular
instruction. An API call takes at most two arguments; everything else goes
through the registers.

## Table of Contents
1. [A/B Pseudo-Registers](#ab-pseudo-registers)
2. [Hash & Signature Operations](#hash--signature-operations)
3. [Blocks & Timestamps](#blocks--timestamps)
4. [Incoming Transactions](#incoming-transactions)
5. [Balances & Sending](#balances--sending)
6. [Contracts & Maps](#contracts--maps)
7. [Assets](#assets)
8. [Fixed-Point Variants (F_ prefix)](#fixed-point-variants-f_-prefix)
9. [Built-in → API mapping](#built-in--api-mapping)

---

## A/B Pseudo-Registers

The AT machine has two 256-bit pseudo-registers, **A** and **B**, each split
into four 64-bit slots (A1–A4, B1–B4).

### Get / Set individual slots

```c
long Get_A1(void);  long Get_A2(void);  long Get_A3(void);  long Get_A4(void);
long Get_B1(void);  long Get_B2(void);  long Get_B3(void);  long Get_B4(void);

void Set_A1(long);  void Set_A2(long);  void Set_A3(long);  void Set_A4(long);
void Set_B1(long);  void Set_B2(long);  void Set_B3(long);  void Set_B4(long);
```

### Set two slots in one call

Half the cost of two single `Set_` calls.

```c
void Set_A1_A2(long a1, long a2);
void Set_A3_A4(long a3, long a4);
void Set_B1_B2(long b1, long b2);
void Set_B3_B4(long b3, long b4);
```

### Clear, copy, swap, compare

```c
void Clear_A(void);
void Clear_B(void);
void Clear_A_And_B(void);

void Copy_A_From_B(void);     // A = B
void Copy_B_From_A(void);     // B = A
void Swap_A_and_B(void);

long Check_A_Is_Zero(void);   // 1 if all four slots of A are zero
long Check_B_Is_Zero(void);
long Check_A_Equals_B(void);  // 1 if all four slots are equal
```

### Bitwise (slot by slot)

```c
void OR_A_with_B(void);   // A = A | B
void OR_B_with_A(void);   // B = B | A
void AND_A_with_B(void);  // A = A & B
void AND_B_with_A(void);  // B = B & A
void XOR_A_with_B(void);  // A = A ^ B
void XOR_B_with_A(void);  // B = B ^ A
```

### 256-bit arithmetic

The four slots are read as one unsigned 256-bit number, A1/B1 being the least
significant.

```c
void Add_A_To_B(void);    // B = A + B
void Add_B_To_A(void);    // A = A + B
void Sub_A_From_B(void);  // B = B - A
void Sub_B_From_A(void);  // A = A - B
void Mul_A_By_B(void);    // B = A * B
void Mul_B_By_A(void);    // A = A * B
void Div_A_By_B(void);    // B = A / B   (B == 0: nothing changes)
void Div_B_By_A(void);    // A = B / A   (A == 0: nothing changes)
```

---

## Hash & Signature Operations

```c
void MD5_A_To_B(void);               // MD5 of A1–A2 (16 bytes) → B1–B2
long Check_MD5_A_With_B(void);       // 1 if MD5(A1–A2) == B1–B2

void HASH160_A_To_B(void);           // RIPEMD-160 of A (32 bytes) → B1, B2, low 32 bits of B3
long Check_HASH160_A_With_B(void);   // 1 if RIPEMD-160(A) == B1, B2, low 32 bits of B3

void SHA256_A_To_B(void);            // SHA-256 of A (32 bytes) → B1–B4
long Check_SHA256_A_With_B(void);    // 1 if SHA-256(A) == B

long Check_Sig_B_With_A(void);       // 1 if the signature is valid
```

`Check_Sig_B_With_A` verifies that an account signed a message, with the
signature stored in a transaction's message:

| Register | Content |
|---|---|
| A1 | transaction id holding the signature |
| A2 | message page where the signature starts (it spans `page` and `page+1`) |
| A3 | account id of the signer |
| B2–B4 | the signed message (B1 is not used) |

```c
Set_A1_A2(txId, page);
Set_A3(signerId);
Set_B2(message2);
Set_B3_B4(message3, message4);
if (Check_Sig_B_With_A() == 0) {
    // invalid signature
}
```

> Prefer the built-in `checkSignature(message2, message3, message4, txId, page, accountId)`,
> which emits exactly this sequence. The simulator does not implement signature
> checks and always returns 0.

---

## Blocks & Timestamps

An AT timestamp is `blockheight << 32` plus the transaction's index in the
block, so `timestamp >> 32` is the block height.

```c
long Get_Block_Timestamp(void);        // current block
long Get_Creation_Timestamp(void);     // block the contract was created in
long Get_Last_Block_Timestamp(void);   // previous block

void Put_Last_Block_Hash_In_A(void);   // hash of the previous block → A
void Put_Last_Block_GSig_In_A(void);   // generation signature of the previous block → A
                                       // getWeakRandomNumber() returns A2 after this call

// Returns 'timestamp' advanced by minutes / 4 blocks (4-minute blocks).
long Add_Minutes_To_Timestamp(long timestamp, long minutes);
```

---

## Incoming Transactions

```c
// Clears A, then puts the id of the first transaction to this contract
// after 'timestamp' in A1 (0 if there is none).
// getNextTx() and getNextTxFromBlockheight() are built on this call.
void A_To_Tx_After_Timestamp(long timestamp);
```

The following read the transaction whose id is in **A1**. The `Get_` ones
return -1 if A1 is not a valid transaction.

```c
long Get_Type_For_Tx_In_A(void);
long Get_Timestamp_For_Tx_In_A(void);

// A2: asset id, or 0 for Signa. For Signa the contract's activation
// amount is already subtracted.
long Get_Amount_For_Tx_In_A(void);

// Random number derived from the transaction. Only available 15 blocks
// after the transaction was included; called earlier, the contract sleeps
// until then.
long Get_Random_Id_For_Tx_In_A(void);

// A2: page number (0-based). Loads 32 bytes of the message into B1–B4;
// missing bytes read as 0, an invalid transaction clears B.
void Message_From_Tx_In_A_To_B(void);

// Sender → B1 (B2–B4 cleared).
void B_To_Address_Of_Tx_In_A(void);

// Ids of up to four assets sent with the transaction → B1–B4 (unused = 0).
void B_To_Assets_Of_Tx_In_A(void);
```

---

## Balances & Sending

```c
// B2: asset id, or 0 for the Signa balance (NQT).
long Get_Current_Balance(void);

// Signa balance from before the current run.
long Get_Previous_Balance(void);

// B1: account id, B2: asset id or 0 for Signa.
long Get_Account_Balance(void);
```

All sends go to the account in **B1**.

```c
// B2: asset id, or 0 to send Signa.
// B3: when sending an asset, Signa (NQT) to send along with it.
// 'amount' is NQT for Signa, otherwise the asset quantity. Capped to the
// balance; zero or negative amounts send nothing.
void Send_To_Address_In_B(long amount);

void Send_All_To_Address_In_B(void);   // entire Signa balance
void Send_Old_To_Address_In_B(void);   // balance from before this run, capped to the current one

// Sends the 32 bytes in A as a MESSAGE (not an amount). Several calls to
// the same recipient in one run are joined into one message.
void Send_A_To_Address_In_B(void);
```

---

## Contracts & Maps

```c
// B2: contract id, or 0 for this contract. Creator → B1, rest of B cleared.
void B_To_Address_Of_Creator(void);

// B2: contract id, or 0 for this contract. 0 if the contract is unknown.
long Get_Code_Hash_Id(void);
long Get_Activation_Fee(void);   // NQT

// A1: key1, A2: key2, A3: contract id or 0 for this contract.
// Returns 0 for a missing entry.
long Get_Map_Value_Keys_In_A(void);

// A1: key1, A2: key2, A4: value (A3 is not used). This contract's map only.
void Set_Map_Value_Keys_In_A(void);
```

---

## Assets

```c
// A1–A2: asset name (up to 10 characters), B1: decimals.
// Returns the new asset id; quantity starts at zero.
long Issue_Asset(void);

// B1: quantity, B2: asset id. Only works for assets this contract issued.
void Mint_Asset(void);

// B1: minimum quantity a holder needs, B2: asset whose holders receive,
// A1: Signa (NQT) to distribute, A3: asset to distribute (0 = none),
// A4: quantity of that asset. Shares are proportional to holdings;
// amounts are capped to what the contract holds.
void Distribute_To_Asset_Holders(void);

// B1: minimum quantity, B2: asset id.
long Get_Asset_Holders_Count(void);

// B2: asset id. Returns 0 for asset id 0.
long Get_Asset_Circulating(void);
```

> The high-level built-ins (`issueAsset`, `mintAsset`, `distributeToHolders`,
> `getAssetHoldersCount`, `getAssetCirculating`) set these registers for you.

---

## Fixed-Point Variants (F_ prefix)

Enable with `#include fixedAPIFunctions`. Same API calls, but the value is
read or written as `fixed` (1.0 = 1_0000_0000). The register inputs are the
same as for the `long` version.

```c
fixed F_Get_A1(void);  fixed F_Get_A2(void);  fixed F_Get_A3(void);  fixed F_Get_A4(void);
fixed F_Get_B1(void);  fixed F_Get_B2(void);  fixed F_Get_B3(void);  fixed F_Get_B4(void);

void F_Set_A1(fixed);  void F_Set_A2(fixed);  void F_Set_A3(fixed);  void F_Set_A4(fixed);
void F_Set_B1(fixed);  void F_Set_B2(fixed);  void F_Set_B3(fixed);  void F_Set_B4(fixed);

fixed F_Get_Amount_For_Tx_In_A(void);
fixed F_Get_Current_Balance(void);
fixed F_Get_Previous_Balance(void);
fixed F_Get_Account_Balance(void);
void  F_Send_To_Address_In_B(fixed amount);
fixed F_Get_Map_Value_Keys_In_A(void);
fixed F_Get_Activation_Fee(void);
```

There are no `F_` versions of the two-slot setters or of
`Get_Asset_Circulating`.

---

## Built-in → API mapping

Useful when reading verbose assembly output or hand-tuning register use.

| Built-in | API calls |
|---|---|
| `getNextTx()` / `getNextTxFromBlockheight()` | `A_To_Tx_After_Timestamp`, `Get_A1`, `Get_Timestamp_For_Tx_In_A` |
| `getAmount(tx)` / `getQuantity(tx, asset)` | `Set_A1_A2`, `Get_Amount_For_Tx_In_A` |
| `getSender(tx)` | `Set_A1`, `B_To_Address_Of_Tx_In_A`, `Get_B1` |
| `readMessage(tx, page, buf)` | `Message_From_Tx_In_A_To_B` |
| `readAssets(tx, buf)` | `Set_A1`, `B_To_Assets_Of_Tx_In_A` |
| `sendAmount(amount, to)` | `Set_B1_B2`, `Send_To_Address_In_B` |
| `sendQuantity` / `sendQuantityAndAmount` | `Set_B1_B2`, `Set_B3`, `Send_To_Address_In_B` |
| `sendBalance(to)` | `Set_B1`, `Send_All_To_Address_In_B` |
| `sendMessage` / `sendAmountAndMessage` | `Send_A_To_Address_In_B` |
| `getCreator()` / `getCreatorOf(id)` | `Set_B2`, `B_To_Address_Of_Creator`, `Get_B1` |
| `getCodeHashOf(id)` | `Set_B2`, `Get_Code_Hash_Id` |
| `getActivationOf(id)` | `Set_B2`, `Get_Activation_Fee` |
| `getCurrentBalance()` / `getAssetBalance(asset)` | `Set_B2`, `Get_Current_Balance` |
| `getAccountBalance(id)` / `getAccountQuantity(id, asset)` | `Set_B1_B2`, `Get_Account_Balance` |
| `getMapValue` / `getExtMapValue` | `Set_A1_A2`, `Set_A3`, `Get_Map_Value_Keys_In_A` |
| `setMapValue` | `Set_A1_A2`, `Set_A4`, `Set_Map_Value_Keys_In_A` |
| `issueAsset` | `Set_A1_A2`, `Set_B1`, `Issue_Asset` |
| `mintAsset` | `Set_B1_B2`, `Mint_Asset` |
| `distributeToHolders` | `Set_B1_B2`, `Set_A1`, `Set_A3_A4`, `Distribute_To_Asset_Holders` |
| `checkSignature` | `Set_A1_A2`, `Set_A3`, `Set_B2`, `Set_B3_B4`, `Check_Sig_B_With_A` |
| `getWeakRandomNumber()` | `Put_Last_Block_GSig_In_A`, `Get_A2` |
