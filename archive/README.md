# Archive

## `bluf-terse.md` — the retired terse variant

This is the compression variant of BLUF, retired before launch. It layered grammar
compression on top of the base style: drop articles where the meaning survives, prefer
the short synonym, never invent an abbreviation, no arrows, and never compress code,
quotes, exact strings, or caveats.

It was evaluated in full — the same 12-case sweep, three trials per case, on both models,
plus the amortization slice — and it is preserved here, not deleted, because it is very
nearly the artifact that produced committed result files. Deleting it would leave those
results unexplainable.

**"Very nearly" is exact, and matters.** This file is **207 bytes larger** than the one
that was measured. After the sweep, commit `c0e0fd6` changed two things: the frontmatter
`description:`, and the Compression block, which previously said only that its rules
"apply on top of everything above" — an instruction that contradicted the shared body's
rule to keep articles explicit. The override is now stated outright. Neither edit was
re-measured, so the committed terse figures slightly understate this file's input
overhead: its published +2,320 per turn describes the smaller, pre-edit version. If the
variant is ever revived, that is the first thing to re-measure.

**Why it was retired.** It saved more output tokens than base BLUF, but it hurt
consistency and skimmability: its per-case results were less uniform (it lost to base
BLUF outright on some cases), and compressed grammar is harder prose to read. A second
shipped variant also meant a second behaviour and a second set of claims to re-validate
on every future rule change. BLUF's promise is readability with the conclusion first,
not minimum tokens at any cost, so the launch ships one style.

**Where its results live.** Everything it measured is committed under
[`evals/results/`](../evals/results/), unchanged:

- `full-claude-fable-5-bluf-terse.jsonl` and `full-claude-opus-5-bluf-terse.jsonl` —
  the 12-case main sweep
- `lean-claude-opus-5-bluf-terse.jsonl` — the 2-case lean-environment overhead sweep
- `amortization-claude-opus-5-bluf-terse.jsonl` — the session-amortization slice
- the `less-chatty-terse-v1` files — the retracted 0.1.0 run under the project's
  working name
- the terse sections of `evals/results/report-0.2.0.md` — the terse variant is not a
  condition in any newer run, so no future `report.md` will carry them

Those rows carry `condition: "bluf-terse"`, a value no longer present in the live
`CONDITIONS` table in `evals/lib/runner.mjs`. That is expected: the harness validates
conditions for new runs it is about to pay for, not for stored evidence, and the stored
rows are kept exactly as measured. See the retired-experiment section of
[`evals/results/README.md`](../evals/results/README.md).

**Why `output-styles/bluf.md` still contains shared-body markers.** The
`<!-- BLUF:SHARED-BODY:START -->` / `<!-- BLUF:SHARED-BODY:END -->` comments in the
shipped style fenced the body this variant shared with it, and a drift check (removed
along with the variant) kept the two bodies byte-identical. With one style file the
markers do nothing — but every published figure in the project README measures
`bluf.md` exactly as it was measured, so editing that file, even to delete a vestigial
comment, would silently make every number describe a file that no longer exists. The
markers stay until the next deliberate re-measure.
