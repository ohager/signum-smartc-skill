# CIYAM AT Bytecode & Inline Assembly Reference

This file documents raw CIYAM AT bytecode mnemonics and hex opcodes — the layer
**below** SmartC. Use it when:

- Reading verbose assembly output to understand or count generated instructions
- Writing `asm { }` inline assembly blocks for opcodes not exposed by the C API
- Decoding machine code bytes during deep debugging

For **C-level** access to low-level AT functions (`Get_A1()`, `MD5_A_To_B()`,
`Check_Sig_B_With_A()`, etc.), see `api-lowlevel.md` instead.

---

## Virtual Machine Resources

The CIYAM AT virtual machine is a 64-bit stack machine with:

| Resource | Description |
|---|---|
| **Data memory** | Array of `long` variables (persistent). Size = DataPages × 32 longs |
| **Code memory** | Read-only bytecode (set at deploy) |
| **User stack** | Call stack for SmartC function calls |
| **Code stack** | Return addresses |
| **Register A** | 256-bit (4 × long: A1..A4) general pseudo-register |
| **Register B** | 256-bit (4 × long: B1..B4) general pseudo-register |
| **PC** | Program counter |
| **Step fee** | 0.001 Signa per executed instruction |

---

## Inline Assembly Syntax

```c
asm {
    OPCODE [@varname | #literal | $addr]...
}
```

- `@varname` — reference to a declared C variable (resolved to its data address)
- `#literal` — immediate 64-bit value
- `$addr` — raw numeric data address (avoid; use `@` instead)
- Labels: `label:` followed by opcodes

---

## Core Data Opcodes

```asm
; Move / Load / Store
SET_VAL  @dst, #value       ; dst = literal value
SET_DAT  @dst, @src         ; dst = src
CLR_DAT  @dst               ; dst = 0
INC_DAT  @dst               ; dst++
DEC_DAT  @dst               ; dst--
ADD_DAT  @dst, @src         ; dst += src
SUB_DAT  @dst, @src         ; dst -= src
MUL_DAT  @dst, @src         ; dst *= src
DIV_DAT  @dst, @src         ; dst /= src (integer)
MOD_DAT  @dst, @src         ; dst %= src
NEG_DAT  @dst               ; dst = -dst
NOT_DAT  @dst               ; dst = ~dst

; Bitwise
AND_DAT  @dst, @src         ; dst &= src
OR_DAT   @dst, @src         ; dst |= src
XOR_DAT  @dst, @src         ; dst ^= src
SHL_DAT  @dst, @src         ; dst <<= src (src = shift amount)
SHR_DAT  @dst, @src         ; dst >>= src (arithmetic)

; Indirect (pointer-based)
SET_IND  @dst, @ptr         ; dst = memory[@ptr]  (dereference)
SET_IDX  @dst, @base, @idx  ; dst = memory[@base + @idx]
PSH_DAT  @src               ; push src onto user stack
POP_DAT  @dst               ; pop from user stack into dst
```

---

## Jump / Branch Opcodes

```asm
JMP_SUB  :label             ; call subroutine (pushes return addr)
RET_SUB                     ; return from subroutine

JMP_ADR  :label             ; unconditional jump

BZR_DAT  @var, :label       ; branch if var == 0
BNZ_DAT  @var, :label       ; branch if var != 0
BGT_DAT  @a, @b, :label     ; branch if a > b
BLT_DAT  @a, @b, :label     ; branch if a < b
BGE_DAT  @a, @b, :label     ; branch if a >= b
BLE_DAT  @a, @b, :label     ; branch if a <= b
BEQ_DAT  @a, @b, :label     ; branch if a == b
BNE_DAT  @a, @b, :label     ; branch if a != b
```

---

## API (Machine-Code Function) Opcodes

These are the low-level equivalents of the high-level C API.
Each takes its inputs from/sets outputs to the A and B registers.

### Transaction APIs

```asm
EXT_FUN_RET_DAT  GET_BLOCK_TIMESTAMP   @dst
;  dst = current block height

EXT_FUN_RET      GET_NEXT_TX_FROM_BLOCK @dst
;  dst = next tx ID in queue (0 if empty)

EXT_FUN_DAT_2    GET_AMOUNT_FOR_TX_IN_A  @txId
;  A = txId → sets B1 = amount in NQT

EXT_FUN_DAT_2    GET_TYPE_FOR_TX_IN_A    @txId
;  A = txId → sets B1 = type, B2 = subtype

EXT_FUN_RET_DAT_2 GET_NEXT_TX_DETAILS  @txId
;  Get next tx; sets A1=txId, A2=amount, A3=sender, A4=timestamp
```

### A/B Register Manipulation

