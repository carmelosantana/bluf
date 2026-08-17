# What is in this directory

Two things, kept apart on purpose — plus one retired experiment, labelled below.

## The current measurement

`report.md` and the `bluf`-named `.jsonl` files are the 0.2.0 rules, measured at three
trials per case with conditions interleaved. The project README's output-side figures —
the headline percentages, the results table, the variance ranges — trace to these files.
Its input-cost and break-even figures trace to the amortization slice below, and its
0.1.0 regression figures to the archive below.

## The 0.1.0 archive

`report-0.1.0.md` and the `-v1.jsonl` files record the **retracted** first rule set — the
one that cut Fable-5 output 22.7% while inflating Opus-5 output 32.2%. They are kept
because that regression is a claim the README still makes, and evidence for a live claim
should not be deleted.

Two things about them:

- **The filenames and the `condition` field inside them say `less-chatty`.** That was the
  project's working name when the run happened. The files are preserved byte for byte
  rather than relabelled, because rewriting stored measurement records to match a name
  chosen afterwards is the kind of tidying that quietly destroys provenance.
- **They are not methodologically comparable to `report.md`.** The 0.1.0 run was a single
  trial per case with each condition run as a contiguous block, which confounds the
  condition with elapsed time. The 0.2.0 run is three trials with conditions interleaved
  and rotated. The +32.2% regression is far enough outside the measured drift band to
  survive that difference, but the two reports should not be diffed row by row.

## The terse variant — a retired experiment

The `bluf-terse` files are the full evaluation of a compression variant that was
**retired before launch** and is no longer shipped:

- `full-claude-fable-5-bluf-terse.jsonl` and `full-claude-opus-5-bluf-terse.jsonl` —
  its 12-case main sweep
- `lean-claude-opus-5-bluf-terse.jsonl` — its 2-case lean-environment sweep
- `amortization-claude-opus-5-bluf-terse.jsonl` — its arm of the amortization slice
- the `less-chatty-terse-v1` files — its rows in the retracted 0.1.0 archive above
- the terse sections of `report.md`

It saved more output tokens than base BLUF but hurt consistency and skimmability — it
lost to BLUF outright on some cases, and compressed grammar is harder prose — and a
second shipped variant meant a second behaviour to re-validate on every rule change. The
style file itself is preserved at [`archive/bluf-terse.md`](../../archive/bluf-terse.md),
with the full rationale in [`archive/README.md`](../../archive/README.md).

These files are preserved byte for byte, like the 0.1.0 archive: they are the evidence
the variant was evaluated rather than dropped on taste. Their rows carry
`condition: "bluf-terse"`, a key no longer in the live `CONDITIONS` table in
`evals/lib/runner.mjs` — expected, because that table validates conditions a new paid
run is about to spend on, not stored evidence.

## Samples

`samples/` holds verbatim response text, which the `.jsonl` files do not record. See
`samples/CAPTURE.md` for how each was captured and which prompt produced it.

## Amortization slice

`amortization-claude-opus-5-*.jsonl` — 18 rows from `npm run measure:amortization`, run when
the sweep still carried three conditions (6 of the rows belong to the retired terse arm; a
re-run today covers two conditions and 12 rows). Two turns
of a single `claude` session per (condition, trial): turn 1 opens it with `--session-id`, turn 2
re-asks the same prompt with `--resume`. Case `port-default`, lean environment, three trials,
opus-pinned because `--strict-mcp-config` forces that model.

**These are the only rows here that carry the input-token tier split** —
`inputUncached`, `inputCacheRead`, `inputCacheWrite`, and the `1h`/`5m` breakdown of the write.
Every other file predates tier capture and stores only a summed `inputTokens`, which is why no
cost figure can be derived from them: uncached input, cache reads, and cache writes bill at
different rates, and 1-hour and 5-minute writes differ again. `requireTiers()` in
`evals/lib/report.mjs` throws on those older rows rather than treating an absent tier as zero.

This slice exists because every other measurement here is single-shot, and single-shot cannot
observe the thing that decides the cost question: whether the style's input overhead is a cache
write paid once per session or a cache read paid every turn. It is the latter from turn 2 on.

Four post-payment checks in `evals/lib/runner.mjs` gate the result — that every turn-2 row read
from cache, that each turn-2 row's input strictly exceeds its turn-1 partner's (a forked session
would send an identical prefix and pass the first check), that every turn-1 row was a cold cache
write (`inputCacheRead` 0, positive write — the precondition that makes the turn-1 figures
cold-write figures), and that the styled arms' turn-1 input exceeds baseline by the style's own
token count. None of them can save money. They exist so a run that measured the wrong thing
aborts loudly instead of printing a plausible number.

**Output tokens in this slice are not a style measurement.** Turn 2 re-asks a question just
answered, so its length is noise — the unstyled arm measured 181, 33, and 194 across three
trials. The output-reduction claim comes from the 12-case sweep in `report.md`, not from here.
An earlier version of this slice aborted a valid run on a turn-2 output ceiling for exactly this
reason, and the unstyled arm has separately measured 5 output tokens on turn 1, identical to a
styled answer.
