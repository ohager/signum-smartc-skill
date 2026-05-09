# Vendored: Signum-D-Or

Source: https://github.com/deleterium/Signum-D-Or
Pinned commit: `ca3aeed20e23dd11937086ee3603194faa752174` (2024-07-05)
Repo license: GPL-3.0 (compatible with this project's GPL-3.0)

## Files vendored

| File | Upstream path | Header license | Purpose |
|---|---|---|---|
| `decompiler.js` | `src/decompiler.js` | (inherits repo GPL-3.0) | AT machinecode → assembly |
| `optimizer.js`  | `src/optimizer.js`  | (inherits repo GPL-3.0) | assembly → optimized assembly |

Note: upstream `bytecode.js` carries a BSD-3-Clause header (sourced from SmartC). It is **not** vendored here — only needed for round-trip recompile, which is out of scope for analysis use.

## Modifications

The only change made to each vendored file is a single appended line to expose the function as a CommonJS export:

```js
module.exports = decompiler;  // appended to decompiler.js
module.exports = optimizer;   // appended to optimizer.js
```

No other edits. The original source above the appended line is byte-identical to upstream at the pinned commit.

## Re-syncing

```bash
COMMIT=<new-sha>
gh api "repos/deleterium/Signum-D-Or/contents/src/decompiler.js?ref=$COMMIT" --jq '.content' | base64 -d > decompiler.js
gh api "repos/deleterium/Signum-D-Or/contents/src/optimizer.js?ref=$COMMIT"  --jq '.content' | base64 -d > optimizer.js
printf '\nmodule.exports = decompiler;\n' >> decompiler.js
printf '\nmodule.exports = optimizer;\n'  >> optimizer.js
```

Then update the pinned commit at the top of this file.

## API

```js
const decompiler = require('./decompiler');
const optimizer  = require('./optimizer');

// machinecode: hex string of AT bytecode
// JSONmap: pass `undefined` for raw on-chain bytecode (decompiler auto-fills
//          generic names like "var00", "var01"). To supply a known map, pass
//          a JSON STRING: JSON.stringify({ Memory: [...], Labels: [...] }).
const { JSONmap, AssemblyProgram } = decompiler(machinecode, undefined);

const optimizedAssembly = optimizer(AssemblyProgram);
```