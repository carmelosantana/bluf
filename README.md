# BLUF

*Bottom Line Up Front.* A Claude Code output style that leads with the conclusion and cuts filler — measured, including what it costs.

- Cuts assistant output tokens by a median of **35.0%** on claude-fable-5 and **30.9%** on claude-opus-5. The terse variant cuts **39.2%** and **38.5%**. Measured on 12 Claude Code-shaped prompts, 3 trials per case, in a full ~124k-token environment.
- **Every one of the 12 trial-level measurements came out negative.** The direction is not in question; the size is. Per-trial ranges are −44.0% to −30.7% (fable) and −32.7% to −29.0% (opus). See [Variance](#variance).
- Costs input tokens: **+2,030** (BLUF) or **+2,320** (terse) per turn — the median of the per-trial paired differences, the same statistic used for the output-savings figures. The per-trial differences were 2,029–2,037 (BLUF) and 2,319–2,327 (terse) across the amortization run's trials. On the first turn of a session that is a cache **write**; from the second turn on it is a cache **read** of the same size.
- **At published cache pricing, costs money on turn 1 and saves money on every turn after.** Break-even is 6.6×–10.6× output:input for a one-turn session and 0.33×–0.53× in steady state. No prices are quoted here — multiply by your own and see [What it costs](#what-it-costs).
- 6 of the 48 per-case measurements have trial ranges that straddle zero, meaning the style's effect on those cases is not distinguishable from run-to-run noise even at 3 trials.
- Version **0.1.0** of these rules made Opus **32.2% more verbose**. Measuring across models caught it. See [The 0.1.0 regression](#the-010-regression-on-opus).

All numbers come from [`evals/results/`](evals/results/), committed in this repo — the 12-case sweep from [`report.md`](evals/results/report.md), and the session-amortization slice (the cache write/read splits behind the input-cost and break-even figures) from the `amortization-*.jsonl` files. The name is [the briefing convention](https://en.wikipedia.org/wiki/BLUF_(communication)): put the bottom line up front.

## Before / after

Prompt: *"In git, what does `--no-ff` do on a merge?"* — claude-opus-5, tools disabled. **This pair is an illustrative capture taken separately, not a row from the results table.** The sweep's own `git-no-ff` opus row measured a median of 492 → 114 output tokens. Both responses below are captured verbatim in [`evals/results/samples/`](evals/results/samples/); the exact commands are in [`samples/CAPTURE.md`](evals/results/samples/CAPTURE.md).

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

## The terse variant

It adds grammar compression on top of the base style:

- Drop articles where the meaning survives. Fragments are allowed.
- Prefer the short synonym.
- Never invent an abbreviation — the tokenizer splits `cfg` like the full word, so it saves nothing.
- No arrows. Standard acronyms (DB, API, HTTP) are fine; never coin one.
- Compression never touches code, quotes, exact strings, or caveats.

**It cuts more on aggregate, but not uniformly, and it is not strictly better.** It costs more input than the base style (+2,320 per turn vs +2,030), and it loses on individual cases: on opus, `actions-workflow` measured 715 output tokens under terse against 499 under BLUF, and `docker-cache-miss` measured 3,840 against 3,525. Compressed grammar is also harder to skim for some readers, which no token count captures.

## Measured results

Median output tokens per case across 3 trials, full environment. Source: [`evals/results/report.md`](evals/results/report.md), which also carries the per-case delta ranges.

| Case | Category | fable base | fable BLUF | fable terse | opus base | opus BLUF | opus terse |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 133 | 5 | 5 | 140 | 5 | 5 |
| git-no-ff | short-lookup | 360 | 112 | 120 | 492 | 114 | 130 |
| to-sorted | short-lookup | 280 | 78 | 68 | 405 | 52 | 40 |
| health-endpoint | multi-step | 1,013 | 624 | 551 | 1,833 | 915 | 764 |
| actions-workflow | multi-step | 686 | 381 | 460 | 1,053 | 499 | 715 |
| cjs-to-esm | multi-step | 2,323 | 1,800 | 1,526 | 2,934 | 3,372 | 2,989 |
| 401-no-evidence | debug | 1,144 | 640 | 547 | 1,489 | 650 | 555 |
| ci-exit-1 | debug | 1,564 | 846 | 954 | 1,567 | 962 | 740 |
| scheduled-jobs | options | 1,340 | 639 | 523 | 1,872 | 1,149 | 961 |
| shared-types | options | 1,182 | 716 | 647 | 2,173 | 1,499 | 1,155 |
| security-headers | long-list | 1,857 | 885 | 777 | 2,856 | 1,978 | 1,688 |
| docker-cache-miss | long-list | 2,038 | 2,343 | 2,067 | 5,123 | 3,525 | 3,840 |
| **Sum of medians** | | **13,920** | **9,069** | **8,245** | **21,937** | **14,720** | **13,582** |

The bottom row sums the per-case medians. It does not exactly reproduce the headline percentages, because a sum of medians is not the median of sums — it gives −34.8% and −40.8% on fable and −32.9% and −38.1% on opus, against the per-trial medians of −35.0%, −39.2%, −30.9% and −38.5%. The [Variance](#variance) figures are the ones to quote, since they are computed per trial and carry a range.

The style loses on some rows. On fable, `docker-cache-miss` came out **+457** output tokens with BLUF at the median; on opus, `cjs-to-esm` came out **+438**. Those rows are in the table and in the aggregates.

### Where the effect is not distinguishable from noise

Six of the 48 per-case measurements have trial ranges crossing zero — the style made the response shorter on one trial and longer on another:

| Model | Variant | Case | Δ output range |
| --- | --- | --- | --- |
| fable-5 | BLUF | docker-cache-miss | −1,049 to +517 |
| fable-5 | terse | docker-cache-miss | −1,038 to +181 |
| opus-5 | BLUF | health-endpoint | −1,285 to +63 |
| opus-5 | BLUF | cjs-to-esm | −988 to +563 |
| opus-5 | BLUF | ci-exit-1 | −720 to +55 |
| opus-5 | terse | cjs-to-esm | −1,979 to +311 |

The pattern is that the largest, most open-ended cases are the least predictable. A short lookup gets reliably shorter; a sprawling refactor question does not.

### What it costs

**Output saved per turn.** The median of the per-trial means, from the 12-case sweep:

| Model | Variant | Output tokens saved |
| --- | --- | ---: |
| claude-fable-5 | BLUF | 384 |
| claude-fable-5 | terse | 445 |
| claude-opus-5 | BLUF | 565 |
| claude-opus-5 | terse | 707 |

Those are rounded for display. Break-even below divides by the **unrounded** medians —
383.9167, 444.5, 564.5833, 706.75 — because dividing by the rounded figures shifts two of the
four ratios. `perTrialMedianOutputSaved` returns the raw value for that reason.

The statistic is the median of the per-trial means, matching the [Variance](#variance) section.
The pooled mean and the pooled median disagree with it, and with each other, by enough to
change a model's verdict — so `perTrialMedianOutputSaved` in `evals/lib/report.mjs` pins it
rather than leaving the choice to each call site.

**Input added, split by how it bills.** From `npm run measure:amortization` — 18 calls, two
turns of one session per condition, on `port-default` in the lean environment, on
**claude-opus-5 only**:

| Variant | Turn | Cache write | Cache read | Total input added |
| --- | ---: | ---: | ---: | ---: |
| BLUF | 1 | **+2,030** | 0 | +2,030 |
| BLUF | 2+ | −263 | **+2,030** | +1,767 |
| terse | 1 | **+2,320** | 0 | +2,320 |
| terse | 2+ | −263 | **+2,320** | +2,057 |

Every write measured 1-hour TTL; the 5-minute figure was 0 in all 18 rows.

The **Total input added** column is a raw token count, not a cost figure: the turn-2 rows sum
a cache write and a cache read, which bill at different rates. Read it as a rate-limit and
context-budget number, like the total-tokens figure below; for anything involving money, use
the per-tier columns and the break-even table. The turn-2+ totals are **row sums of the two
median columns beside them**, not independently computed medians — the pinned statistic, the
median of the per-trial paired input totals, gives +1,774 (BLUF) and +2,064 (terse), 7 tokens
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

| Model | Variant | One-turn session | Steady state (turn 2+) |
| --- | --- | ---: | ---: |
| claude-fable-5 | BLUF | 10.58× | 0.53× |
| claude-fable-5 | terse | 10.44× | 0.52× |
| claude-opus-5 | BLUF | 7.19× | 0.36× |
| claude-opus-5 | terse | 6.57× | 0.33× |

Above the ratio the style saves money; below it, it costs money. So a **single-turn** session is
a loss unless output costs you more than 6.6×–10.6× input, while **every turn after the first**
is a win unless output costs you *less* than 0.33×–0.53× of input — and no published pricing
prices output below input.

One asymmetry in the table's provenance: the output half is measured per model, but the input
half comes from the opus-only amortization run — there is no fable input measurement in this
repository. The fable rows reuse the opus-measured +2,030/+2,320 overhead. That transfer is
very likely sound, because the overhead is a property of the style text rather than the model,
but it is a transfer, not a fable measurement.

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
net loss is recovered after **0.34 to 1.25 further turns** depending on model and variant —
soonest on opus terse, longest on fable BLUF. Every measured combination is ahead by the end of
its third turn.

**Total tokens, which is not a cost figure.** Pooled median total-token change per turn — the
median over all 36 per-case paired differences in each condition, not the per-trial statistic
the output-savings figures use: +1,673 (fable BLUF), +1,886 (fable terse), +1,583 (opus BLUF),
+1,674 (opus terse). The direction is the same under either statistic. Read this as a **rate-limit
and context-budget** number, because that is what raw token counts govern. It is **not** a cost
proxy: it adds four differently-priced quantities as though they were interchangeable. Use the
break-even table above for anything involving money.

The total figures are medians rather than sums because 2 of the 216 measured turns carry a
cold-cache artifact where cache creation was billed in full at a cache boundary — 248,344 and
245,184 input tokens against a 123,917 median. Interleaving the conditions was expected to
reduce this and did not. Medians ignore it; sums do not.

### Variance

3 trials per case. The aggregate effect was computed per trial and then summarised, rather than by pooling all trials, so the ranges below reflect real run-to-run spread:

| Model | Variant | Median | Range across trials |
| --- | --- | ---: | --- |
| claude-fable-5 | BLUF | −35.0% | −44.0% to −30.7% |
| claude-fable-5 | terse | −39.2% | −47.2% to −38.1% |
| claude-opus-5 | BLUF | −30.9% | −32.7% to −29.0% |
| claude-opus-5 | terse | −38.5% | −46.9% to −37.8% |

**The baseline itself is unstable, and much more so on fable.** Summed across the 12 cases, the unstyled baseline measured 13,592 / 16,670 / 13,147 output tokens on three consecutive fable trials — a 25.9% spread within a single run. On opus the same figure was 21,741 / 21,911 / 22,434, a 3.2% spread. Any fable number here should be read with that in mind; the opus numbers are considerably firmer despite opus being the model this style used to struggle with.

**The effect size depends on how verbose the baseline currently is, and that moves.** The archived v1 run of the same 12 cases measured the opus baseline at 15,914 output tokens summed across the cases ([`full-claude-opus-5-baseline-v1.jsonl`](evals/results/full-claude-opus-5-baseline-v1.jsonl)); this run's three baseline trials measured 21,741–22,434, per the summed figures above. The baseline is unstyled, so the rules cannot explain that move. A chattier baseline gives the style more to cut, and that — not a better rule set — is most of why the opus reduction is as large as −30.9% here: an earlier single-trial run against a leaner baseline measured a substantially smaller reduction. That run's result data was superseded and is not in this repository, which is why no figure is quoted for it. Treat these percentages as measured against the models as they behaved in August 2026, not as constants.

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
- The two style files duplicate their shared body, because output styles have no import mechanism. `npm run check` enforces that the shared bodies stay byte-identical.
- Measured on two models with three trials per case. Your workload is not these 12 prompts.
- Measured against models as they behaved in August 2026. Baselines drift, and the effect size drifts with them.

## Reproducing

```bash
npm test
```

```bash
npm run check
```

```bash
TRIALS=3 npm run measure
```

```bash
npm run measure:amortization
```

`npm test` runs 188 tests with zero dependencies on Node 22+. `npm run check` verifies the two style files share a byte-identical body.

**`TRIALS=3 npm run measure` makes 234 live API calls and costs roughly $48–54.** It is not part of `npm test` and nothing runs it by accident. It rewrites `evals/results/`. Omit `TRIALS` for a single-trial run of 78 calls, which is cheaper and correspondingly less trustworthy.

**`npm run measure:amortization` makes 18 live API calls** — 3 conditions × 3 trials × 2 turns, on claude-opus-5 — and also spends real money, though far less than the sweep. It regenerates the input half of the break-even table: the per-tier cache write/read splits in `evals/results/amortization-*.jsonl`. It, too, runs only when you invoke it.

**Install the styles before measuring.** The sweep selects each condition by style name. If the two files are not in `~/.claude/output-styles/`, every condition silently resolves to the default and you measure Default against Default. Run the install step above first. The prompt set is pinned by SHA-256 and the sweep refuses to run if it has been edited.

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

- [i-have-adhd#99](https://github.com/ayghri/i-have-adhd/issues/99) — a rule that demands a cause pressures the model to invent one. Hence the Errors rule: never supply a plausible cause in place of a confirmed one.
- [i-have-adhd#96](https://github.com/ayghri/i-have-adhd/issues/96), reported by `nbali` — "cap lists at 5" drops relevant findings. Hence: group and rank, never truncate.
- [i-have-adhd#43](https://github.com/ayghri/i-have-adhd/issues/43), reported by `kuhlsnu` — style rules collide with the harness system prompt. Hence the precedence clause: the harness outranks the style.
- [i-have-adhd#112](https://github.com/ayghri/i-have-adhd/issues/112) — over-adherence stalls tool use into "want me to?" loops. Hence: do the work instead of asking.

## License

[MIT](LICENSE)
