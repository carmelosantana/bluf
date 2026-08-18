# BLUF

*Bottom Line Up Front.* A Claude Code output style that leads with the conclusion, written to cut filler — with the output-token reduction measured, including what it costs.

- Cuts assistant output tokens by a median of **25.7%** on claude-fable-5. Measured on 12 tool-free prompts, 5 independent trials, in an isolated environment that excludes the operator's machine configuration. All 5 trials came out negative, ranging −20.6% to −49.3%.
- **On claude-opus-5 the effect was not distinguishable from zero, and this is the honest headline.** The median was −14.0%, but two of five trials came out *positive* (+78.0% and +22.4%), and the category-clustered range spans zero. An earlier, less isolated run measured −30.9% on opus; **that figure is retracted**. See [Where the effect is not distinguishable from noise](#where-the-effect-is-not-distinguishable-from-noise).
- **The reason is baseline instability, not the style failing.** Answering the same 12 questions with no style applied, opus's total output varied **80%** across the five trials. Fable varied 29%. The style cannot be resolved against a baseline that noisy.
- Costs input tokens: **+2,032** per turn on fable and **+2,033** on opus — medians of 60 paired differences each, ranging 2,024–2,042. This is the best-evidenced number here: it now agrees across four independent measurements. On the first turn of a session it is a cache **write**; from the second turn on it is a cache **read** of the same size.
- **At published cache pricing, costs money on turn 1 and saves money on every turn after — on fable.** Break-even is 18.8× output:input for a one-turn session and 0.94× in steady state. That margin is thinner than the earlier three-trial run suggested. No prices are quoted here — multiply by your own and see [What it costs](#what-it-costs).
- **12 of the 24 per-case measurements have trial ranges that straddle zero** — 4 on fable, 8 on opus. On those cases the style made the response shorter on one trial and longer on another.
- These figures describe **tool-free, single-turn prose**. Nothing here reads a file, edits code, or runs a command, and output styles do not apply to subagents. See [Known limitations](#known-limitations).
- Version **0.1.0** of these rules made Opus **32.2% more verbose**. Measuring across models caught it. See [The 0.1.0 regression](#the-010-regression-on-opus).

All numbers come from [`evals/results/`](evals/results/), committed in this repo. The headline output figures come from [`report.md`](evals/results/report.md) and the `clean-*.jsonl` rows behind it; the input-cost and break-even figures from the session-amortization slice in the `amortization-*.jsonl` files. The superseded 3-trial measurement is preserved at [`report-0.2.0.md`](evals/results/report-0.2.0.md) rather than deleted. Every row records the model that actually ran, the CLI version, the style file's SHA-256, and which execution schedule produced it. The name is [the briefing convention](https://en.wikipedia.org/wiki/BLUF_(communication)): put the bottom line up front.

## Before / after

Prompt: *"In git, what does `--no-ff` do on a merge?"* — claude-opus-5, tools disabled. **This pair is an illustrative capture taken separately, not a row from the results table.** The sweep's own `git-no-ff` opus row measured a median of 520 → 65 output tokens, in a different environment from this capture. Both responses below are captured verbatim in [`evals/results/samples/`](evals/results/samples/); the exact commands are in [`samples/CAPTURE.md`](evals/results/samples/CAPTURE.md).

**Baseline (`outputStyle: Default`) — 586 output tokens** ([full text](evals/results/samples/git-no-ff.claude-opus-5.baseline.txt)), abridged:

> `--no-ff` forces git to create a merge commit even when a fast-forward would be possible.
>
> **Without it (default `--ff`):** if the target branch hasn't diverged — i.e. your current HEAD is a direct ancestor of the branch you're merging — git just moves the branch pointer forward. No merge commit, and the fact that a branch ever existed disappears from the graph.
>
> ```
> before:  A---B---C main
>               \
>                D---E feature
>
> ff merge: A---B---C---D---E   main, feature
> ```
>
> […]
>
> Related knobs:
> - `git config merge.ff false` — make `--no-ff` the default for all merges.
> - `git config --global pull.ff only` — refuse a pull that would need a merge.
> - `--ff-only` — the opposite: abort rather than create a merge commit.
>
> […]

**BLUF — 183 output tokens** ([full text](evals/results/samples/git-no-ff.claude-opus-5.0.2.0.txt)), in full:

> `--no-ff` forces git to create a merge commit even when the branch could fast-forward.
>
> Without it, if your current branch has no commits since the branch point, git just moves the pointer forward — no merge commit, and the branch's history looks like it was always linear. With `--no-ff`, you get an explicit merge commit with two parents, so the feature branch stays visible as a distinct set of commits.
>
> Common reasons to use it: keeping feature branches identifiable in the log, and making the whole feature revertable with a single `git revert -m 1 <merge-commit>`.

The cut is not free. The styled answer drops both ASCII commit-graph diagrams and a "related knobs" list covering `merge.ff`, `pull.ff`, and `--ff-only`. That is real content, not only padding. If you wanted those knobs, you now have to ask.

## Install

```bash
git clone https://github.com/carmelosantana/bluf.git
```

```bash
mkdir -p ~/.claude/output-styles && cp bluf/output-styles/*.md ~/.claude/output-styles/
```

Then run `/config`, select **Output style**, pick **BLUF**, and run `/clear`. `/config` opens a menu in the terminal. In the desktop app, set the `outputStyle` field in a settings file instead.

## The rules

Full text: [`output-styles/bluf.md`](output-styles/bluf.md). In summary:

- Answer short questions short. A three-line answer gets no bullet block and no headers.
- Answer what was asked, and stop. Add an adjacent fact only when it changes the answer.
- Above that threshold, lead with conclusion bullets. Depth goes below, under headers.
- The summary replaces the body. It does not introduce it. Never say the same thing twice.
- No preamble. No recap. No closing pleasantries. End with one concrete next step when anything is open.
- Errors: state what the evidence shows. Never supply a plausible cause in place of a confirmed one. Name the single check that identifies the cause.
- Lists: group and rank. Never drop a relevant item to reach a count.
- Sentence rules: a 20-word cap for an instruction, 25 for descriptive text, active voice, one instruction per sentence, plain words, no marketing adjectives, no hedge stacking — but keep a hedge that carries real uncertainty.
- Never rewrite code, quoted material, or text where exact wording carries the meaning.
- Explicit instructions from the user, the project, a skill, or the harness outrank all of this.
- A pre-send check deletes announcements, recaps, sidebars, and any section that restates a bullet.

## The retired terse variant

An evaluated compression variant — grammar compression layered on top of these rules — saved more output tokens than BLUF but hurt consistency and skimmability, so it was retired before launch. Its rules and its full measurements are preserved under [`archive/`](archive/) and in the `bluf-terse` result files in [`evals/results/`](evals/results/).

## Measured results

Median output tokens per case across 5 trials, isolated environment. Source: [`report.md`](evals/results/report.md) and the `clean-*.jsonl` rows, which also carry the per-case delta ranges and the category-clustered summary.

| Case | Category | fable base | fable BLUF | opus base | opus BLUF |
| --- | --- | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 113 | 24 | 245 | 5 |
| git-no-ff | short-lookup | 338 | 90 | 520 | 65 |
| to-sorted | short-lookup | 222 | 40 | 358 | 57 |
| health-endpoint | multi-step | 830 | 403 | 1,380 | 691 |
| actions-workflow | multi-step | 352 | 226 | 277 | 797 |
| cjs-to-esm | multi-step | 178 | 1,254 | 383 | 359 |
| 401-no-evidence | debug | 476 | 381 | 413 | 287 |
| ci-exit-1 | debug | 1,438 | 495 | 313 | 491 |
| scheduled-jobs | options | 921 | 558 | 674 | 1,131 |
| shared-types | options | 1,050 | 555 | 363 | 968 |
| security-headers | long-list | 1,459 | 925 | 2,580 | 1,634 |
| docker-cache-miss | long-list | 3,127 | 2,425 | 4,631 | 4,609 |
| **Sum of medians** | | **10,504** | **7,376** | **12,137** | **11,094** |

The bottom row sums the per-case medians. A sum of medians is not the median of sums, so it does not reproduce the headline: it gives −29.8% on fable and −8.6% on opus, against per-trial medians of −25.7% and −14.0%. The per-trial figures are the ones to quote, since they are computed per sweep and carry a range.

**The style loses on some rows, and on opus it loses on many.** Five of the twelve opus cases came out longer under BLUF at the median — `actions-workflow` (277 → 797), `ci-exit-1` (313 → 491), `scheduled-jobs` (674 → 1,131), `shared-types` (363 → 968), and `docker-cache-miss`, which is effectively flat. On fable, `cjs-to-esm` came out 178 → 1,254. Those rows are in the table and in every aggregate; none is excluded.

### Where the effect is not distinguishable from noise

**Twelve of the 24 per-case measurements have trial ranges crossing zero** — the style made the response shorter on one trial and longer on another:

| Model | Case | Δ output range |
| --- | --- | --- |
| fable-5 | actions-workflow | −609 to +94 |
| fable-5 | cjs-to-esm | −2,133 to +1,693 |
| fable-5 | 401-no-evidence | −624 to +439 |
| fable-5 | docker-cache-miss | −1,627 to +562 |
| opus-5 | 401-no-evidence | −285 to +218 |
| opus-5 | health-endpoint | −1,655 to +236 |
| opus-5 | security-headers | −1,535 to +167 |
| opus-5 | ci-exit-1 | −1,221 to +346 |
| opus-5 | shared-types | −1,267 to +873 |
| opus-5 | scheduled-jobs | −1,879 to +1,084 |
| opus-5 | cjs-to-esm | −104 to +2,458 |
| opus-5 | docker-cache-miss | −150 to +4,149 |

### The Opus result, stated plainly

The 12 prompts fall into 5 categories, and prompts within a category are correlated rather than independent draws. Collapsing to one value per category and bootstrapping over those five clusters gives an **indicative range** — not a confidence interval, because five clusters is far below where such methods are reliable:

| Model | Point estimate | Indicative range | Excludes zero? |
| --- | ---: | --- | --- |
| claude-fable-5 | +341 tokens saved | +183 to +484 | **Yes** |
| claude-opus-5 | −18 tokens saved | −181 to +161 | **No** |

**So the fable figure publishes and the opus figure does not.** On opus the point estimate is very slightly *negative* — BLUF produced marginally more output on average across categories — and the categories disagree in sign.

The cause is measurable and it is not the style. Answering the same 12 questions with **no style applied**, opus's total output per trial was 8,608 / 15,463 / 14,819 / 11,673 / 11,954 — an **80% spread**. Fable's was 10,880 / 12,467 / 10,914 / 9,665 / 11,797, a 29% spread. For comparison, opus in the previous, config-heavy environment varied **3.2%**. No effect of the size BLUF plausibly has can be resolved against a baseline moving 80%.

This is why the earlier −30.9% is retracted rather than merely superseded: it was measured in an environment carrying ~122,000 tokens of the operator's configuration, at three trials that were back-to-back repeats rather than independent sweeps. The isolated, properly-scheduled measurement does not reproduce it. **Why a sparse context should destabilise Opus's output length is an open question this project has not answered.**

### What it costs

**Output saved per turn.** The median of the per-trial means, from the 12-case sweep:

| Model | Output tokens saved |
| --- | ---: |
| claude-fable-5 | 216 |
| claude-opus-5 | *not quotable* |

Fable's figure is rounded for display; break-even below divides by the **unrounded** median,
215.9167. `perTrialMedianOutputSaved` returns the raw value for that reason.

**No opus figure is published here.** The same statistic computes to 139.5 on opus, but the
category-clustered range for opus spans zero, so that number describes noise as much as the
style. Quoting it would be the same mistake this project retracted once already.

The statistic is the median of the per-trial means, matching the [Variance](#variance) section.
The pooled mean and the pooled median disagree with it, and with each other, by enough to
change a model's verdict — so `perTrialMedianOutputSaved` in `evals/lib/report.mjs` pins it
rather than leaving the choice to each call site, and a traceability test in
`evals/test/report.test.mjs` recomputes every figure in this section through the shipped
functions from the committed result files, so a re-measure that moves any of them fails a test
instead of leaving this README stale.

**Input added, split by how it bills.** From the committed amortization slice — two turns of
one session per condition, on `port-default` in the lean environment, on **claude-opus-5
only**. The committed run covered three conditions (18 calls), including the retired terse
arm, whose rows are preserved unchanged; a re-run of `npm run measure:amortization` today
covers two (12 calls):

| Variant | Turn | Cache write | Cache read | Total input added |
| --- | ---: | ---: | ---: | ---: |
| BLUF | 1 | **+2,030** | 0 | +2,030 |
| BLUF | 2+ | −263 | **+2,030** | +1,767 |

Every write measured 1-hour TTL; the 5-minute figure was 0 in all 18 rows. And every
measured turn 1 was **cold** — `inputCacheRead` 0 with a positive cache write in all 9
turn-1 rows — which is what makes the turn-1 row a cold-write figure at all;
`assertTurn1WasCold` in `evals/lib/runner.mjs` now enforces that precondition on any re-run.

The **Total input added** column is a raw token count, not a cost figure: the turn-2 row sums
a cache write and a cache read, which bill at different rates. Read it as a rate-limit and
context-budget number, like the total-tokens figure below; for anything involving money, use
the per-tier columns and the break-even table. The turn-2+ total is a **row sum of the two
median columns beside it**, not an independently computed median — the pinned statistic, the
median of the per-trial paired input totals, gives +1,774, 7 tokens
higher, because a sum of medians is not the median of sums.

**This split is the whole reason the earlier claim was wrong.** Uncached input, cache reads, and
cache writes bill at different rates, and 1-hour and 5-minute writes differ again. The harness
used to sum all of them into one `inputTokens` field before storing it, which makes a row
impossible to price at all. Only `evals/results/amortization-*.jsonl` carries the split.

**The −263 on turn 2 is a real saving, not noise — it is deterministic.** In all 9
(condition, trial) pairs, turn 2's cache write equals turn 1's output tokens plus exactly 16:
313→329, 112→128, and 268→284 on the baseline trials, 5→21 on every styled trial. Turn 1's
styled answer was 263 output tokens shorter at the median, so there was exactly that much less
to write into the prefix that turn 2 reads. An output saving is billed twice — once as output,
and again as the next turn's cache write.

**Break-even.** The output:input price ratio at which the input the style adds is exactly paid
for by the output it removes. Two figures, because the first turn of a session and every turn
after it are not the same trade. The steady-state column assumes each later turn arrives within
the cache TTL; a gap longer than the TTL re-pays the write. Every measured write carried the
1-hour TTL.

| Model | One-turn session | Steady state (turn 2+) |
| --- | ---: | ---: |
| claude-fable-5 | 18.80× | 0.94× |

**These ratios got worse, and the reason is the smaller measured saving.** At three trials in
the config-heavy environment the same table read 10.58× and 0.53×. The input overhead did not
move — it is the output saving that fell, from 384 tokens per turn to 216. One caveat on the
mixture: the input half comes from the amortization slice, which is **opus-measured in the lean
environment**, while the output half is fable-measured in the isolated one. The overhead is
near-identical across both models and all three environments (2,030 / 2,032 / 2,033), which is
what makes the mixture defensible, but it is a mixture.

Above the ratio the style saves money; below it, it costs money. So a **single-turn** session is
a loss unless output costs you more than 18.8× input — which no current price list comes near —
while **every turn after the first** is a win unless output costs you *less* than 0.94× of
input. On Anthropic's published price list — the same source as the cache multipliers below —
every model prices output above input, so the steady-state case still wins; if you buy through
another provider, that comparison is yours to check.

**The margin is now thin where it used to be comfortable.** At 0.94× the steady-state case
clears break-even by a smaller factor than the measurement's own spread. Treat "saves money from
turn 2" as directionally supported, not as a precise multiple.

The steady-state column is deliberately **conservative: it ignores the −263 write saving.**
Counting that saving makes the steady-state input delta negative, meaning the style would be
cheaper on the input side alone before any output saving is counted. The table does not claim
that, because the write saving scales with the previous turn's output saving and was measured on
one case.

Converting a cache-read token to a base-input token requires a **price multiplier this project
did not measure.** The table above uses Anthropic's published structure — cache reads at 0.1× base
input, 1-hour cache writes at 2×, per [Anthropic's prompt-caching
documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching). Those
multipliers are published pricing, not a measurement of ours; the measurement is the token
counts, and the multipliers are the reader's to check. **No price is attached to any measured
result in this repository** — the only currency figure in the repo is the warning in
[Reproducing](#reproducing) about what a rerun costs. That is deliberate: a ratio built from
measured tokens cannot go stale, and a dollar figure we never measured would be exactly the
unverifiable claim this project exists to object to.

**How long the first turn takes to pay back.** At an output:input ratio of 5×, the first turn's
net loss is recovered after **0.47 to 1.25 further turns** depending on model —
soonest on opus, longest on fable. Both measured models are ahead by the end of
their third turn.

**Total tokens, which is not a cost figure.** Pooled median total-token change per turn — the
median over all 36 per-case paired differences in each condition, not the per-trial statistic
the output-savings figures use: +1,673 (fable) and
+1,583 (opus). The direction is the same under either statistic. Read this as a **rate-limit
and context-budget** number, because that is what raw token counts govern. It is **not** a cost
proxy: it adds four differently-priced quantities as though they were interchangeable. Use the
break-even table above for anything involving money.

The total figures are medians rather than sums because of a cold-cache artifact, where cache
creation was billed in full at a cache boundary. Across the 144 turns backing the figures above,
1 carries it — 245,184 input tokens against a 123,631 median. The original run measured 2 such
turns in 216, but the second (248,344) fell in the retired terse arm and no longer participates
in any published figure. Interleaving the conditions was expected to reduce this and did not.
Medians ignore it; sums do not.

### Variance

5 independent trials per case. A trial is a whole sweep of all 12 cases in a reshuffled order,
with the condition rotation keyed on case and trial — **schedule version 2**. That distinction
matters for reading any range here: under version 1, used for the superseded 0.2.0 figures, a
case's repetitions ran back to back with the rotation keyed on the case alone, so those ranges
measured the spread of quick repeats rather than of independent sweeps. See the Schedule
versions section of [`evals/results/README.md`](evals/results/README.md).

| Model | Per-trial reduction | Median | Trials negative |
| --- | --- | ---: | ---: |
| claude-fable-5 | −20.6% / −23.8% / −25.7% / −42.0% / −49.3% | **−25.7%** | 5 of 5 |
| claude-opus-5 | −29.5% / −18.4% / −14.0% / **+22.4%** / **+78.0%** | −14.0% | 3 of 5 |

**Read the opus row as the finding, not as a footnote.** Two of five sweeps measured the style
making responses *longer* in aggregate, one of them by 78%. That is not a small perturbation of
a −30.9% effect; it is a different picture entirely.

**The baseline is what moves.** Total unstyled output per trial, same prompts, same model:

| Model | Baseline output per trial | Spread |
| --- | --- | ---: |
| claude-fable-5 | 10,880 / 12,467 / 10,914 / 9,665 / 11,797 | 29% |
| claude-opus-5 | 8,608 / 15,463 / 14,819 / 11,673 / 11,954 | **80%** |

For comparison, the same opus baseline in the previous config-heavy environment varied **3.2%**
across its trials. Removing ~122,000 tokens of ambient configuration from the context appears to
destabilise how much Opus writes — by a factor of twenty-five. **This project has not explained
that, and does not claim to.** It is the single most interesting thing the redesign surfaced, and
it is an open question rather than a result.

**The effect size depends on how verbose the baseline currently is, and that moves.** The archived
v1 run of the same 12 cases measured the opus baseline at 15,914 output tokens summed across the
cases ([`full-claude-opus-5-baseline-v1.jsonl`](evals/results/full-claude-opus-5-baseline-v1.jsonl)).
A chattier baseline gives the style more to cut, so a reduction percentage is a statement about
the model's current habits as much as about these rules. Treat these percentages as measured
against the models as they behaved in August 2026, not as constants.

## The 0.1.0 regression on Opus

Version 0.1.0 of these rules cut fable-5 output by 22.7% and **inflated opus-5 output by 32.2%**. The full run is preserved in [`evals/results/report-0.1.0.md`](evals/results/report-0.1.0.md). This is the strongest argument for measuring across models at all: the same prompt made one model shorter and another longer.

**That run is not methodologically comparable to the current one** — it was a single trial per case with each condition run as a contiguous block. The regression is far enough outside the measured spread to survive the difference, but the two reports should not be diffed row by row. See [`evals/results/README.md`](evals/results/README.md).

What caused it, per the case data:

- The "Length is not terseness" block only ever forbade cutting. It never forbade adding, which Opus read as licence to expand.
- The summary became additive rather than substitutive. Opus wrote conclusion bullets **and** a full headed body saying the same thing.
- Nothing bounded unrequested context. `port-default` went from 5 to 66 output tokens purely from facts nobody asked for.
- "Never truncate" read as a mandate to enumerate every possibility.

Four rule changes in 0.2.0 fixed it:

1. "Length is not terseness" now states it protects needed content and does not invite content the question did not ask for.
2. A new contract rule: "The summary replaces the body. It does not introduce it." Saying anything twice is forbidden, and the pre-send check now deletes any section that restates a bullet.
3. A new rule: "Answer what was asked, and stop."
4. "Never truncate" is scoped: relevant means it bears on the question asked. It stops you dropping what the reader needs; it does not ask you to enumerate.

### The regression fix, illustrated

Prompt: *"What port does the Vite dev server use by default?"* — case `port-default`, on claude-opus-5. This compares 0.1.0 against 0.2.0; it shows the regression being fixed, not the style's value over no style. Both responses are captured verbatim in [`evals/results/samples/`](evals/results/samples/).

| 0.1.0 (retracted) | 0.2.0 (current) |
| --- | --- |
| 5173.<br><br>Vite serves on `http://localhost:5173` by default. If that port is taken, Vite increments to the next free port (5174, 5175, …). Override it with `--port 3000` on the CLI or `server.port` in `vite.config.js`. | 5173. |

Nobody asked about port collisions or overrides. In the current run, the unstyled opus baseline answers this prompt in a median of 140 output tokens and BLUF answers it in 5.

## Known limitations

- Output styles do not apply to subagents. A subagent runs its own system prompt. A fork is the exception, since it inherits the parent's.
- An output style takes effect only after `/clear` or a new session. Claude Code reads it once at session start.
- The style shrinks output tokens and adds input tokens on every turn — but the measurement shows the addition bills as a cache write on the first turn only; every turn after re-reads it as a cache read of the same size instead of re-paying the write. Whether that nets out to a saving is a price-ratio question: see the break-even table in [What it costs](#what-it-costs).
- Measured on two models with five trials per case, and the result held on only one of them. Your workload is not these 12 prompts.
- Measured against models as they behaved in August 2026. Baselines drift, and the effect size drifts with them.
- **These figures describe tool-free, single-turn prose.** All 12 prompts are conversational questions and the harness passes `--tools ''`. Nothing reads a file, edits code, or runs a command, so the headline does not describe agentic coding work — the thing Claude Code mostly does.
- **In agentic work a large output reduction is a small cost reduction.** Generated output is roughly a tenth of cost-equivalent tokens once tool results, file contents, and re-sent context are counted; a design-time measurement on this machine put it at 7.5–12.4%, consistent with a published 2,908-run study at 10.4%. Cutting a third of a tenth is not cutting a third.
- **The `$48–54` figure in [Reproducing](#reproducing) is an API-list-price equivalent, not an observed bill.** The harness passes no API key and authenticates exactly as the operator's CLI does, so on a subscription that spend is quota, not cash. The practical risk of a large sweep is exhausting a rate limit, not an invoice.
- **Per-message `output_tokens` in Claude Code transcripts are unreliable.** A design-time probe summed 189 output tokens across assistant messages for a call whose result event reported 5,065 — a 27× undercount. This harness reads the result event, which is why its figures do not inherit that error; tools built on transcript parsing may.

## Reproducing

```bash
npm test
```

```bash
TRIALS=5 npm run measure
```

```bash
npm run measure:amortization
```

`npm test` runs 278 tests with zero dependencies on Node 22+.

**`TRIALS=5 npm run measure` makes 260 live API calls and costs real money** — 12 cases × 2 conditions × 5 trials × 2 models in the clean environment (240 calls), plus 2 overhead cases × 2 conditions × 5 trials in the lean environment (20). The only measured cost figure is for a different design and does not transfer: the last full run — 3 trials, full environment, still carrying a third condition at 234 calls — cost roughly $48–54. The sweep is not part of `npm test` and nothing runs it by accident. It refuses to start while any file it would write is tracked by git, so committed evidence has to be preserved under a versioned name (or sacrificed by name via an environment variable the refusal message documents) before it rewrites `evals/results/`. Omit `TRIALS` for a single-trial run of 52 calls, which is cheaper and correspondingly less trustworthy.

**`npm run measure:amortization` makes 12 live API calls** — 2 conditions × 3 trials × 2 turns, on claude-opus-5 — and also spends real money, though far less than the sweep. It regenerates the input half of the break-even table: the per-tier cache write/read splits in `evals/results/amortization-*.jsonl`. It, too, runs only when you invoke it.

**`npm run preflight` makes 2 live API calls** — one baseline, one styled, on claude-opus-5 — and verifies the output style actually reached the model before a sweep spends anything on it. It, too, runs only when you invoke it.

**Install the style before measuring.** The sweep selects each condition by style name. If `bluf.md` is not in `~/.claude/output-styles/`, the styled condition silently resolves to the default and you measure Default against Default. Run the install step above first. The prompt set is pinned by SHA-256 and the sweep refuses to run if it has been edited.

## Corrections

**The cost claim, corrected before first release.** Earlier drafts of this README stated that
total tokens rise and therefore the style *"does not buy a smaller bill."* The token count was
measured. The conclusion did not follow from it: the harness stored input tokens as a single
sum of three classes that bill at different rates, so no row in the original dataset could be
priced at all. The claim was replaced with the break-even table above, and the harness now
stores the three tiers separately.

A second error travelled with it. The break-even figures first circulated for internal review
were computed from **means** of per-turn output deltas, while every headline percentage in this
README uses **medians**. At an output:input ratio of 5×, the mean figures say all four
combinations save money and the median figures say fable does not. A verdict that flips on the
choice of statistic is not a verdict, so the statistic is now pinned in code.

**The Opus reduction, retracted before first release.** Earlier drafts published **−30.9%** on
claude-opus-5, from three trials in an environment carrying ~122,000 tokens of the operator's
machine configuration, with "trials" that were back-to-back repeats rather than independent
sweeps. Re-measured at five independent trials in an isolated environment, the effect on opus is
**not distinguishable from zero**: the category-clustered range spans it, two of five trials came
out positive, and 8 of 12 cases straddle zero. The figure is retracted rather than superseded,
because the conditions that produced it were not ones a reader could reproduce. The 3-trial rows
and their report are preserved unchanged at
[`report-0.2.0.md`](evals/results/report-0.2.0.md) and the `full-*.jsonl` files. What replaced it
is not a smaller number but the absence of one, plus the measured reason: the unstyled opus
baseline varies 80% between sweeps in that environment, against 3.2% in the old one.

Nothing was published under the old claim; this section is not a public correction. It is here
because a project whose premise is that the prior art published unverifiable numbers cannot
quietly delete its own and present the result as having been right all along. Same reason the
retracted 0.1.0 result archive is kept byte for byte.

## Credits

This style is assembled from prior art, and it exists because that prior art published token-savings claims without reproducible measurement. The sources contributed real ideas:

- [toppa's ASD-STE100 gist](https://gist.github.com/toppa/bf7ff49d6fc44fd4fc3337248f8f2a7e) — the skill-to-output-style conversion pattern, the "Never apply to" carve-out, and "Length is not terseness".
- [danyuchn/asd-ste100-skill](https://github.com/danyuchn/asd-ste100-skill) — the structural sentence rules, modality preservation, and the slop scan.
- [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd) — the structural rules, the precedence clause, and the pre-send check.
- [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) — the compression rules and the honest-numbers framing.

Four issue reporters found the failure modes this style's rules correct:

- [i-have-adhd#99](https://github.com/ayghri/i-have-adhd/issues/99) — a rule that demands a cause pressures the model to invent one. Hence the Errors rule: never supply a plausible cause in place of a confirmed one. The rule reduced this failure mode; it did not eliminate it. Our own shipped sample for it ([`401-no-evidence.claude-opus-5.0.2.0.txt`](evals/results/samples/401-no-evidence.claude-opus-5.0.2.0.txt)) correctly lists four candidate causes without picking one, yet its opening line asserts the request was rejected "before any handler logic ran" — an attribution a 401 status alone does not establish.
- [i-have-adhd#96](https://github.com/ayghri/i-have-adhd/issues/96), reported by `nbali` — "cap lists at 5" drops relevant findings. Hence: group and rank, never truncate.
- [i-have-adhd#43](https://github.com/ayghri/i-have-adhd/issues/43), reported by `kuhlsnu` — style rules collide with the harness system prompt. Hence the precedence clause: the harness outranks the style.
- [i-have-adhd#112](https://github.com/ayghri/i-have-adhd/issues/112) — over-adherence stalls tool use into "want me to?" loops. Hence: do the work instead of asking.

## License

[MIT](LICENSE)
