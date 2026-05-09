# SmartC Language Reference

SmartC is a strict subset of C with blockchain-specific extensions.
The primary numeric types are `long` (64-bit signed integer) and `fixed`
(64-bit fixed-point with 8 decimal places). No heap, no stdlib.

## Table of Contents
1. [Types](#types)
2. [Variable Declaration](#variable-declaration)
3. [Operators](#operators)
4. [Control Flow](#control-flow)
5. [Contract Lifecycle](#contract-lifecycle)
6. [Functions](#functions)
7. [Arrays & Pointers](#arrays--pointers)
8. [Structs](#structs)
9. [Preprocessor](#preprocessor)
10. [Gas Optimization](#gas-optimization)
11. [Inline Assembly](#inline-assembly)
12. [Limitations vs Standard C](#limitations-vs-standard-c)

---

## Types

| Type | Width | Notes |
|---|---|---|
| `long` | 64-bit signed | General integer; also used for NQT amounts (1 Signa = 1_0000_0000) |
| `fixed` | 64-bit signed | Fixed-point with 8 decimals; 1.0 = 1 Signa. Use for Signa arithmetic. |
| `long *` | 64-bit address | Pointer to long in contract memory |
| `struct` | N × 64-bit | Syntactic grouping; no padding |
| `void` | — | For function return / parameter |

**`fixed` vs `long` for Signa:** `fixed` maps directly to wallet/explorer display values
(`1.5` = 1.5 Signa). `long` NQT requires manual scaling (`1_5000_0000` = 1.5 Signa).
The API provides `Fx` variants of every Signa function for use with `fixed`.

**No unsigned.** All values are signed; use `~` for bitwise tricks.  
**No char, int, short, float.** Only `long` and `fixed`.

---

## Variable Declaration

```c
long a;                  // single variable, zero-initialised at deploy
long b = 100;            // initialised constant (uses constVar slot)
long arr[10];            // array of 10 longs
long *ptr;               // pointer

struct TxInfo {
    long id;
    long amount;
    long sender;
};
struct TxInfo tx;
```

**Scope rules:**
- All variables are **static by default** — both global and function-scope variables retain
  their value between contract activations and between function calls. This is unlike C.
- To reset a function variable on each call, assign it explicitly at the top of the function:
  `long count = 0;` — omitting the initializer means the previous value is kept.
- `const long x = 42;` sets `x` once at deploy time and uses a constant-var slot
  (counts toward `maxConstVars`). The value can be changed later — `const` only means
  "set at contract creation", not immutable.

**Address and string literals:**
```c
long addr = "S-XXXX-XXXX-XXXX-XXXXX";   // Signum address → account ID (long)
long msg;
msg = "Hello!";                           // up to 8 ASCII chars packed into one long
long buf[4];
buf[] = "This is 32 chars max!!!!!!!!!!!"; // fills 4 longs with ASCII bytes
buf[] = 0;                                // clear entire array
long n = buf.length;                      // number of elements (4 here)
```

---

## Operators

### Arithmetic
```c
a + b    // addition
a - b    // subtraction
a * b    // multiplication
a / b    // integer division (truncates toward zero)
a % b    // modulo
-a       // unary minus
```

### Bitwise
```c
a & b    // AND
a | b    // OR
a ^ b    // XOR
~a       // NOT (also used as "unsigned divide" hint: a/~b)
a << n   // left shift
a >> n   // arithmetic right shift
```

**Special divide:** `a / ~b` tells the compiler to treat the divisor as
unsigned, improving codegen in some cases.

### Comparison
```c
a == b   a != b
a <  b   a <= b
a >  b   a >= b
```

### Logical
```c
a && b   // short-circuit AND
a || b   // short-circuit OR
!a       // logical NOT
```

### Assignment
```c
a = b
a += b   a -= b   a *= b   a /= b   a %= b
a &= b   a |= b   a ^= b
a <<= n  a >>= n
a++      a--      ++a      --a
```

---

## Control Flow

```c
// if / else if / else
if (condition) { ... }
else if (condition) { ... }
else { ... }

// while
while (condition) { ... }

// do-while
do { ... } while (condition);

// for
for (init; condition; step) { ... }

// break / continue
while (...) {
    if (x == 0) break;
    if (x < 0) continue;
}
```

**`switch` / `case` / `default` are supported** — the standard dispatcher for method codes.

```c
// Standard switch on a value:
switch (currentTx.message[0]) {
    case METHOD_ONE: actionOne(); break;
    case METHOD_TWO: actionTwo(); break;
    default: break;
}

// switch (true) — logical dispatch; each case is a boolean expression:
switch (true) {
    case (amount > threshold):  handleLarge(); break;
    case (amount > 0):          handleSmall(); break;
    default: break;
}
```

**`sizeof`** returns the number of longs a variable or type occupies:
```c
long arr[5];
long n = arr.length;   // 5  (preferred for arrays — member syntax)
long s = sizeof(arr);  // 5  (also works; returns longs, not bytes)
```

**No `goto`.** Use structured loops.

---

## Contract Lifecycle

### States

| State | How entered | Next activation resumes at |
|---|---|---|
| **Finished** | `exit` or end of `void main()` | Start of `void main()` |
| **Stopped** | `sleep` or `halt` | Instruction after `sleep`/`halt` |
| **Frozen** | Balance insufficient to continue | Same point — once refunded |
| **Dead** | Unhandled exception (div/0, memory fault, stack overflow) | Never — balance sent to forger |

### Control flow keywords

```c
exit;    // end execution; next tx re-enters via main()
halt;    // suspend execution; next tx resumes at next instruction
sleep;   // same as halt (preferred form — smaller instruction)
sleep N; // suspend for N blocks, then resume
```

**`exit` vs `halt`:** use `exit` to finish a logical unit of work and restart
cleanly on the next tx. Use `halt` / `sleep` to pause mid-execution and resume
exactly where you left off (e.g. waiting for a downstream response).

### Special functions

```c
// Entry point — runs on every activation after the first.
// Global statements run only on the very first activation.
void main() { ... }

// Error recovery — define this to prevent the contract reaching Dead state.
// Called automatically on any unhandled exception (div/0, stack overflow, etc.).
// Use it to send balance back to the creator before the contract stops.
void catch() {
    sendBalance(getCreator());
    exit;
}
```

`void catch()` is optional but strongly recommended for any contract holding funds.
Without it, an unhandled exception sends all balance to the current block's forger.

---

## Functions

```c
// Declaration (optional forward declare)
void myFunc(long a, long b);

// Definition
long add(long a, long b) {
    return a + b;
}

// void with no params
void doSomething(void) {
    // ...
}
```

- Functions can be called before they are defined — no forward declaration needed
- No variadic functions
- Recursion requires manually increasing `#program CodeStackPages` (each page = 16 frames)
- Function-scope variables are **static** — they keep their value between calls.
  Assign explicitly to reset: `long i = 0;` at the top of the function.

---

## Arrays & Pointers

```c
long arr[5];
arr[0] = 10;
arr[4] = 50;

long *p = arr;       // pointer to first element
*p = 99;             // set arr[0]
*(p + 2) = 77;       // set arr[2]
p[3] = 55;           // set arr[3] via subscript
```

**Pointer arithmetic** works in units of `long` (8 bytes in the VM).  
**No pointer-to-function** (use indirect dispatch via `asm` if needed).  
**Bounds checking:** none — out-of-bounds writes corrupt contract memory.

---

## Structs

```c
struct Point {
    long x;
    long y;
};

struct Point p;
p.x = 10;
p.y = 20;

// Array of structs
struct Point points[3];
points[1].x = 5;

// Pointer to struct
struct Point *pp = &p;
pp->x = 100;
```

Structs are laid out sequentially with no padding.
Struct members are accessed as pointer offsets under the hood.

---

## Preprocessor

SmartC supports a C-like preprocessor:

```c
// Object macros
#define ACTIVATION_AMOUNT   0.5
#define MSG_DEPOSIT         0x0100000000000000

// Function-like macros
#define NQT(signa)          ((signa) * 100000000)
#define MIN(a, b)           ((a) < (b) ? (a) : (b))

// Conditional compilation
#ifdef MAINNET
  #define TREASURY "S-XXXX-XXXX-XXXX-XXXXX"
#endif
#ifndef DEBUG
  // production path
#endif

// Include guard pattern
#define INITIALIZED 1

// Undefine
#undef DEBUG
```

### Program & Pragma Directives (not standard C)

```c
#program name        ContractName
#program description "Contract description string"
#program activationAmount 0.5
#program codeHashId  12345678901234567890
#program DataPages   2
#program UserStackPages 1
#program CodeStackPages 1

#pragma maxAuxVars   3
#pragma maxConstVars 2
#pragma optimizationLevel 3
#pragma version      2.1
#pragma verboseAssembly
#pragma reuseAssignedVar
```

---

## Gas Optimization

Every AT instruction costs **0.001 Signa** at runtime. The activation amount
must cover the worst-case execution path. Fewer instructions = lower activation
threshold = cheaper contract for users.

### Pick the optimization level by measurement, not by default

```c
#pragma optimizationLevel 3   // VM-trace optimizer — usually smallest, but verify
```

Level 2 is the compiler default (safe optimizer). Level 3 adds VM-trace analysis
that eliminates redundant instructions the safe pass misses. **It is not strictly
better than level 2** — for some contracts level 3 produces *larger* code than
level 2, occasionally enough to push past the 10240-byte deployment cap. Always
verify with the comparison script:

```bash
bun scripts/compare-optimization.js mycontract.smart.c
```

The script compiles at every level (0/1/2/3), prints a table of byte counts and
instruction counts, flags any non-monotonic results, and recommends the smallest
deployable configuration.

### Use `const` for frequently-used numbers

Each use of a numeric literal in non-optimized code emits a load instruction.
A `const` variable is loaded once and reused — saving one instruction per use.

```c
const long n100 = 100;       // naming convention: nVALUE
const long n10000 = 10000;

long share = total / n100;   // cheaper than  total / 100
```

**Exception: zero is free.** Setting a variable to zero and comparing against
zero both have special compact assembly forms. Never create `const long n0 = 0`.

### Tune `maxAuxVars` and `maxConstVars`

Aux vars are the compiler's scratch registers. The default is 3; using fewer
lowers memory pressure. Compile with `#pragma verboseAssembly` and inspect the
output — if the compiler warns about running out of aux vars, increase the value;
otherwise decrease it.

```c
#pragma maxAuxVars   3   // start here; reduce if assembly shows slack
#pragma maxConstVars 2   // slots for const-declared variables
```

### `inline` — eliminate call/return overhead

Marking a function `inline` inserts its body at every call site instead of
generating a subroutine jump. Best for small functions called in hot paths.

```c
inline long _getSenderPermission() {
    return getMapValue(MAP_KEY_PERMISSIONS, currentTx.sender);
}
```

**Bonus:** if every function in the contract is `inline`, the compiler needs
zero code-stack pages — reducing deployment cost by one page.

### `register` — keep loop variables in aux vars

The `register` keyword parks a variable in an aux var slot instead of persistent
contract memory. Useful for loop counters in tight loops — avoids the memory
read/write overhead.

```c
for (register long i = 0; i < 4; i++) {
    // i lives in an aux var, not in AT memory
}
// i is out of scope here — intentional
```

Note: the parked aux var cannot be used for other temporaries during its scope.
Increase `maxAuxVars` by 1 when using `register`.

### Prefer global variables over function parameters

In SmartC every function argument is pushed onto the user stack and popped at
return — two extra instructions per argument per call. If a value is used
across several functions, declaring it as a global (e.g. `currentTx`) eliminates
that overhead entirely.

```c
// Prefer this (global currentTx read directly):
void actionOne() {
    long sender = currentTx.sender;
    ...
}

// Over this (sender passed as parameter — stack push + pop):
void actionOne(long sender) { ... }
```

### Cache expensive or repeated calls

`getCreator()` and `getMapValue(...)` each emit AT instructions. If you call
them more than once in the same function, cache the result in a local variable.

```c
void main() {
    long creator = getCreator();   // cache once
    while (...) {
        if (currentTx.sender == creator) { ... }   // reuse — no extra instruction
    }
}
```

### Compare against zero when possible

Comparisons against zero emit a compact single instruction. Comparisons against
a variable or a literal emit a longer instruction. Structure conditions to test
zero where you have a choice.

```c
if (count == 0) { ... }        // compact
if (count != 0) { ... }        // compact
if (count == someVar) { ... }  // longer — avoid in hot loops if possible
```

### Estimating gas for a specific execution path

Every AT instruction costs exactly **0.001 Signa**. `activationAmount` must cover
the worst-case execution path — if it falls short, the contract freezes mid-execution
and resumes on the next incoming transaction (potentially in an inconsistent state).

**Step-by-step:**

1. **Compile with `verboseAssembly`:**
   ```c
   #pragma verboseAssembly
   ```
   The compiler annotates every generated instruction with its source line:
   ```asm
   ^comment: line 42: currentTx.sender = getSender(currentTx.txId);
   EXT_FUN_RET_DAT_2 GET_ACCOUNT_OF_TX_IN_A  ; ← 1 instruction
   ```
   Each non-comment, non-label line in the output is one AT instruction = 0.001 Signa.

2. **Identify the worst-case path** — the code path that executes the most instructions.
   For a typical contract this is the branch that reads a message, validates it, writes
   multiple map values, and sends a response. The `getNextTx()` loop body runs once per
   tx, so a batch of N transactions multiplies that cost by N.

3. **Count instructions on that path** — trace through the assembly output and count
   every instruction that executes on the path. Loop iterations count once each.

4. **Calculate and set `activationAmount`:**
   ```
   activationAmount = instruction_count × 0.001 Signa  +  safety margin (10–20%)
   ```
   Round up to a clean value. The compile script outputs an estimate in its deployment
   summary — use it as a floor and verify against the worst-case path manually.

**What costs instructions:**

| Operation | Approximate cost |
|---|---|
| Simple assignment / arithmetic | 1–2 instructions |
| Comparison + branch | 2–3 instructions |
| High-level API call (e.g. `getNextTx`, `setMapValue`) | 1 instruction (single opcode wrapper) |
| Function call with N arguments | 2 + 2×N instructions (call/return + push/pop per arg) |
| `inline` function | 0 overhead — body inserted at call site |
| `getCreator()` called twice | 2 instructions — cache it to save 1 |

**Frozen contract warning:** if the contract freezes mid-loop because gas runs out,
it resumes at the exact instruction where it stopped. This can cause a tx to be
processed across two activations, producing split state. Always set `activationAmount`
conservatively above the true worst case.

---

## Inline Assembly

For AT-level opcodes not exposed by high-level API:

```c
asm {
    // Raw AT assembly — see api-lowlevel.md for opcode list
    SET_VAL @myVar, #100
    ADD_DAT @result, @myVar
}
```

Use sparingly. Prefer high-level API functions.  
Variables referenced in `asm` blocks must be declared in C scope.

---

## Limitations vs Standard C

| Feature | Status |
|---|---|
| `float`, `double` | ❌ Use `fixed` (8 decimal places) for Signa; use `long` NQT for everything else |
| `fixed` | ✅ Built-in 8-decimal type; use with `Fx` API variants |
| `char`, `int`, `short` | ❌ Use `long` |
| `unsigned long` | ❌ Use bitwise tricks; `a / ~b` for unsigned divide |
| `switch` / `case` / `default` | ✅ Fully supported; also supports `switch (true)` with logical case expressions |
| `goto` | ❌ Not supported |
| Static variables | ✅ All variables are static by default — function vars persist between calls |
| `malloc` / `free` | ❌ No heap |
| String literals | ⚠️ Compile-time only; max 32 chars per buffer (`buf[] = "..."`); no runtime string building |
| Multi-return | ❌ Use pointer out-params or globals |
| Recursion | ⚠️ Supported but requires increasing `#program CodeStackPages` manually |
| `sleep` / `halt` / `exit` | ✅ Contract lifecycle keywords — see Contract Lifecycle section |
| `void catch()` | ✅ Error recovery hook — prevents contract entering Dead state |
| `printf` / IO | ❌ No stdlib; use `sendMessage` with packed strings |
| Preprocessor `#include` | ⚠️ Only `#include APIFunctions` and `#include fixedAPIFunctions` are supported |
