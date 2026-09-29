# CIYAM AT Bytecode & Inline Assembly Reference

This file documents the AT assembly that SmartC generates and accepts in
`asm { }` blocks — the layer **below** the C language. Use it when:

- Reading verbose assembly output to understand or count generated instructions
- Writing `asm { }` inline assembly for things the C language does not express
- Decoding machine code bytes during deep debugging

For **C-level** access to the API functions (`Get_A1()`, `MD5_A_To_B()`,
`Check_Sig_B_With_A()`, etc.), see `api-lowlevel.md` instead.

Source of truth: `opCodeTable` and `apiCodeTable` in `smartc-signum-compiler`
(`dist/assembler/assembler.js`). `tests/assembler-reference.test.ts` checks
the tables below against it. Runtime behaviour follows `smartc-signum-simulator`.

---

## Virtual Machine Resources

| Resource | Description |
|---|---|
| **Data memory** | Array of 64-bit `long` cells (persistent). One data page = 32 cells |
| **Code memory** | Read-only bytecode, set at deploy |
| **User stack** | Values pushed with `PSH` / popped with `POP` — SmartC passes function arguments here |
| **Code stack** | Return addresses for `JSR` / `RET` |
| **Register A / B** | 256-bit pseudo-registers (A1–A4, B1–B4), only reachable through `FUN` calls |
| **PCS** | Restart point that `FIN` / `FIZ` return to (set by `PCS`) |
| **Step fee** | 0.001 Signa per step — every instruction is 1 step, every `FUN` API call 10 steps |

---

## Inline Assembly Syntax

```c
long myVar, result;
asm {
    SET @myVar #0000000000000064
    ADD @result $myVar
}
```

| Operand | Meaning |
|---|---|
| `@var` | the cell being **written** (destination) |
| `$var` | the value being **read** (source) |
| `#0123456789abcdef` | 64-bit literal — always **exactly 16 lowercase hex digits** (`#64` does not assemble) |
| `:label` | jump target; declare it on its own line as `label:` |
| `$($ptr)` / `@($ptr)` | indirect read / write through the address in `$ptr` |

- Operands are separated by **spaces, no commas**.
- The mnemonic is the short form (`SET`, `ADD`, `JMP`, …). Names such as
  `SET_VAL` or `ADD_DAT` are the assembler's internal table names and are
  **not** accepted in source.
- C variables are referenced by name. Struct members and locals use the
  mangled names you see in verbose assembly (e.g. `currentTx_sender`,
  `main_i`).
- Labels must not collide with labels SmartC generates (`__if1_endif`, …);
  pick a distinctive prefix.

---

## Data Instructions

```asm
SET @dst #0000000000000064   ; dst = literal
SET @dst $src                ; dst = src
SET @dst $($ptr)             ; dst = memory[ptr]
SET @dst $($ptr + $idx)      ; dst = memory[ptr + idx]
SET @($ptr) $src             ; memory[ptr] = src
SET @($ptr + $idx) $src      ; memory[ptr + idx] = src
CLR @dst                     ; dst = 0
INC @dst                     ; dst++
DEC @dst                     ; dst--
PSH $src                     ; push src onto the user stack
POP @dst                     ; pop from the user stack into dst
```

## Arithmetic & Bitwise

All two-operand forms are `OP @dst $src` and compute `dst = dst OP src`.

```asm
ADD @dst $src     ; dst += src
SUB @dst $src     ; dst -= src
MUL @dst $src     ; dst *= src
DIV @dst $src     ; dst /= src   signed, truncates; divisor 0 is FATAL
MOD @dst $src     ; dst %= src   signed; divisor 0 is FATAL
MDV @dst $a $b    ; dst = dst * a / b with a 128-bit intermediate; b == 0 gives 0
POW @dst $exp     ; dst = dst ^ (exp / 1e8)  — exponent is fixed-point (2.0 = 200000000)
BOR @dst $src     ; dst |= src   (the mnemonic is BOR, not OR)
AND @dst $src     ; dst &= src
XOR @dst $src     ; dst ^= src
NOT @dst          ; dst = ~dst
SHL @dst $n       ; dst <<= n    n clamped to 0..63
SHR @dst $n       ; dst >>= n    LOGICAL shift (zeros in at the top), n clamped to 0..63
```

