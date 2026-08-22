# Why the opus baseline is unstable in the clean room

Written 2026-08-17, after the 260-call clean sweep. Every figure below is printed by

```
node evals/analysis/instability.mjs
```

which reads only committed rows under `evals/results/`. **No new calls were bought for this
analysis.** Nothing under `evals/results/` was modified.

## The short answer

The instability is **a property of particular prompts, on a particular model**, and it is
**not a harness fault**. The `clean` environment plausibly amplifies it, but that comparison
is confounded and the confound cannot be removed from the data we hold.

Ranked by how much of the effect each explains:

1. **Three of the twelve prompts own 82% of the variance.** It is not spread across the suite.
2. **The model matters, and it is one model.** In an identical sparse environment
   `claude-opus-4-8`, `claude-sonnet-5` and `claude-fable-5` produce zero short answers in
   thirty calls, at 7.3-10.8% CV. Sparse `claude-opus-5` is at 68.6%.
3. **Sparse context gates it.** The 70-call probe below settles this: sparse opus-5 returns a
   sub-600-character answer on 12 of 20 calls, dense opus-5 on 0 of 20, and 460k characters of
   meaningless filler suppress the mode exactly as well as the operator's real config does.
   Density is the cause; the content of that context is not.
4. **The harness is exonerated.** No cache effect, no ordering effect, no trial-level state,
   provenance verified per row.

And one finding that outranks all of them for what to do next:

5. **More trials cannot fix this. More prompts can.** With twelve prompts the 95% interval on
   BLUF's mean effect cannot get below ±25% of a baseline response however many trials are
   bought, because the dominant variance is *between prompts*, and that term does not shrink
   with repetition.

---

## 1. The instability is concentrated, not distributed

`opus / clean / baseline`, share of the total across-trial variance:

| prompt | SD | share | cumulative |
| --- | ---: | ---: | ---: |
| `docker-cache-miss` | 1856 | 55.4% | 55.4% |
| `scheduled-jobs` | 934 | 14.0% | 69.5% |
| `shared-types` | 887 | 12.7% | 82.2% |
| `health-endpoint` | 688 | 7.6% | 89.8% |
| `ci-exit-1` | 549 | 4.8% | 94.6% |
| the other seven | ≤450 | 5.4% | 100% |

`port-default` has an SD of 16 tokens. `to-sorted` 47. The suite is not noisy; three prompts are.

## 2. It is two discrete answer modes, not a spread

Sorted trial series, `opus / clean / baseline`:

```
docker-cache-miss   460 | 4242  4631  4720  4748     one short answer, four long ones
shared-types        314   330   363 | 1810  2081     three short, two long
scheduled-jobs      303   343   674 | 1588  2466
ci-exit-1           177   284   313   387 | 1506
health-endpoint     270 | 1230  1380  1456  2193
```

Five of twelve prompts have a ≥2.5× gap between adjacent sorted values. For contrast: one of
twelve in `opus/clean/bluf`, one in `fable/clean/baseline`, and **zero in all four `full` arms**
— though `full` has only three trials, which is fewer chances to catch a rare mode.

The model is not drawing a length from a distribution around a mean. It is choosing between
answering briefly and writing the full treatment, and on these prompts that choice is close to a
coin flip.

## 3. It is per-call, not per-trial

No shared state explains it:

| arm | mean pairwise *r* between prompts' z-scores | rows with a cache read | input span |
| --- | ---: | ---: | ---: |
| opus/clean/baseline | **−0.019** | 0/60 | 41 tokens |
| fable/clean/baseline | −0.043 | 0/60 | 43 tokens |
| opus/full/baseline | 0.023 | 0/36 | 43 tokens |

If a trial ran "chatty", every prompt in it would run long together and *r* would be strongly
positive. It is zero. Position within the sweep does not predict output length either
(*r* = 0.024 for opus/clean/baseline). Every one of the 240 clean rows was a cold cache write,
and the input token count varies by ~40 tokens across a whole file — the calls are as identical
as a paid API allows.

## 4. The 80% trial-sum spread needs no explanation of its own

It is twelve independent draws being added up, and three of them are heavy-tailed:

| arm | predicted CV of the sum | observed CV |
| --- | ---: | ---: |
| opus/clean/baseline | 19.9% | 22.0% |
| fable/clean/baseline | 13.9% | 9.5% |
| **opus/full/baseline** | **5.6%** | **1.6%** |

Independent per-prompt variance predicts the clean spread almost exactly. It **over**-predicts
the `full` spread threefold — meaning the famous 3.2% max/min is partly luck of offsetting
prompts at n=3, and **the 3.2%-versus-80% headline overstates a real but smaller gap.** Compare
per-prompt CV instead, which does not depend on how the prompts happen to cancel.

## 5. The environment effect, with the trial count held equal

