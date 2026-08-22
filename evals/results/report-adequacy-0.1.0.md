# Adequacy sweep — hidden-edges (0.1.0)

6 paid calls: 1 fixture × 3 trials × 2 conditions, on `claude-fable-5`, in the `clean`
environment (`--setting-sources project`, no operator MCP servers or user settings), CLI
2.1.222, style sha256 `a018355…3d21`, schedule version 2. The rows are
`agentic-claude-fable-5-baseline-hidden-edges.jsonl` and
`agentic-claude-fable-5-bluf-hidden-edges.jsonl` in this directory; the raw transcripts
of all 6 calls are under `agentic-transcripts/` (the `*hidden-edges*` files). Total
spend: **$2.4627** in CLI-reported `total_cost_usd`, which is an API-list-price
equivalent, not an observed bill.

Every figure below is recomputed from those committed rows by
`evals/test/adequacy-results.test.mjs`, which makes no API call. If a number here and
that test ever disagree, the test is right.

The one-line result: **all six runs passed the hidden suite — 3/3 in each arm — so the
instrument did not discriminate in this sweep.** That is a ceiling, not a finding. This
report does not claim the style causes no adequacy loss, because this data cannot
support that claim; what it can and cannot support is the whole subject of sections 2
and 3.

## 1. What the instrument is

The `hidden-edges` fixture ships two suites. The visible one is what `npm test` runs
inside the fixture and what `taskPassed` scores — it is all the model's prompt refers
to. The hidden one (`test-hidden/`, run as `npm run test:hidden`) is withheld from the
model's working copy entirely and injected only at scoring time; `hiddenPassed` is the
adequacy signal. The approved prompt is `npm test fails in src/ordinal.mjs. fix it`, and
it never mentions the hidden suite.

The planted bug: `ordinal(n)` gives every integer the suffix "th". The committed
`naive.patch` fixes it by last digit only (`n % 10`), which passes the visible suite but
fails the hidden one on the teens exception (11th/12th/13th) and on negatives (in JS,
`-1 % 10 === -1`, so a bare last-digit comparison never matches and −1 renders as
"-1th"). `oracle.patch` fixes it properly and passes both. So the trap is real: a
plausible, visible-green fix exists that the hidden suite catches. That split is
verified twice by shipped code — the free contract test in
`evals/test/fixtures.test.mjs` applies both patches and asserts the split, and the
pre-spend gate in `evals/measure-agentic.mjs` re-runs the same check for real before any
money is spent, aborting the sweep if the split has rotted.

## 2. The result, and what it does not show

Both arms went **3/3 on `taskPassed` and 3/3 on `hiddenPassed`** — six of six runs
passed the suite they were never told about. No adequacy gap was detected.

Do not read that as "the style causes no adequacy loss." Neither arm ever failed, so
this sweep produced no evidence that the measure can separate the arms in practice — it
observed a ceiling, not a difference. What the sweep does establish is narrower:

- **The measure is not vacuous.** The committed `naive.patch` demonstrably passes the
  visible suite and fails the hidden one, and the pre-spend gate verified that split for
  real before these six calls ran. A failure was possible; it simply did not occur.
- **This is an existence probe, not a measurement.** Six runs, one fixture, one model,
  three trials per arm can support "a gap was observed" or "none was observed" — nothing
  more. No rate, percentage, or quantitative adequacy claim comes out of this data, and
  none is made.

## 3. Why the ceiling was plausible

The edge cases the hidden suite tests — the teens exception, negatives, zero — are all
documented in the docstring of `src/ordinal.mjs`, the very file the prompt names. A
model that reads the file it was pointed at has been told the contract. And every run
did: all six transcripts contain a `Read` of `src/ordinal.mjs`, and every committed fix
implements the full documented rule, teens exception and `Math.abs` included.

That documentation was left in deliberately — a real project documents its contract, and
reading it is legitimate thoroughness, which is the behaviour an adequacy measure should
reward rather than trick. But it has a cost that must be disclosed: this fixture
measures *whether the model read and honoured the documented contract*, not reasoning
under uncertainty. A model that skipped the docstring and pattern-matched a last-digit
fix straight onto the failing assertions would have scored the split; none did, in
either arm.

## 4. The efficiency figures replicate Component 3 on an independent task

Component 3's fixtures never included this one, so its rows are an independent
observation of the same mechanism. Totals across the 3 runs per arm, baseline → styled:

| metric | baseline | styled | change | Component 3 |
|---|---|---|---|---|
| `numTurns` | 16 | 17 | +1 | 58 → 61 |
| `toolCalls` | 13 | 14 | +1 | 49 → 52 |
| `outputTokens` | 2,391 | 2,312 | −3.3% | −10.2% |
| `textChars` | 980 | 629 | **−35.8%** | **−31.5%** |
| `toolUseChars` | 2,303 | 2,372 | +3.0% | +3.0% |
| `inputTokens` | 316,792 | 372,453 | +17.6% | +11.9% |
| `totalCostUsd` | $1.140 | $1.323 | **+16.1%** | **+18.3%** |

The same shape on a fixture Component 3 never ran: prose compresses hard, tool behaviour
does not change, and cost rises anyway — because the style's ~2,000 tokens of text are
re-sent as input on every turn, and input, not output, is where the tokens are. Cost
went up in **3 of 3** pairs (+8.1%, +29.4%, +21.6%).

### The trial-1 cost outlier

Trial 1 is an outlier in both arms: **$0.6108** and **$0.6604**, against $0.2521–$0.3365
for trials 2 and 3. The rows say why: trial 1 in each arm wrote **24,923** and
**27,207** tokens to the 1-hour cache tier — the most expensive input tier — where
trials 2 and 3 wrote 5,941–8,371 and mostly read a cache trial 1 had already warmed.
Trial 1 is 53.6% of the baseline arm's total and 49.9% of the styled arm's.

What that does to the totals: the cold-cache pair is the one where cost moved *least*
(+8.1%), so it drags the aggregate down — on the warmed trials alone the cost delta is
**$0.5289 → $0.6627 (+25.3%)**, not +16.1%. The headline +16.1% is not inflated by the
outlier; if anything it understates the warmed-cache delta. Either way the direction is
3 of 3, and with 3 pairs, direction is the only statistic on offer.

## Limits

- **6 calls, 1 fixture, 1 model (`claude-fable-5`), 3 trials per arm.** An existence
  probe. Nothing here supports a rate or generalises beyond this fixture and model.
- **A ceiling result is not a negative result.** "No gap detected" and "no gap exists"
  are different claims, and only the first is made. A stronger design would need more
  fixtures, harder edges, or — most directly — edge cases *not* documented in the file
  the prompt names, so that honouring the contract requires inference rather than
  reading.
- **The documented-contract confound of section 3** bounds what even a clean split would
  have meant: this fixture tests reading and honouring a written contract, which is one
  kind of adequacy, not all of it.
- **Costs are CLI-reported `total_cost_usd`** — API-list-price equivalents, not an
  observed bill. Each row also records an auxiliary `claude-haiku-4-5` call billed
  alongside the main model (530 input / 17–18 output tokens per run, in both arms).
- **The runs used the `clean` environment**, so they carry none of the operator's user
  settings or MCP servers. Absolute input totals will differ on a configured machine.
- **The efficiency table is 3 pairs.** It is quoted as a replication of Component 3's
  direction and rough magnitude, not as an independent estimate.