There is no `NEG`: negate with `CLR` + `SUB`, or `NOT` + `INC`.

## Jumps & Branches

Branch targets are stored as a 1-byte relative offset (-128…+127). When a
target is farther away, the assembler inverts the branch and adds a `JMP`
(5 more bytes), so hand-written code does not need to care — but it shows up
in the code size.

```asm
JMP :label             ; unconditional jump
JSR :label             ; call subroutine (return address → code stack)
RET                    ; return from subroutine

BZR $a :label          ; if a == 0
BNZ $a :label          ; if a != 0
BGT $a $b :label       ; if a >  b   (signed)
BLT $a $b :label       ; if a <  b
BGE $a $b :label       ; if a >= b
BLE $a $b :label       ; if a <= b
BEQ $a $b :label       ; if a == b
BNE $a $b :label       ; if a != b
```

## Execution Control

```asm
SLP              ; sleep; resume at the next instruction on the next block
SLP $blocks      ; sleep that many blocks (values < 1 count as 1)   — C: sleep
STP              ; stop; resume at the next instruction on the next activation — C: halt
STZ $a           ; STP if a == 0
FIN              ; finish; next activation restarts at PCS            — C: exit
FIZ $a           ; FIN if a == 0
PCS              ; set the restart point to the next instruction (start of main())
ERR :label       ; install :label as error handler (does not jump now) — C: void catch()
NOP              ; no operation
```

Without an `ERR` handler, a fatal fault (division by zero, stack
under/overflow, out of gas) marks the contract **dead** permanently.

## API Calls (`FUN`)

The return slot comes **first**, before the function name. At most two
arguments; everything else goes through the A/B registers.

```asm
FUN clear_A                    ; no return, no argument
FUN set_A1 $a                  ; one argument
FUN set_A1_A2 $a $b            ; two arguments
FUN @r get_A1                  ; return value into r
FUN @r add_Minutes_to_Timestamp $ts $min   ; return value and two arguments
```

Each function has exactly one valid form, given by its opcode in the table
below; calling it with another form, or with an unknown name, fails. The
function names are the assembler's — mostly lower-case, unlike the C
wrappers in `api-lowlevel.md` (`get_A1` here, `Get_A1()` in C).

### Directives

These appear in generated assembly and are not instructions:

```asm
^declare myVar                          ; reserve a data cell
^const SET @n5 #0000000000000005        ; initial value, set at deploy (no code)
^program name MyContract                ; #program metadata
^comment any text                       ; kept in the output
```

---

## Opcode Table

`Size` is the encoded length in bytes, which is what counts against the code
pages. Every instruction costs 1 step, except the six `FUN` forms (10 steps).

