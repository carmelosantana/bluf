# Fixture contract

Each directory here is a self-contained project the agentic benchmark asks Claude to work
on. A fixture is only usable if it obeys this contract, and `evals/test/fixtures.test.mjs`
enforces every clause below on every fixture — a fixture that violates one cannot land.

## Required files

- `fixture.json` — the manifest. Required fields, all mandatory:
  - `shape` — one of `"exploration"`, `"failing-test"`, `"multi-file"`, `"hidden-edges"`.
  - `prompt` — the task given to the model. Must be non-empty.
  - `testCommand` / `testArgs` — the success oracle, run with `execFile` (no shell) in the
    copied project directory. Success is exit code 0, nothing else. Never interpreted.
  - `allowedTools` — the explicit tool allowlist for the run. Must be non-empty.

  Optional fields, for the `hidden-edges` shape only:
  - `hiddenCommand` / `hiddenArgs` — the adequacy oracle, run by `runHiddenTest` under the
    same contract as `testCommand` (execFile, exit code 0, explicit timeout and buffer,
    `NODE_TEST_CONTEXT` stripped). They travel as a pair — a manifest declaring one
    without the other is rejected at load — and the `hidden-edges` shape must declare
    them; the other shapes have no hidden suite.
  - `hiddenPaths` — the directories holding the hidden suite, relative to the fixture
    root. Mandatory whenever `hiddenCommand` is declared: `copyFixture` **withholds**
    these subtrees from the model's copy, and `runHiddenTest` injects them back at
    scoring time. A hidden command without declared paths is rejected at load — it
    would leak the hidden suite straight into the model's working tree. Absolute paths
    and `..` segments are rejected too.
  - `hiddenScripts` — the `package.json` scripts the hidden command needs (e.g.
    `test:hidden`), injected into the copy's `package.json` together with the hidden
    files. The committed fixture's own `package.json` must not carry them: the model
    reads that file, and the script name alone would advertise that a second suite
    exists. Declaring either asset field without `hiddenCommand` is rejected at load.

  A manifest must not declare `name` or `dir` — the loader sets both from the directory,
  and a manifest that shadows them is rejected at load time.
- `package.json` — the fixture's own project manifest.
- `oracle.patch` (non-exploration shapes) — the minimal correct fix as a valid unified
  diff, applied with `git apply --unsafe-paths --directory=<copy>`. It exists **only** to
  prove the fixture can go green; it is never shown to the model and never applied during
  a measured run.
- `partial-oracle.patch` (multi-file shape) — a deliberately **incomplete** fix, updating
  only the option's definition. Used only by the contract tests to prove the fixture's
  test fails when any rename site is missed — the property that makes the task multi-file
  rather than single-edit. Like `oracle.patch`, it never reaches the model's copy.
- `naive.patch` (hidden-edges shape) — a deliberately **naive** fix: it makes the visible
  suite pass while missing the documented edge cases the hidden suite covers. Used only
  by the contract tests to prove the visible/hidden split is real. Like every other
  patch, it never reaches the model's copy.

## No dependencies

Fixtures must not declare `dependencies` or `devDependencies`. Nothing here is ever
`npm install`ed: a fixture that needs a lockfile or a registry fetch would make the
benchmark non-hermetic and its first run unrepresentative.

## Exploration fixtures are not scored by their tests

An exploration fixture (e.g. `explain-cache`) has **no oracle patch and no red-start
requirement** — there is nothing to fix, and the red/green clauses below do not apply to
it. Its `testCommand` exists to satisfy the manifest contract and keep the project a
real, runnable one; the runner never uses it to judge the answer. Success for this shape
is "the run completed without error" — nothing about the *content* of the explanation is
checked, and the question of whether the explanation is adequate is deferred to
Component 4 (the paired-run protocol). Do not read an exploration "pass" as the model
having explained anything correctly.

## Hidden-edges fixtures measure adequacy, not just success

A `hidden-edges` fixture (e.g. `hidden-edges`) ships **two** suites:

