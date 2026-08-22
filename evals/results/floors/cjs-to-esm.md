---
case: cjs-to-esm
category: multi-step
requires:
- Covers all three files the prompt names — the module, its test, and package.json — and
  shows the actual edit for each. Naming two of the three is an incomplete answer.
- Gets package.json right, which is the part that decides whether anything else works:
  "type" - "module".
- Shows the import/export rewrite concretely, not as a rule to apply.
- States the two conversions that silently break a working file and that a reader would
  otherwise return with: relative specifiers need their file extension, and __dirname /
  __filename do not exist.
- Does not require: a .mjs-vs-type-module comparison, dual-package "exports" maps,
  createRequire, top-level await, a bundler section, or a discussion of why ESM exists.
---
Three edits.

**package.json** — this is the switch; without it Node still parses `.js` as CommonJS.

```json
{ "type": "module" }
```

**The module** — `require` becomes `import`, `module.exports` becomes `export`.

```js
// before
const { join } = require('node:path')
function slug (s) { return s.toLowerCase() }
module.exports = { slug }

// after
import { join } from 'node:path'
export function slug (s) { return s.toLowerCase() }
```

**The test** — same rewrite, plus the extension:

```js
// before: const { slug } = require('./slug')
import { slug } from './slug.js'
```

Two things that break quietly:

- Relative imports need the file extension. `'./slug'` resolves in CommonJS and throws `ERR_MODULE_NOT_FOUND` in ESM.
- `__dirname` and `__filename` are gone. Use `import.meta.dirname` (Node 20.11+).