| Opcode | Mnemonic | Internal name | Size |
|---|---|---|---|
| `0x01` | `SET @a #literal` | SET_VAL | 13 |
| `0x02` | `SET @a $b` | SET_DAT | 9 |
| `0x03` | `CLR @a` | CLR_DAT | 5 |
| `0x04` | `INC @a` | INC_DAT | 5 |
| `0x05` | `DEC @a` | DEC_DAT | 5 |
| `0x06` | `ADD @a $b` | ADD_DAT | 9 |
| `0x07` | `SUB @a $b` | SUB_DAT | 9 |
| `0x08` | `MUL @a $b` | MUL_DAT | 9 |
| `0x09` | `DIV @a $b` | DIV_DAT | 9 |
| `0x0a` | `BOR @a $b` | BOR_DAT | 9 |
| `0x0b` | `AND @a $b` | AND_DAT | 9 |
| `0x0c` | `XOR @a $b` | XOR_DAT | 9 |
| `0x0d` | `NOT @a` | NOT_DAT | 5 |
| `0x0e` | `SET @a $($b)` | SET_IND | 9 |
| `0x0f` | `SET @a $($b + $c)` | SET_IDX | 13 |
| `0x10` | `PSH $a` | PSH_DAT | 5 |
| `0x11` | `POP @a` | POP_DAT | 5 |
| `0x12` | `JSR :label` | JMP_SUB | 5 |
| `0x13` | `RET` | RET_SUB | 1 |
| `0x14` | `SET @($a) $b` | IND_DAT | 9 |
| `0x15` | `SET @($a + $b) $c` | IDX_DAT | 13 |
| `0x16` | `MOD @a $b` | MOD_DAT | 9 |
| `0x17` | `SHL @a $b` | SHL_DAT | 9 |
| `0x18` | `SHR @a $b` | SHR_DAT | 9 |
| `0x19` | `POW @a $b` | POW_DAT | 9 |
| `0x1a` | `JMP :label` | JMP_ADR | 5 |
| `0x1b` | `BZR $a :label` | BZR_DAT | 6 |
| `0x1e` | `BNZ $a :label` | BNZ_DAT | 6 |
| `0x1f` | `BGT $a $b :label` | BGT_DAT | 10 |
| `0x20` | `BLT $a $b :label` | BLT_DAT | 10 |
| `0x21` | `BGE $a $b :label` | BGE_DAT | 10 |
| `0x22` | `BLE $a $b :label` | BLE_DAT | 10 |
| `0x23` | `BEQ $a $b :label` | BEQ_DAT | 10 |
| `0x24` | `BNE $a $b :label` | BNE_DAT | 10 |
| `0x25` | `SLP $a` | SLP_DAT | 5 |
| `0x26` | `FIZ $a` | FIZ_DAT | 5 |
| `0x27` | `STZ $a` | STZ_DAT | 5 |
| `0x28` | `FIN` | FIN_IMD | 1 |
| `0x29` | `STP` | STP_IMD | 1 |
| `0x2a` | `SLP` | SLP_IMD | 1 |
| `0x2b` | `ERR :label` | ERR_ADR | 5 |
| `0x2c` | `MDV @a $b $c` | MDV_DAT | 13 |
| `0x30` | `PCS` | SET_PCS | 1 |
| `0x32` | `FUN name` | EXT_FUN | 3 |
| `0x33` | `FUN name $a` | EXT_FUN_DAT | 7 |
| `0x34` | `FUN name $a $b` | EXT_FUN_DAT_2 | 11 |
| `0x35` | `FUN @r name` | EXT_FUN_RET | 7 |
| `0x36` | `FUN @r name $a` | EXT_FUN_RET_DAT | 11 |
| `0x37` | `FUN @r name $a $b` | EXT_FUN_RET_DAT_2 | 15 |
| `0x7f` | `NOP` | NOP | 1 |

---

## API Function Codes

The 16-bit code the assembler writes after the `FUN` opcode byte. `Opcode`
is the one `FUN` form each function accepts. Register semantics are in
`api-lowlevel.md` under the matching C name.

