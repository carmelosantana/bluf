# Agentic sweep — first measurement (0.1.0)

18 paid calls: 3 fixtures × 3 trials × 2 conditions, on `claude-fable-5`, in the `clean`
environment (`--setting-sources project`, no operator MCP servers or user settings), CLI
2.1.222, style sha256 `a018355…3d21`. The rows are
`agentic-claude-fable-5-baseline.jsonl` and `agentic-claude-fable-5-bluf.jsonl` in this
directory; the raw transcripts of all 18 calls are under `agentic-transcripts/`. Total
spend: **$5.4322** in CLI-reported `total_cost_usd`, which is an API-list-price
equivalent, not an observed bill.

Every figure below is recomputed from those committed rows by
`evals/test/agentic-results.test.mjs`, which makes no API call. If a number here and that
test ever disagree, the test is right.

The one-line result: **the style did not change what the agent did, made its prose much
shorter, and made every run more expensive anyway** — because in agentic work the style's
own text is re-sent as input on every turn, and input, not output, is where the tokens
are.

## 1. Task success first

Efficiency figures mean nothing across arms that completed different amounts of work, so
this comes first: **12 of 12** scored runs passed their fixture's test (`taskPassed`,
exit code 0) — 6 per arm — and all **6 of 6** exploration runs completed without error.
No arm completed fewer tasks. That is the only reason the numbers below are comparable at
all; had the styled arm failed tasks, no efficiency number in this report would mean
anything. What 12/12 does **not** show is covered under Limits.

## 2. The ship gate, per metric

9 pairs, paired as (fixture, trial). Deltas are styled minus baseline; negative favours
the style.

| metric | median delta | median % | direction |
|---|---|---|---|
| `numTurns` | 0 | 0.0% | 6/9 identical, 3/9 +1, 0/9 negative — inside noise |
| `toolCalls` | 0 | 0.0% | 6/9 identical, 3/9 +1, 0/9 negative — inside noise |
| `totalCostUsd` | +$0.042 | +17.7% | 9/9 positive, range +10.5% to +33.4% — outside noise |
| `outputTokens` | −84 | −8.5% | 7/9 negative — real but small |
| `textChars` | −253 | −39.6% | 8/9 negative — real and large |

Totals across the 9 runs per arm: cost **$2.488 → $2.944 (+18.3%)**; output tokens
**9,331 → 8,381 (−10.2%)**; input tokens **959,532 → 1,074,192 (+11.9%)**; turns 58 → 61;
tool calls 49 → 52.

With 9 pairs the honest statistic is direction consistency, not an interval — see Limits.
Cost went the same way in **9 of 9** pairs.

## 3. The mechanism: a per-turn input tax, not changed behaviour

The cost increase is not the agent doing more. Three observations pin this down:

- **6 of 9 pairs have identical turn counts *and* identical tool-call counts, and all 6
  still cost more.** The work was the same; the bill was not.
- The three `explain-cache` pairs isolate the tax exactly: both arms took 3 turns and
  made 2 tool calls in all three trials, so the entire input difference is the style
  itself. Per turn that difference is **+2,031 / +2,023 / +2,046 input tokens**. One of
  the three sits inside the style's committed 2,028–2,038 overhead band (the probe-row
  band `probes.test.mjs` pins); the other two land within 8 tokens of its edges. The
  style's own text is re-sent as input on every turn of every session.
- Across all 9 pairs, the median input added per baseline turn is **+1,662 tokens**, and
  cache writes — the most expensive input tier — rose **55,559 → 76,034 (+37%)**.

## 4. Why the output saving cannot pay for it

In these runs, output is **0.96%** of billed tokens (9,331 output against 959,532 input
in the baseline arm). The project README already discloses that generated output is
roughly a tenth of cost-equivalent tokens in agentic work; measured here, the raw token
share is ten times smaller again. An output reduction — even the −10.2% measured — is a
saving on a rounding error, set against a tax charged on the 99%. Saving a tenth of one
percent-scale line item cannot offset a per-turn input surcharge of ~2,000 tokens.

## 5. What the style actually does in an agentic run

Exactly what it was written to do — and that is precisely why it cannot help here. Prose
collapses while tool calls do not: `textChars` fell **−31.5%** overall (median −39.6%,
8/9 pairs negative) while `toolUseChars` moved **+3.0%**. Prose fell from **56.2%** to
**46.0%** of generated characters. The style compresses the assistant's talking and
leaves its tool calls alone. In prose work, talking is the whole product, so that is a
real saving. In agentic work, talking is a sliver of the bill, and the style charges
input rent on every turn to shrink it.

## 6. A prediction recorded before the data, confirmed

Before any of these calls ran, the plan for this sweep recorded a prediction: if the
prose sweep's baseline instability comes from sparse context letting response length
wander, then dense agentic context should constrain it, and agentic output should be
markedly more stable than the prose sweep was. One caveat on the pre-registration itself:
the plan is a local working document, deliberately not committed, so the repo attests the
measured spreads but cannot prove the prediction predated the data — you have the
operator's word for the ordering, not a commit hash.

Measured: whole-trial baseline output sums were **3,047 / 3,060 / 3,224 — a 5.8%
spread**, against **29%** for fable and **80%** for opus in the clean-environment prose
sweep (both recomputed from their committed rows). The pattern holds within the sweep
too: the densest fixture (`rename-option`) spread 4.4% across trials, `failing-test`
10.2%, and the most conversation-like fixture (`explain-cache`, where the deliverable is
an explanation) 31.2% — the sparser the context, the wobblier the baseline.

## Limits

Stated plainly, because this is a small first sweep and the plan said so before it ran:

- **3 fixtures, one model (`claude-fable-5`), 3 trials, 18 calls.** Nothing here
  generalises beyond that without more spend.
- **9 pairs supports no interval claim, and none is made.** The repo's clustered-interval
  machinery needs a category field these rows do not carry, and 3 clusters is below even
  the 5 the prose sweep already flagged as marginal. Direction consistency — cost up in
  9 of 9 pairs — is the honest statistic at this scale, which is why it is the one
  quoted.
- **12/12 task success shows no adequacy penalty *at this scale*; it does not show there
  is none.** Six scored tasks per arm cannot rule out a real penalty rate. Adequacy is
  Component 4's question, not this sweep's.
- **The exploration fixture is unscored.** Its "success" is only that the run completed
  without error; nothing here judges the content of the explanations it produced.
- **Costs are CLI-reported `total_cost_usd`** — API-list-price equivalents, not an
  observed bill. Each row also records an auxiliary `claude-haiku-4-5` call billed
  alongside the main model (~530 input / ~18 output tokens per run, in both arms).
- **The runs used the `clean` environment**, so they carry none of the operator's user
  settings or MCP servers. Absolute input totals will differ on a configured machine;
  the per-turn style tax is additive and should not.

## What this does and does not say about the prose result

This report does not retract the prose finding. Prose and agentic are different regimes:
the project's published **−25.7%** median output reduction is a tool-free, single-turn
prose figure, measured where output *is* the product and re-sent context does not exist.
That figure still reproduces from its committed rows (the test recomputes it alongside
everything here). What this sweep shows is that the same mechanism that saves output
tokens in prose becomes a net cost in multi-turn tool work, because the style's ~2,000
tokens ride along as input on every turn. One style, two regimes, opposite signs — both
measured, neither retracted.