`clean` has five trials and `full` has three, and CV estimated from three draws misses rare
modes. Subsampling all ten 3-of-5 trial subsets of `clean` removes that:

| model | clean, mean per-prompt CV (ten 3-trial subsets) | full (n=3) | subsets at or below full |
| --- | --- | ---: | ---: |
| opus | 32.0% – 52.2% (median 41.4%) | **15.0%** | **0/10** |
| fable | 22.1% – 34.3% (median 31.3%) | 16.8% | 0/10 |

On trial-sum spread the split is sharper: 0/10 opus subsets reach `full`'s stability, but
**7/10 fable subsets do** — `fable` in `full` already spreads 26.8%. So the environment effect
on the *sum* is an opus finding, not a general one.

## 6. Density changes the level too — and that is what killed the −30.9%

Sum of per-prompt medians across the twelve prompts:

| model | baseline clean → full | BLUF clean → full | reduction, clean | reduction, full |
| --- | --- | --- | ---: | ---: |
| opus | 12,137 → 21,937 (**×1.81**) | 11,094 → 14,720 (×1.33) | **−8.6%** | **−32.9%** |
| fable | 10,504 → 13,920 (×1.33) | 7,376 → 9,069 (×1.23) | −29.8% | −34.8% |

A dense context nearly doubles opus's *unstyled* answers while moving the styled ones by a
third. In `full` there was a great deal of verbosity for BLUF to remove; in `clean` opus already
answers at close to BLUF's length, so there is little left to cut and the percentage collapses.

Worth ruling out explicitly: **this machine has no `~/.claude/CLAUDE.md`.** The 122k tokens
`full` carries are plugin, MCP and skill definitions, not prose telling the model how to answer.
The mechanism is context density, not a smuggled instruction.

## 7. The swing is in the visible answer

`chars` is `payload.result.length` — the final answer only — while `outputTokens` counts
everything generated. If the instability lived in reasoning tokens, `chars` would be steady.
It is not: for `opus/clean/baseline` the trial-sum spread is 80% in output tokens and **91% in
answer characters**. The model really does write 311 characters one run and 5,415 the next.

Two side observations from the same decomposition, neither of which is the mechanism:

- **A large constant non-answer component exists in every environment.** The median row has
  ~66% of its output tokens unaccounted for by `payload.result` (55% in `full`, 41–42% for
  fable). Whatever that is — reasoning most likely — the harness bills it, reports it as
  "output", and has never separated it. BLUF's saving in `opus/clean` is 87% visible answer
  text and 13% non-answer.
- **8 of 384 rows billed over 300 output tokens and returned under 0.5 characters per token**,
  the worst being `opus/clean/baseline docker-cache-miss` trial 4 at **4,748 tokens for 136
  characters**. One is in `full`, so it is not clean-room specific. 2% of rows; worth a
  quarantine rule, not an explanation.

## 8. What this says about BLUF

Each prompt treated as one cluster, paired baseline−BLUF delta:

| arm | n | mean delta | SE | t | 95% CI | as % of baseline | shorter / longer / indeterminate |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| opus/clean | 5 | **−7** | 165 | −0.04 | [−337, +323] | −0.7% [−32%, +31%] | 5 / 1 / 6 |
| fable/clean | 5 | +306 | 81 | 3.79 | [+145, +468] | +33.0% [+16%, +50%] | 8 / 0 / 4 |
| opus/full | 3 | +567 | 104 | 5.44 | [+358, +775] | +30.9% [+20%, +42%] | 8 / 0 / 4 |
| fable/full | 3 | +447 | 91 | 4.90 | [+265, +630] | +37.1% [+22%, +52%] | 11 / 0 / 1 |

The opus/clean null is a genuine point estimate of zero, not merely a wide interval around a
positive effect. But the interval is wide enough that a true 25% saving is not excluded. Both
statements are true and both should be said.

## 9. The design consequence: buy prompts, not trials

Decomposing the paired delta for `opus/clean`: between-prompt SD **427**, within-prompt
run-to-run SD **849**. The within term shrinks as 1/√n. The between term does not shrink at all.

95% CI half-width for the mean effect, as a percentage of a mean baseline response:

| prompts \ trials | 3 | 5 | 10 | 20 | 40 | calls at n=5 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **12** | ±36% | **±32%** | ±28% | ±26% | ±25% | 240 |
| 24 | ±25% | ±22% | ±20% | ±18% | ±18% | 480 |
| 36 | ±21% | ±18% | ±16% | ±15% | ±14% | 720 |
| 60 | ±16% | ±14% | ±12% | ±12% | ±11% | 1200 |
| 120 | ±11% | ±10% | ±9% | ±8% | ±8% | 2400 |