| Code | Name | Opcode |
|---|---|---|
| `0x0100` | get_A1 | `0x35` |
| `0x0101` | get_A2 | `0x35` |
| `0x0102` | get_A3 | `0x35` |
| `0x0103` | get_A4 | `0x35` |
| `0x0104` | get_B1 | `0x35` |
| `0x0105` | get_B2 | `0x35` |
| `0x0106` | get_B3 | `0x35` |
| `0x0107` | get_B4 | `0x35` |
| `0x0110` | set_A1 | `0x33` |
| `0x0111` | set_A2 | `0x33` |
| `0x0112` | set_A3 | `0x33` |
| `0x0113` | set_A4 | `0x33` |
| `0x0114` | set_A1_A2 | `0x34` |
| `0x0115` | set_A3_A4 | `0x34` |
| `0x0116` | set_B1 | `0x33` |
| `0x0117` | set_B2 | `0x33` |
| `0x0118` | set_B3 | `0x33` |
| `0x0119` | set_B4 | `0x33` |
| `0x011a` | set_B1_B2 | `0x34` |
| `0x011b` | set_B3_B4 | `0x34` |
| `0x0120` | clear_A | `0x32` |
| `0x0121` | clear_B | `0x32` |
| `0x0122` | clear_A_B | `0x32` |
| `0x0123` | copy_A_From_B | `0x32` |
| `0x0124` | copy_B_From_A | `0x32` |
| `0x0125` | check_A_Is_Zero | `0x35` |
| `0x0126` | check_B_Is_Zero | `0x35` |
| `0x0127` | check_A_equals_B | `0x35` |
| `0x0128` | swap_A_and_B | `0x32` |
| `0x0129` | OR_A_with_B | `0x32` |
| `0x012a` | OR_B_with_A | `0x32` |
| `0x012b` | AND_A_with_B | `0x32` |
| `0x012c` | AND_B_with_A | `0x32` |
| `0x012d` | XOR_A_with_B | `0x32` |
| `0x012e` | XOR_B_with_A | `0x32` |
| `0x0140` | add_A_to_B | `0x32` |
| `0x0141` | add_B_to_A | `0x32` |
| `0x0142` | sub_A_from_B | `0x32` |
| `0x0143` | sub_B_from_A | `0x32` |
| `0x0144` | mul_A_by_B | `0x32` |
| `0x0145` | mul_B_by_A | `0x32` |
| `0x0146` | div_A_by_B | `0x32` |
| `0x0147` | div_B_by_A | `0x32` |
| `0x0200` | MD5_A_to_B | `0x32` |
| `0x0201` | check_MD5_A_with_B | `0x35` |
| `0x0202` | HASH160_A_to_B | `0x32` |
| `0x0203` | check_HASH160_A_with_B | `0x35` |
| `0x0204` | SHA256_A_to_B | `0x32` |
| `0x0205` | check_SHA256_A_with_B | `0x35` |
| `0x0206` | Check_Sig_B_With_A | `0x35` |
| `0x0300` | get_Block_Timestamp | `0x35` |
| `0x0301` | get_Creation_Timestamp | `0x35` |
| `0x0302` | get_Last_Block_Timestamp | `0x35` |
| `0x0303` | put_Last_Block_Hash_In_A | `0x32` |
| `0x0304` | A_to_Tx_after_Timestamp | `0x33` |
| `0x0305` | get_Type_for_Tx_in_A | `0x35` |
| `0x0306` | get_Amount_for_Tx_in_A | `0x35` |
| `0x0307` | get_Timestamp_for_Tx_in_A | `0x35` |
| `0x0308` | get_Ticket_Id_for_Tx_in_A | `0x35` |
| `0x0309` | message_from_Tx_in_A_to_B | `0x32` |
| `0x030a` | B_to_Address_of_Tx_in_A | `0x32` |
| `0x030b` | B_to_Address_of_Creator | `0x32` |
| `0x030c` | Get_Code_Hash_Id | `0x35` |
| `0x030d` | B_To_Assets_Of_Tx_In_A | `0x32` |
| `0x0400` | get_Current_Balance | `0x35` |
| `0x0401` | get_Previous_Balance | `0x35` |
| `0x0402` | send_to_Address_in_B | `0x33` |
| `0x0403` | send_All_to_Address_in_B | `0x32` |
| `0x0404` | send_Old_to_Address_in_B | `0x32` |
| `0x0405` | send_A_to_Address_in_B | `0x32` |
| `0x0406` | add_Minutes_to_Timestamp | `0x37` |
| `0x0407` | Get_Map_Value_Keys_In_A | `0x35` |
| `0x0408` | Set_Map_Value_Keys_In_A | `0x32` |
| `0x0409` | Issue_Asset | `0x35` |
| `0x040a` | Mint_Asset | `0x32` |
| `0x040b` | Distribute_To_Asset_Holders | `0x32` |
| `0x040c` | Get_Asset_Holders_Count | `0x35` |
| `0x040d` | Get_Activation_Fee | `0x35` |
| `0x040e` | Put_Last_Block_GSig_In_A | `0x32` |
| `0x040f` | Get_Asset_Circulating | `0x35` |
| `0x0410` | Get_Account_Balance | `0x35` |

`get_Ticket_Id_for_Tx_in_A` is `Get_Random_Id_For_Tx_In_A()` in C.

---

For gas optimisation guidance and step-counting techniques, see the **Gas
Optimization** section of `language.md`, or run `scripts/gas-analysis.js` to compute
per-handler min/max cost automatically (it charges each `FUN` API call at 10 steps).
