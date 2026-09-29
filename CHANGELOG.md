# Changelog

All notable changes to the signum-smartc skill. Versions follow
[Semantic Versioning](https://semver.org/): a major bump for changes that make
existing guidance or scripts behave differently, minor for new content or
tools, patch for corrections.

Update an installed skill with `bash scripts/update.sh`.

## [1.0.0] - 2026-09-29

First versioned release. Documents **smartc-signum-compiler 2.3.x**.

### Added
- `VERSION` file, this changelog, and `scripts/update.sh` to pull the latest
  version and refresh the dependencies.
- The installer pins the compiler to the documented range (`~2.3.0`).

### Fixed
- `references/api-lowlevel.md` rewritten against the compiler's API tables and
  the simulator's microcode: correct signatures (two-argument `Set_A1_A2` & co.),
  `Send_A_To_Address_In_B` sends a message rather than an amount, correct
  register layouts for maps, signatures, hashes and assets, the missing
  `Get_Account_Balance`, and no more `F_Get_Asset_Circulating`. Adds a
  built-in → API call mapping.
- `references/assembler-ciyam.md` rewritten from the assembler's own tables.
  The previous version used internal table names (`SET_VAL`, `ADD_DAT`) and
  commas that the assembler rejects, had wrong opcode bytes and sizes for most
  instructions (e.g. `JSR` is `0x12`, `FUN` is `0x32`–`0x37`), and listed API
  functions and codes that do not exist. It now documents the accepted syntax,
  every opcode with its size, all API function codes with their `FUN` form,
  and the execution-control instructions (`SLP`, `STP`, `FIN`, `ERR`, `PCS`).
  A test diffs both tables against the installed compiler.
- The inline assembly example in `references/language.md` now assembles.

### Included
- `SKILL.md` with contract structure, core rules and analysis checklist.
- References: language, high-level API, low-level API, CIYAM assembler,
  patterns, testing.
- Scripts: `compile.js`, `gas-analysis.js`, `decompile.js`,
  `compare-optimization.js`, `install.sh`.
