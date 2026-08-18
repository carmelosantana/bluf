---
case: actions-workflow
category: multi-step
requires:
- A complete, valid workflow file the reader can commit as-is. A fragment or a prose
  description of the steps is not an answer to "write a workflow".
- Triggers on both push and pull_request.
- Pins Node 22.
- Has working dependency caching, and says which line provides it — the prompt names
  caching as a requirement, so a workflow that silently omits it fails, and one that
  includes it without saying where leaves the reader unable to verify it.
- Does not require: a version matrix, concurrency cancellation, permissions hardening,
  branch filters, or an explanation of what each action does.
---
`.github/workflows/test.yml`:

```yaml
name: test
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
```

`cache: npm` is the caching — `setup-node` restores and saves the npm cache keyed on your lockfile, so it needs a committed `package-lock.json` (which `npm ci` needs anyway). Use `cache: pnpm` or `cache: yarn` instead if that is your package manager.