The shipped design is the top row. Reading **across** it — 5 trials to 40 — costs eight times
the calls and buys seven points. Reading **down** it at n=5 — 12 prompts to 60 — costs five
times the calls and buys twenty-two points. The 5-trial decision that Component 2 made in
response to the noisy clean room was the more expensive of the two available moves.

## 10. The confound that is not removable from committed data

**Every `full-*.jsonl` row is `scheduleVersion` 1 and records no `cliVersion`. Every
`clean-*.jsonl` row is version 2 on CLI 2.1.222.** Under version 1 a prompt's repetitions ran
back to back; under version 2 they are ~24 calls apart in a reshuffled order. `evals/results/README.md`
already states the two generations' cross-trial ranges are not comparable — and the whole
clean-versus-full contrast rests on exactly that comparison.

The only place both schedules exist in one environment is `lean`, opus, two prompts, and it
does not settle the question:

| arm | v1 (n=3) | v2 (n=5) | verdict |
| --- | --- | --- | --- |
| baseline `port-default` | CV 2.4% | CV 42.1%, subsets 24.6–58.2% | v1 below all ten subsets — supports a schedule effect |
| baseline `docker-cache-miss` | CV 11.4% | CV 11.5%, subsets 4.7–14.5% | overlapping — no effect visible |
| bluf `docker-cache-miss` | CV 25.6% | CV 8.8%, subsets 5.7–11.9% | v1 above all ten — opposite direction |

One for, one null, one against.

And a direct counter-example to a simple monotone density story, all `scheduleVersion` 2,
opus baseline:

```
clean (~3,600 input)  port-default  [262, 236, 245, 219, 245]  CV  6.5%
lean  (~4,840 input)  port-default  [119, 284, 168, 245, 107]  CV 42.1%
```

The **sparser** environment is the calmer one on that prompt.

## 11. External calibration