```asm
; Set A fields individually
EXT_FUN_DAT   SET_A1  @val      ; A1 = val
EXT_FUN_DAT   SET_A2  @val
EXT_FUN_DAT   SET_A3  @val
EXT_FUN_DAT   SET_A4  @val

; Set B fields
EXT_FUN_DAT   SET_B1  @val
EXT_FUN_DAT   SET_B2  @val
EXT_FUN_DAT   SET_B3  @val
EXT_FUN_DAT   SET_B4  @val

; Read A fields into variables
EXT_FUN_RET   GET_A1  @dst
EXT_FUN_RET   GET_A2  @dst
EXT_FUN_RET   GET_A3  @dst
EXT_FUN_RET   GET_A4  @dst

; Read B fields
EXT_FUN_RET   GET_B1  @dst
EXT_FUN_RET   GET_B2  @dst
EXT_FUN_RET   GET_B3  @dst
EXT_FUN_RET   GET_B4  @dst

; Copy A ↔ B
EXT_FUN       COPY_A_FROM_B
EXT_FUN       COPY_B_FROM_A
EXT_FUN       SWAP_A_AND_B
EXT_FUN       OR_A_WITH_B
EXT_FUN       AND_A_WITH_B
EXT_FUN       XOR_A_WITH_B
EXT_FUN       NEGATE_A
EXT_FUN       NOT_A
```

### Contract / Account APIs

```asm
EXT_FUN_RET   GET_CREATOR_OF     @dst  ; dst = creator account ID of this contract
EXT_FUN_RET   GET_CURRENT_BALANCE @dst ; dst = contract balance in NQT
EXT_FUN_DAT   GET_CODE_HASH_OF   @acct ; A = code hash of @acct
```

### Map APIs

```asm
; Set map[A1][A2] = A3
EXT_FUN_DAT_2  SET_MAP_VALUE_KEYS_IN_A  @key1, @key2
; (sets A1=key1, A2=key2 first, then write A3)

; Get map[A1][A2] → B1
EXT_FUN_DAT_2  GET_MAP_VALUE_KEYS_IN_A  @key1, @key2
; result in B1 after call
```

### Crypto APIs

```asm
EXT_FUN       HASH_A_TO_B_SHA256      ; B = SHA256(A)
EXT_FUN_RET   CHECK_A_EQUALS_B  @dst  ; dst = 1 if A==B, else 0
EXT_FUN_DAT   CHECK_SIG_B_WITH_A @tx  ; A=pubkey hash, @tx=txId; returns 1/0 in B1
```

### Send APIs

```asm
; Send NQT amount to account
; A1 = amount, A2 = recipient
EXT_FUN       SEND_A_TO_ADDRESS_IN_B  ; B1 = recipient, A1 = amount

; Send full balance
EXT_FUN_DAT   SEND_ALL_CLEAR_A  @recipient

; Send message (A = 4 fields, B1 = recipient)
EXT_FUN       SEND_A_AND_B_TO_ADDRESS_IN_B ; 256-bit message to B1
```

---

## AT Machine Code Format

The machine code is a sequence of variable-length instructions encoded as:

```
[opcode byte] [operand bytes...]
```

Key opcodes (hex):
| Opcode | Mnemonic | Length |
|---|---|---|
| `0x01` | SET_VAL | 13 |
| `0x02` | SET_DAT | 9 |
| `0x03` | CLR_DAT | 5 |
| `0x04` | INC_DAT | 5 |
| `0x05` | DEC_DAT | 5 |
| `0x06` | ADD_DAT | 9 |
| `0x07` | SUB_DAT | 9 |
| `0x08` | MUL_DAT | 9 |
| `0x09` | DIV_DAT | 9 |
| `0x0a` | BOR_DAT | 9 |
| `0x0b` | AND_DAT | 9 |
| `0x0c` | XOR_DAT | 9 |
| `0x0d` | NOT_DAT | 5 |
| `0x0e` | SET_IND | 9 |
| `0x0f` | SET_IDX | 13 |
| `0x1a` | JMP_ADR | 5 |
| `0x1b` | BZR_DAT | 10 |
| `0x1e` | BNZ_DAT | 10 |
| `0x1f` | BGT_DAT | 14 |
| `0x20` | BLT_DAT | 14 |
| `0x21` | BGE_DAT | 14 |
| `0x22` | BLE_DAT | 14 |
| `0x23` | BEQ_DAT | 14 |
| `0x24` | BNE_DAT | 14 |
| `0x32` | JMP_SUB | 5 |
| `0x33` | RET_SUB | 1 |
| `0x35` | EXT_FUN | 3 |
| `0x36` | EXT_FUN_DAT | 7 |
| `0x37` | EXT_FUN_RET | 7 |
| `0x38` | EXT_FUN_DAT_2 | 11 |
| `0x3a` | EXT_FUN_RET_DAT | 11 |
| `0x3b` | EXT_FUN_RET_DAT_2 | 15 |
| `0x7f` | STP_IMD | 1 | (stop / sleep until next activation) |
| `0xfe` | FIN_IMD | 1 | (finish permanently / destroy) |

