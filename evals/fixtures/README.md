# Fixture contract

Each directory here is a self-contained project the agentic benchmark asks Claude to work
on. A fixture is only usable if it obeys this contract, and `evals/test/fixtures.test.mjs`
enforces every clause below on every fixture — a fixture that violates one cannot land.

## Required files

- `fixture.json` — the manifest. Required fields, all mandatory:
  - `shape` — one of `"exploration"`, `"failing-test"`, `"multi-file"`.
  - `prompt` — the task given to the model. Must be non-empty.
  - `testCommand` / `testArgs` — the success oracle, run with `execFile` (no shell) in the
    copied project directory. Success is exit code 0, nothing else. Never interpreted.
  - `allowedTools` — the explicit tool allowlist for the run. Must be non-empty.

  A manifest must not declare `name` or `dir` — the loader sets both from the directory,
  and a manifest that shadows them is rejected at load time.
- `package.json` — the fixture's own project manifest.
- `oracle.patch` (non-exploration shapes) — the minimal correct fix as a valid unified
  diff, applied with `git apply --unsafe-paths --directory=<copy>`. It exists **only** to
  prove the fixture can go green; it is never shown to the model and never applied during
  a measured run.

## No dependencies

Fixtures must not declare `dependencies` or `devDependencies`. Nothing here is ever
`npm install`ed: a fixture that needs a lockfile or a registry fetch would make the
benchmark non-hermetic and its first run unrepresentative.

## Red before, green after

Every non-exploration fixture must:

1. **Start RED** — `testCommand` fails on a pristine copy. A fixture that passes before
   its bug is fixed cannot measure a fix.
2. **Go GREEN under its oracle** — after `oracle.patch` is applied to a pristine copy,
   `testCommand` exits 0. This is the clause that makes a fixture *usable*: it proves the
   success condition is reachable at all.

Why green-ness is a tested property and not a convention: a design probe seeded a bug in
a throwaway fixture, both arms fixed it correctly, and the fixture's test **still failed**
— its `package.json` ran `node --test test/`, which throws `MODULE_NOT_FOUND` on Node 22.
The probe's headline number was meaningless and nothing caught it.

## The Node 22 `--test` trap

`node --test <directory>/` throws `MODULE_NOT_FOUND` on Node 22 — a bare directory after
`--test` is resolved as a module, not scanned for tests. Always pass a quoted glob:

```json
"test": "node --test 'test/*.test.mjs'"
```

The quotes are load-bearing: they keep the shell from expanding the glob so Node's own
matcher handles it. The contract test rejects a bare directory after `--test` both in the
manifest's `testCommand`/`testArgs` and in the fixture's own `package.json` test script —
the latter is where the trap actually lives when `testCommand` is just `npm test`.

## Tools that are never allowed

- `Skill` — one arm loading skill content the other did not would be token usage
  attributed to the output style rather than to the style's actual effect.
- `Agent` — output styles do not apply to subagents, so work delegated to one silently
  escapes the treatment and dilutes the measurement.

## Isolation

Runs never touch the committed fixture. `copyFixture(name, cwd)` produces a fresh copy
per run and the copy is the only thing on the model's path; mutating one copy affects
neither the source nor any other copy (also enforced by test).

The copy never contains the answer key: `fixture.json` and every `*oracle.patch` are
excluded from it (also enforced by test). A model with Read/Grep in the copy could
otherwise read the oracle and transplant the exact fix — and the two measured arms would
do so at different rates, turning the success-rate difference into an artefact of the
leak. `applyOracle` reads its patch from the committed fixture, never from the copy.

The ground-truth run itself is bounded: `runFixtureTest` uses an explicit 120 s timeout
and a 32 MB output buffer, and a run that hits either limit is deliberately scored as a
failure (with the reason in `stderr` and `exitCode` kept numeric-or-null) — a "fix" that
hangs or floods is not a pass.