This is not exotic. CASTILLO (arXiv [2505.16881](https://arxiv.org/abs/2505.16881)) generated ten
completions per prompt across 13 open models and 7 datasets and reports within-prompt response
length CV of **7% to 45%**, noting the standard deviation "can reach up to half of the value of
the average response length". Our `opus/clean` mean per-prompt CV of 46.2% sits at the top of
that published band; `opus/full` at 15.0% sits mid-band. Neither is anomalous.

No published work was found reporting the *context-density* effect on that variance. If it
survives a controlled probe, that part looks new.

---

# The probe: 70 calls, and it resolves the question

Run 2026-08-17. Rows in `evals/results/probes/density-ladder.jsonl`, script beside them,
analysis in `evals/analysis/density.mjs`. One prompt (`scheduled-jobs` — *"What are my options
for running scheduled jobs in a Node service?"*), Default style, ten repetitions per arm.

**The confound is gone by construction.** Every call is an independent single invocation, so
there is no execution schedule at all, and all 70 rows carry CLI 2.1.222 and a canonical model
matching the request.

**One deviation from the plan, stated because it changes what the arm is.** The padding was
sized for ~120k tokens to match `full`; 460,024 characters of data-shaped filler tokenised at
~2.4 characters per token and produced **189,836**. The padded arm therefore sits *above*
`full` rather than beside it. It still tests density monotonically and still separates inert
filler from real tool definitions — but it is not the like-for-like match originally described.

## The result

| arm | model | median input | median out | CV | short answers |
| --- | --- | ---: | ---: | ---: | ---: |
| clean | opus-5 | 3,592 | 1,194 | **68.6%** | **5/10** |
| lean | opus-5 | 4,838 | 1,218 | **57.4%** | **7/10** |
| padded (inert filler) | opus-5 | 189,836 | 1,391 | 23.1% | 0/10 |
| full (real config) | opus-5 | 121,599 | 2,150 | 17.1% | 0/10 |
| trend | opus-4-8 | 2,616 | 803 | 7.5% | 0/10 |
| trend | sonnet-5 | 2,617 | 947 | 10.8% | 0/10 |
| trend | fable-5 | 3,935 | 1,067 | 7.3% | 0/10 |

A "short answer" is under 600 characters in `payload.result`.

## What it says

**1. There is a second answer mode, and it is real.** Answer lengths in characters, sorted:

```
clean   opus-5    303  355  378  394  547 | 2246 3005 3505 3675 3720
lean    opus-5    101  129  193  337  402  461  476 | 2512 3382 3834
padded  opus-5                             2459 2608 2621 2792 2807 2982 3044 3072 3254 3283
full    opus-5                             2261 2401 2454 3008 3074 3510 3752 3797 3980 4263
opus-4-8                                   1848 1877 2011 2047 2069 2080 2207 2248 2284 2287
sonnet-5                                   1979 2027 2071 2084 2101 2101 2137 2157 2158 2330
fable-5                                    2174 2293 2337 2338 2366 2537 2542 2566 2659 2873
```

Every arm except sparse opus-5 lives in a single tight band from 1,848 to 4,263 characters.
Sparse opus-5 also produces answers of 101, 129, 193, 303, 337, 355, 378, 394, 402, 461, 476
and 547 characters — a wholly separate cluster with nothing in between.

**2. Context density gates the mode, and the content of that context is irrelevant.**

| comparison | short answers | Fisher exact, two-sided |
| --- | --- | ---: |
| opus-5 sparse vs opus-5 dense | 12/20 vs **0/20** | **p = 4.5 × 10⁻⁵** |
| clean vs padded alone | 5/10 vs **0/10** | p = 0.033 |
| opus-5 sparse vs the other three models, all sparse | 12/20 vs **0/30** | **p = 1.0 × 10⁻⁶** |

**460,024 characters of meaningless inventory filler suppress the short mode exactly as well as
the operator's real 122k of tool and skill definitions do.** That is the discriminator the probe
was built for, and it comes down on the side of raw density.

**3. It is one model, not a trend.** `claude-opus-4-8` — opus-5's own predecessor —
`claude-sonnet-5` and `claude-fable-5` all sit at 7.3–10.8% CV in the same sparse environment,
with a largest adjacent ratio of ×1.08–1.09 and not one short answer in thirty calls. Sparse
opus-5 is at 68.6% with a ×2.39 gap. The brief hoped for a cross-model trend; there isn't one,
and the absence is the more striking result.

**4. Density gates the mode; content sets the level.** `full` is *smaller* in input than
`padded` (121,599 vs 189,836) and yet draws a longer answer — mean 2,138 against 1,473, exact
permutation p = 0.0009. Real tool and skill definitions add length that inert filler of greater
size does not. The two effects separate cleanly: **density suppresses the short mode, content
raises the level.**

**5. `lean` was never dense enough, which retires the counter-example.** At 4,838 input tokens
`lean` behaves like `clean`, not like the dense arms: CV 57.4%, 7/10 short answers, and no
detectable spread difference from `clean` (p = 0.88). Section 10's `port-default` oddity was two
equally sparse arms differing by chance, not evidence against density.

**6. In the dense arms the answer is locked and only the reasoning moves.** Answer-character CV
is 9.7% in `padded` against an output-token CV of 23.1%; in `clean` it is 85.6% against 68.6%.
Dense context pins what gets written and leaves the thinking free to vary.

## Why this killed the ship gate

BLUF's job is to shorten answers. In `clean`, opus-5's *unstyled* answer is already 300–550
characters on more than half of calls — at or below what BLUF itself produces. There is nothing
left to cut, so the measured effect collapses to −7 tokens. In `full`, the unstyled baseline is
reliably 2,261–4,263 characters and the style has real work to do, which is what the published
−30.9% measured.

The −30.9% was not wrong about `full`. It was never a statement about a sparse context, and the
clean-room re-run did not refute it so much as measure a different regime.

## Honest limits

- **One prompt, ten calls per arm, one machine, one CLI version.** The mode's existence is
  established at p ≈ 10⁻⁵; its *rate* — roughly 60% of sparse opus-5 calls — rests on 20 calls.
- **The variance tests are weaker than the mode test.** Brown-Forsythe on ten heavy-tailed
  points gives p = 0.046 for clean-vs-padded and only p = 0.16 for clean-vs-full. Both are
  reported above rather than only the favourable one. Fisher on the short-answer proportion is
  the better-powered test, because the claim is about a mode and not a spread.
- **The padded arm overshot** to 189,836 tokens, so density is demonstrated at ~190k and at
  ~122k but nowhere between 4,838 and 121,599. The threshold is unmeasured.
- **Inert filler is not neutral in every respect.** It is instruction-free and data-shaped, but
  a very large block of meaningless text is its own unusual condition.
- **Nothing here says the short answer is worse.** Adequacy is Component 4's question and
  remains unmeasured.

## What this changes for the benchmark

1. **A sparse clean room is not a neutral measuring environment for opus-5.** It puts the model
   into a regime it does not occupy in real use, where a Claude Code session always carries
   substantial context. Measuring a verbosity style there measures the wrong thing.
2. **The `full` figure describes real usage better than the `clean` figure does** — at the cost
   of being machine-specific. Padding with inert filler to a controlled size is a third option
   that is both dense and reproducible, and it is now known to work.
3. **Buy prompts, not trials** (section 9), whichever environment is chosen.

## What remains open

- **Where between ~5k and ~122k input tokens the mode disappears.** Untested.
- **Whether the short answer is adequate.** The 303-character reply may be a perfectly good
  answer to *"what are my options"*. Nothing here judges it.
- **Whether other prompts show the same mode on sparse opus-5.** The committed sweep rows
  suggest yes for at least `docker-cache-miss`, `shared-types`, `ci-exit-1` and
  `health-endpoint`, but only `scheduled-jobs` has been measured at n=10.