- `npm test` runs the **visible** suite. It is what the prompt refers to and what
  `taskPassed` scores, exactly as for every other fixture.
- `npm run test:hidden` runs a **hidden** suite the prompt never mentions, covering edge
  cases that are documented in the source and that a complete fix would handle. Adequacy
  is `hiddenPassed`, scored by `runHiddenTest` **after** the run and never shown to the
  model. It is the only adequacy signal in this repository that is execution-verified —
  everything else (the over-compression detector, the length floors) is heuristic.

"Hidden" means **absent from the model's copy entirely**. `copyFixture` withholds the
manifest's `hiddenPaths` subtrees exactly as it withholds `fixture.json` and every
`*.patch`, and the committed `package.json` carries no `test:hidden` script — the
script lives in the manifest's `hiddenScripts`, injected only at scoring time. The
model's copy contains no reference to the hidden suite at all: not the directory, not
the script, not a mention in any byte it can read (enforced by test, which greps every
copied file). The model has Read, Glob, Grep and Bash in the copy; anything less than
total absence would let it discover the hidden assertions and fix for them directly,
turning the adequacy measurement into a measure of who went poking around.

`runHiddenTest` performs the injection itself: after the run completes and `taskPassed`
has been scored from the visible suite, it copies the committed hidden files into the
working directory — replacing any same-named directory wholesale, so a model-authored
file never rides along — merges `hiddenScripts` into the copy's `package.json`, and
runs the hidden command. If the copy the model left behind cannot receive the injection
(a `package.json` mangled beyond parsing, say), that scores as a hidden **failure**,
same as a hang or a flood — a "fix" that leaves the project unrunnable is not adequate.

What remains discoverable is deliberate: the edge-case **rules** are documented in the
source docstring — `src/ordinal.mjs` spells out the teens exception, negative operands
and zero — because a real project documents its contract, and deleting the docstring
would make the fixture less realistic. A model that reads the source and covers the
documented edges has simply written the complete fix, which is exactly the behaviour
being measured. What it can no longer do is read the hidden suite's assertions or learn
that a second suite exists.

The property that makes the shape worth anything, enforced by test: the committed
`naive.patch` makes the visible suite pass **while the hidden suite still fails**, and
`oracle.patch` makes both pass. If a naive fix also passed the hidden tests there would
be no adequacy gap to detect and the fixture would measure nothing. The visible and
hidden suites live in disjoint directories (`test/` vs `test-hidden/`) with
non-overlapping quoted globs — and since the hidden directory is not even present until
scoring time, `npm test` can never run the hidden suite — the contract test pins the
visible run's collected-test count to make that structural.

`runHiddenTest` throws on a fixture without a hidden suite rather than returning a
result: a missing hidden suite must be scored `null` by the caller, never read as a
passed or failed one.

The hidden-suite pattern follows `smixs/awesome-claude-output-styles` (MIT); no code,
test content, or data from that repository is used here — the fixture is written from
scratch.

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

The copy never contains the answer key: `fixture.json`, every `*.patch`, and the hidden
suite's `hiddenPaths` subtrees are all excluded from it (also enforced by test). The
patch filter is every patch, not just `*oracle.patch` — `naive.patch` does not match the
narrower suffix and would otherwise have been copied straight into the model's working
tree. A model with Read/Grep in the copy could otherwise read a patch and transplant the
exact fix, or read the hidden tests and fix for the edges directly — and the two
measured arms would do so at different rates, turning the success-rate difference into
an artefact of the leak. `applyOracle` and `applyNaive` read their patches from the
committed fixture, never from the copy, and `runHiddenTest` injects the hidden suite
from the committed fixture at scoring time.

The ground-truth run itself is bounded: `runFixtureTest` uses an explicit 120 s timeout
and a 32 MB output buffer, and a run that hits either limit is deliberately scored as a
failure (with the reason in `stderr` and `exitCode` kept numeric-or-null) — a "fix" that
hangs or floods is not a pass.
