# SmartC Low-Level API Reference

The low-level API exposes the raw AT pseudo-registers and opcodes directly.
Enable with `#include APIFunctions` (or `#include fixedAPIFunctions` for the
`fixed`-typed variants). The high-level built-ins in `api-highlevel.md` are
sufficient for most contracts — reach for these only when you need fine-grained
control over the A/B registers, hash operations, or opcodes not wrapped by the
high-level API.

```c
#include APIFunctions         // enable standard low-level functions
#include fixedAPIFunctions    // enable fixed-point variants (F_ prefix)
```

## Table of Contents
1. [A/B Pseudo-Registers](#ab-pseudo-registers)
2. [Hash & Signature Operations](#hash--signature-operations)
3. [Block & Transaction Info](#block--transaction-info)
4. [Balance & Send Operations](#balance--send-operations)
5. [Map & Asset Operations](#map--asset-operations)
6. [Fixed-Point Variants (F_ prefix)](#fixed-point-variants-f_-prefix)

---

## A/B Pseudo-Registers

The AT virtual machine has two 256-bit pseudo-registers, **A** and **B**, each
split into four 64-bit slots (A1–A4, B1–B4). Many low-level operations read from
or write to these registers implicitly.

### Get / Set individual slots

```c
long Get_A1(void);  long Get_A2(void);  long Get_A3(void);  long Get_A4(void);
long Get_B1(void);  long Get_B2(void);  long Get_B3(void);  long Get_B4(void);

void Set_A1(long);  void Set_A2(long);  void Set_A3(long);  void Set_A4(long);
void Set_B1(long);  void Set_B2(long);  void Set_B3(long);  void Set_B4(long);
```

### Set two slots at once (one instruction)

```c
void Set_A1_A2(long);   // sets A1 and A2
void Set_A3_A4(long);   // sets A3 and A4
void Set_B1_B2(long);   // sets B1 and B2
void Set_B3_B4(long);   // sets B3 and B4
```

### Clear, copy, swap

```c
void Clear_A(void);
void Clear_B(void);
void Clear_A_And_B(void);

void Copy_A_From_B(void);   // A ← B
void Copy_B_From_A(void);   // B ← A
void Swap_A_and_B(void);

long Check_A_Is_Zero(void);   // returns 1 if all of A is zero
long Check_B_Is_Zero(void);
long Check_A_Equals_B(void);  // returns 1 if A == B
```

### Arithmetic & bitwise on full 256-bit registers

```c
void OR_A_with_B(void);   void OR_B_with_A(void);
void AND_A_with_B(void);  void AND_B_with_A(void);
void XOR_A_with_B(void);  void XOR_B_with_A(void);

void Add_A_To_B(void);    void Add_B_To_A(void);
void Sub_A_From_B(void);  void Sub_B_From_A(void);
void Mul_A_By_B(void);    void Mul_B_By_A(void);
void Div_A_By_B(void);    void Div_B_By_A(void);
```

---

## Hash & Signature Operations

All hash functions read from A and write to B (or compare against B).

```c
void MD5_A_To_B(void);               // MD5(A) → B
long Check_MD5_A_With_B(void);       // returns 1 if MD5(A) == B

void HASH160_A_To_B(void);           // RIPEMD160(SHA256(A)) → B
long Check_HASH160_A_With_B(void);   // returns 1 if HASH160(A) == B

void SHA256_A_To_B(void);            // SHA256(A) → B
long Check_SHA256_A_With_B(void);    // returns 1 if SHA256(A) == B

// Verify that the signature stored in B matches the public key in A
// for the message loaded into the register context.
long Check_Sig_B_With_A(void);       // returns 1 if signature valid
```

**Typical signature verification flow:**
```c
// 1. Load the expected public key into A
Set_A1_A2(pubKeyHigh);
Set_A3_A4(pubKeyLow);
// 2. Load the signature into B (e.g. from message fields)
Set_B1(sig1); Set_B2(sig2); Set_B3(sig3); Set_B4(sig4);
// 3. Verify
if (Check_Sig_B_With_A() == 0) {
    // invalid signature
}
```

> For most signature use cases, prefer the high-level `checkSignature()` built-in
> which wraps this flow.

---

## Block & Transaction Info

```c
// Current block timestamp (block height encoded as timestamp).
long Get_Block_Timestamp(void);

// Timestamp of the block in which this contract was created.
long Get_Creation_Timestamp(void);

// Timestamp of the previous block.
long Get_Last_Block_Timestamp(void);

// Load the hash of the last block into A.
void Put_Last_Block_Hash_In_A(void);

// Load the generalised signature (GSig) of the last block into A.
// Used as the entropy source for getWeakRandomNumber().
void Put_Last_Block_GSig_In_A(void);

// Advance the tx iterator to the first tx at or after 'timestamp'.
// Equivalent to the high-level getNextTxFromBlockheight().
void A_To_Tx_After_Timestamp(long timestamp);

// After A_To_Tx_After_Timestamp, read properties of the tx now in A:
long Get_Type_For_Tx_In_A(void);
long Get_Amount_For_Tx_In_A(void);
long Get_Timestamp_For_Tx_In_A(void);
long Get_Random_Id_For_Tx_In_A(void);

// Load the 32-byte message from the tx in A into B.
void Message_From_Tx_In_A_To_B(void);

// Load the sender address of the tx in A into B.
void B_To_Address_Of_Tx_In_A(void);

// Load this contract's creator address into B.
void B_To_Address_Of_Creator(void);

// Returns this contract's code hash ID.
long Get_Code_Hash_Id(void);

// Load asset IDs attached to the tx in A into B.
void B_To_Assets_Of_Tx_In_A(void);
```

---

## Balance & Send Operations

```c
// Current Signa balance (NQT) of this contract.
long Get_Current_Balance(void);

// Balance as of the previous block (before this activation).
long Get_Previous_Balance(void);

// Send 'amount' NQT to the address currently stored in B.
void Send_To_Address_In_B(long amount);

// Send entire current balance to address in B.
void Send_All_To_Address_In_B(void);

// Send previous-block balance to address in B.
void Send_Old_To_Address_In_B(void);

// Send the value in register A (as amount) to address in B.
void Send_A_To_Address_In_B(void);

// Add 'minutes' to a 'timestamp' value. Returns adjusted timestamp.
long Add_Minutes_To_Timestamp(long timestamp, long minutes);
```

---

## Map & Asset Operations

```c
// Read map value for keys currently in A1 (key1) and A2 (key2).
// Returns the stored value.
long Get_Map_Value_Keys_In_A(void);

// Write current A3/A4 value to map at keys A1 (key1) / A2 (key2).
void Set_Map_Value_Keys_In_A(void);

// Issue a new asset using values set in registers. Returns asset ID.
long Issue_Asset(void);

// Mint asset using values set in registers.
void Mint_Asset(void);

// Distribute to asset holders using values set in registers.
void Distribute_To_Asset_Holders(void);

// Returns holder count for asset / minimum quantity set in registers.
long Get_Asset_Holders_Count(void);

// Returns circulating supply for asset set in registers.
long Get_Asset_Circulating(void);

// Returns activation fee of the contract (NQT).
long Get_Activation_Fee(void);
```

> The high-level asset functions (`issueAsset`, `mintAsset`, `distributeToHolders`,
> etc.) wrap these register-based operations and are much easier to use. Prefer
> them unless you need to hand-tune register layout for gas reasons.

---

## Fixed-Point Variants (F_ prefix)

Enable with `#include fixedAPIFunctions`. These mirror the standard functions
but use the `fixed` type for Signa values (1.0 = 1 Signa, up to 8 decimals).

```c
// A/B register access as fixed
fixed F_Get_A1(void);  fixed F_Get_A2(void);
fixed F_Get_A3(void);  fixed F_Get_A4(void);
fixed F_Get_B1(void);  fixed F_Get_B2(void);
fixed F_Get_B3(void);  fixed F_Get_B4(void);

void F_Set_A1(fixed);  void F_Set_A2(fixed);
void F_Set_A3(fixed);  void F_Set_A4(fixed);
void F_Set_B1(fixed);  void F_Set_B2(fixed);
void F_Set_B3(fixed);  void F_Set_B4(fixed);

// Transaction amounts as fixed
fixed F_Get_Amount_For_Tx_In_A(void);

// Balance as fixed
fixed F_Get_Current_Balance(void);
fixed F_Get_Previous_Balance(void);

// Send fixed amount to address in B
void F_Send_To_Address_In_B(fixed);

// Map / asset helpers as fixed
fixed F_Get_Map_Value_Keys_In_A(void);
fixed F_Get_Activation_Fee(void);
fixed F_Get_Asset_Circulating(void);
```