---

## AT Function Codes (EXT_FUN numeric IDs)

These are the 16-bit function IDs used in `EXT_FUN*` opcodes:

| ID | Name | Description |
|---|---|---|
| `0x0001` | GET_BLOCK_TIMESTAMP | Current block height |
| `0x0002` | GET_NEXT_TX_FROM_BLOCK | Next tx ID from queue |
| `0x0003` | GET_TYPE_FOR_TX_IN_A | Tx type; A1=txId |
| `0x0004` | GET_AMOUNT_FOR_TX_IN_A | Amount; A1=txId → B1 |
| `0x0005` | GET_TIMESTAMP_FOR_TX_IN_A | Block; A1=txId → B1 |
| `0x0006` | GET_RANDOM_ID_FOR_TX_IN_A | Random from tx |
| `0x0007` | MESSAGE_FROM_TX_IN_A_TO_B | Copy tx message to B; A1=txId |
| `0x0008` | B_TO_ADDRESS_OF_TX_IN_A | Sender address; A1=txId → B1 |
| `0x0009` | B_TO_ADDRESS_OF_CREATOR | Creator → B1 |
| `0x0100` | GET_CURRENT_BALANCE | Contract balance → B1 |
| `0x0101` | GET_PREVIOUS_BALANCE | Balance before this activation → B1 |
| `0x0102` | SEND_TO_ADDRESS_IN_B | Send A1 NQT to B1 |
| `0x0103` | SEND_ALL_TO_ADDRESS_IN_B | Send full balance to B1 |
| `0x0104` | SEND_OLD_TO_ADDRESS_IN_B | Send previous balance to B1 |
| `0x0105` | SEND_A_TO_ADDRESS_IN_B | Send A as message to B1 |
| `0x0106` | ADD_A_TO_B | B += A (256-bit) |
| `0x0107` | ADD_B_TO_A | A += B |
| `0x0108` | SUB_A_FROM_B | B -= A |
| `0x0109` | SUB_B_FROM_A | A -= B |
| `0x010a` | MUL_A_BY_B | B *= A (lo 256-bit) |
| `0x010b` | MUL_B_BY_A | A *= B |
| `0x010c` | DIV_A_BY_B | B /= A |
| `0x010d` | DIV_B_BY_A | A /= B |
| `0x010e` | OR_A_WITH_B | A |= B |
| `0x010f` | OR_B_WITH_A | B |= A |
| `0x0110` | AND_A_WITH_B | A &= B |
| `0x0111` | AND_B_WITH_A | B &= A |
| `0x0112` | XOR_A_WITH_B | A ^= B |
| `0x0113` | XOR_B_WITH_A | B ^= A |
| `0x0114` | NEGATE_A | A = -A |
| `0x0115` | NEGATE_B | B = -B |
| `0x0116` | NOT_A | A = ~A |
| `0x0117` | NOT_B | B = ~B |
| `0x0120` | SWAP_A_AND_B | Swap A and B |
| `0x0122` | COPY_A_FROM_B | A = B |
| `0x0123` | COPY_B_FROM_A | B = A |
| `0x0200` | CHECK_A_EQUALS_B | Returns 1 in B1 if A==B |
| `0x0201` | CHECK_A_IS_ZERO | Returns 1 if A==0 |
| `0x0202` | CHECK_B_IS_ZERO | Returns 1 if B==0 |
| `0x0203` | CHECK_A_IS_NOT_ZERO | Returns 1 if A!=0 |
| `0x0204` | CHECK_B_IS_NOT_ZERO | |
| `0x0300` | GET_A1..GET_A4 | Read A1-A4 into data var |
| `0x0304` | GET_B1..GET_B4 | Read B1-B4 |
| `0x0308` | SET_A1..SET_A4 | Write data var to A1-A4 |
| `0x030c` | SET_A1_A2 | Set A1+A2 from two data vars |
| `0x030d` | SET_A3_A4 | |
| `0x030e` | SET_B1_B2 | |
| `0x030f` | SET_B3_B4 | |
| `0x0310` | SET_B1..SET_B4 | Write data var to B1-B4 |
| `0x0401` | HASH_A_TO_B_SHA256 | B = SHA256(A) |
| `0x0404` | CHECK_SIG_B_WITH_A | Verify sig |
| `0x0500` | MAP APIs | see map section |
| `0x0600` | ISSUE_ASSET | Mint token (A = params) |
| `0x0601` | MINT_ASSET | Mint additional supply |
| `0x0602` | DIST_TO_ASSET_HOLDERS | Dividend distribution |
| `0x0700` | GET_CODE_HASH_OF | A1=acct → B1=codeHash |

---

For gas optimisation guidance and instruction-counting techniques, see the
**Gas Optimization** section of `language.md`.
