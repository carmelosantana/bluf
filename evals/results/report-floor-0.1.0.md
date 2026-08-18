# Minimal-sufficient floor — prose sweep (0.1.0)

**On 6 of the 12 cases the styled arm's median response is shorter than the hand-written
floor for that case, and 26 of its 60 individual responses came in under it.** The
baseline arm is below its floor on 2 cases and 9 of 60 responses. The styled arm's median
case sits **+4.2%** over the floor against the baseline's **+73.3%** — that is, on a
typical case the baseline has roughly two-thirds of its length to spare and the styled
output has essentially none.

That is the headline, and section 4 argues it is weaker than it first reads. It is
nonetheless the first thing in this report, because a result that embarrasses the
instrument's own project belongs at the top and not in a limits section.

**No API call was made to produce this report.** Every figure is recomputed from committed
files by `evals/test/floors.test.mjs`. If a number here and that test disagree, the test is
right.

## 0. Who wrote the floors

**The twelve floors under `floors/` were written by an AI assistant, in the same session
that produced this analysis. They were not written by an independent human, and they were
not reviewed by one before this report was generated.** The author of a yardstick that
makes an adjacent project look good has an obvious incentive; nothing here neutralises it.

Two things partly offset it, and neither is a substitute for independent review:

- **Each floor states its own requirements.** Every file carries a header naming what the
  answer must contain to count as sufficient, and the body is written to that standard and
  no further — including explicit "does not require" clauses listing the material that was
  deliberately left out. A reader who thinks a floor is too long or too short can argue
  against a written standard rather than against taste.
- **They are committed, so they can be edited and the numbers rerun.** The floors are the
  disputable part of this instrument by design. Change a floor, run `npm test`, and the
  test will tell you exactly which figures moved.

Read every number below as "excess over one particular reader's opinion of sufficiency",
not "excess over sufficiency".

## 1. Method, and why the unit is characters

**The unit is characters, and both sides of every comparison are directly measured. There
is no token estimate anywhere in this report.**

- The **floor** side is the character length of the committed floor body, frontmatter
  excluded. The header states the requirements; it is the argument for the floor, not the
  floor, so it is not counted.
- The **response** side is the `chars` field on each committed row, which
  `evals/lib/runner.mjs` records as `result.length` — the character length of the
  assistant's response text, captured at measurement time.

Comparing floors against `outputTokens` would have put the analysis in the same unit as
the project's published figures, and it was rejected for two reasons.

The first is that no tokenizer is available and this project adds no dependency, so a
floor's token count could only be estimated from a chars-per-token divisor. Printing an
estimate beside a measured `outputTokens` figure, in the same table, in the same unit, is
the exact failure this repository exists to avoid.

The second is stronger, and would apply even with a perfect tokenizer.
`usage.output_tokens` bills everything the model generated, **including thinking**, and a
floor has no thinking to correspond to. Across the 120 committed rows, chars-per-token
ranges from **0.25 to 3.26** with a median of **2.38**. A row at 0.25 spent nearly all of
its output budget reasoning and emitted almost no prose; a row at 3.26 barely thought at
all. Dividing such rows by any single constant does not approximate the answers' lengths,
it invents them.

So the whole analysis runs in characters. The cost of that choice is stated rather than
hidden: **these figures are not in the same unit as the published −25.7%**, which is a
token figure. Section 5 handles the translation without pretending it is exact.

What it would take to do this in real tokens: a tokenizer for the model's vocabulary
applied to the committed floor bodies, or a paid capture that sends each floor through the
API and reads its input-token count back. Neither is approximated here.

**The rows.** `clean-claude-fable-5-baseline.jsonl` and `clean-claude-fable-5-bluf.jsonl` —
12 cases × 5 trials × 2 conditions, `claude-fable-5`, `clean` environment, schedule version
2. The same rows behind the project's published −25.7%.

**Per-case figures are medians across the 5 trials**, following the convention in
`evals/lib/report.mjs`, so one runaway or one stub does not move a case. The
trials-below-floor count is given alongside because the median hides it, and it is the
sharper signal: it says how *often* an arm returned less than a floor's worth of answer.

## 2. Per case

Excess is `(response chars − floor chars) / floor chars`. A negative figure means the
response was shorter than the floor. "Under" counts individual trials below the floor, out
of 5.

| Case | Category | Floor | Base (med) | Excess | Under | BLUF (med) | Excess | Under |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 5 | 316 | +6220.0% | 0/5 | 46 | +820.0% | 0/5 |
| git-no-ff | short-lookup | 242 | 1012 | +318.2% | 0/5 | 268 | +10.7% | 0/5 |
| to-sorted | short-lookup | 76 | 528 | +594.7% | 0/5 | 108 | +42.1% | 0/5 |
| health-endpoint | multi-step | 601 | 2176 | +262.1% | 0/5 | 986 | +64.1% | 0/5 |
| actions-workflow | multi-step | 557 | 885 | +58.9% | 2/5 | 506 | **−9.2%** | 5/5 |
| cjs-to-esm | multi-step | 813 | 131 | **−83.9%** | 3/5 | 2802 | +244.6% | 1/5 |
| 401-no-evidence | debug | 1038 | 232 | **−77.6%** | 3/5 | 486 | **−53.2%** | 5/5 |
| ci-exit-1 | debug | 1615 | 2094 | +29.7% | 1/5 | 605 | **−62.5%** | 5/5 |
| scheduled-jobs | options | 1387 | 2203 | +58.8% | 0/5 | 1354 | **−2.4%** | 3/5 |
| shared-types | options | 1566 | 2940 | +87.7% | 0/5 | 1462 | **−6.6%** | 3/5 |
| security-headers | long-list | 1719 | 3611 | +110.1% | 0/5 | 2131 | +24.0% | 0/5 |
| docker-cache-miss | long-list | 2703 | 4160 | +53.9% | 0/5 | 2546 | **−5.8%** | 4/5 |

Aggregates:

| | baseline | BLUF |
| --- | ---: | ---: |
| Median case excess | +73.3% | **+4.2%** |
| Weighted excess (medians × trials vs floor × trials) | +64.6% | **+7.9%** |
| Weighted excess (raw summed chars vs floor × trials) | +81.6% | **+4.7%** |
| Cases whose median is below floor | 2 of 12 | **6 of 12** |
| Individual trials below floor | 9 of 60 | **26 of 60** |

The two weighted rows differ because one is built from per-case medians and the other from
the raw sum. They are given together rather than one being chosen, because the gap between
them *is* the variance: the baseline's raw sum is the larger of the two (its long tail is
long), the styled arm's is the smaller (its short tail is short).

## 3. What the two arms fail at is not the same thing

The baseline is below floor on `cjs-to-esm` (median 131 characters) and `401-no-evidence`
(median 232). Those are not compressed answers; at that length they are not answers.
Three of five baseline `cjs-to-esm` trials landed at 102–131 characters while billing
141–178 output tokens, which means the model thought and then said almost nothing — a
clarifying question or a stub is the most likely shape, though the response text is not
committed so this cannot be confirmed. Both are among the three widest baseline spreads in
the corpus — `cjs-to-esm` runs 102 to 5276 characters across its five trials (a 52× range)
and `401-no-evidence` runs 98 to 2078 (21×), with `actions-workflow` at 32× between them,
against 1.1×–1.4× for every other case. Whatever is happening there is instability, not
brevity.

The styled arm's below-floor cases are the opposite shape: consistent, and clustered in
the categories where sufficiency costs the most words. `ci-exit-1` (−62.5%, 5 of 5 trials
under) and `401-no-evidence` (−53.2%, 5 of 5) are both `debug-partial-evidence` — the two
cases whose floors argue that a complete answer must supply a *diagnostic path* precisely
because a diagnosis is not available. Those floors are the third and sixth longest of the
twelve. `scheduled-jobs`, `shared-types`, `docker-cache-miss` and `actions-workflow` are
each within 10% of their floor, which section 4 says is inside the noise; `ci-exit-1` and
`401-no-evidence` are not.

One of those two should not be laid at the style's door, and saying so matters more than
the count. **On `401-no-evidence` the styled arm is the *longer* of the two** — median 486
characters against the baseline's 232 — so both arms sit under that floor and the style
moved the answer *toward* sufficiency, not away from it. Only `ci-exit-1` shows the style
crossing the line on its own: the baseline sits **+29.7%** above the floor and the styled
arm **−62.5%** below it, on 5 of 5 trials, a gap far outside section 4's ±17% calibration.

So the sharpest honest statement this instrument supports is a single case, not six:
**on `ci-exit-1` the unstyled answer cleared the floor and the styled answer did not.**
That it is a `debug-partial-evidence` case is the part worth attention — those are the
prompts where a complete answer is a diagnostic path rather than a fact, and a length rule
has no way to tell a diagnostic path from padding.

## 4. Calibrating the floor against the responses we can actually read

The `.jsonl` rows store no response text, so nothing above scores a real response against
a floor's stated requirements — it compares lengths, and length is a proxy. `samples/`
holds verbatim text for five of the twelve cases under the shipped rules, which is enough
to bound how much the proxy can be trusted. These samples are `claude-opus-5` captures of
the 0.2.0 rule text (byte-identical to shipped BLUF per `samples/CAPTURE.md`) and are
**not rows in this sweep**; a different model and a different capture, used here only to
ask whether a given excess figure corresponds to a sufficient answer.

| Sample | Floor | Sample chars | Excess | Sufficient against the floor's stated requirements? |
| --- | ---: | ---: | ---: | --- |
| `port-default.claude-opus-5.0.2.0` | 5 | 5 | +0.0% | Yes — "5173." is the whole requirement |
| `git-no-ff.claude-opus-5.0.2.0` | 242 | 571 | +136.0% | Yes, with room to spare |
| `scheduled-jobs.claude-opus-5.0.2.0` | 1387 | 1524 | +9.9% | Yes — options, tools, deciding trade-off, all present |
| `docker-cache-miss.claude-opus-5.0.2.0` | 2703 | 2599 | −3.8% | Yes — all five families, the cascade rule, and the find-the-culprit command |
| `401-no-evidence.claude-opus-5.0.2.0` | 1038 | 867 | −16.5% | Yes — refuses to name a cause, says what a 401 establishes, gives the logging line and four candidates |

Five for five, at excesses from −16.5% to +136%. That is the useful finding of this
section and it cuts against the headline: **a response can be up to roughly 17% under
these floors and still satisfy their own stated requirements.** The floors are prose, and
prose written by one hand at one sitting is not accurate to better than about that.

So the sensible reading of section 2 is a threshold, not a sign test:

- `scheduled-jobs` (−2.4%), `docker-cache-miss` (−5.8%), `shared-types` (−6.6%) and
  `actions-workflow` (−9.2%) are **inside the floors' own precision**. Four of the styled
  arm's six below-floor cases are not evidence of anything.
- `401-no-evidence` (−53.2%) and `ci-exit-1` (−62.5%) are **outside it by a factor of
  three**, on 5 of 5 trials each. Those two are a real signal, and they are the two cases
  where the floor argues the answer's whole value is a diagnostic path.

Note also that the −16.5% sample is `401-no-evidence` itself — the same case that measures
−53.2% here. A styled answer to that prompt was sufficient at 867 characters; the fable
rows in this sweep median 486.

## 5. What this means for the published −25.7%

The project's headline is a token figure and this report is in characters, so the two do
not compose arithmetically. What can be said, from the same 60 pairs:

- Per-trial output-token reduction: −23.8% / −42.0% / −20.6% / −25.7% / −49.3%, median
  **−25.7%** — the published figure, reproduced from these rows.
- Per-trial response-character reduction on the identical rows: −38.6% / −41.6% / −33.5% /
  −30.9% / −61.0%, median **−38.6%**.

The style cuts *prose* considerably harder than it cuts *billed output*, because billed
output includes thinking the style does not govern. Anyone quoting −25.7% as the amount of
answer removed is understating it; the answer shrank by more than a third.

Against that, the floor says: **the reduction lands the typical case just above the floor
and not comfortably above it.** +4.2% median excess is not headroom. The published figure
is not too large — it is, if anything, too small — but it is being read against no
denominator at all, and this instrument's contribution is to say that on this corpus the
remaining margin is thin rather than generous, and on two cases the margin is gone.

What this does **not** support is "the style produces insufficient answers." Section 4 rules
that out for four of the six below-floor cases and leaves two standing, on 12 cases with a
yardstick written by one AI author in one session. The honest summary is: on this corpus,
under this reader's standard of sufficiency, the styled output has roughly no slack left,
and the `debug-partial-evidence` category is where it has already run out.

## Limits

- **The floors are one AI author's opinion, written in this session** (section 0). They
  are the disputable half of the instrument and are committed so they can be disputed.
- **Section 4 measures the floors' precision at about ±17%,** from five samples. That is a
  small calibration set, and it bounds every negative figure in section 2 that is smaller
  than it.
- **Characters are a proxy for content.** Nothing here scores a real response against a
  floor's requirement list; the sweep did not record response text. A denser answer that
  covers everything in fewer characters would read as below-floor and be wrong to. The
  five samples in section 4 are the only place a real response is checked against
  requirements, and they cover five cases out of twelve.
- **`chars` is final response text only.** Some rows pair a small `chars` with a large
  `outputTokens` (a 0.25 chars-per-token minimum across the corpus). Those rows spent
  their budget on thinking. This measure counts what the user was given, which is the
  right choice for a sufficiency question, but it means a row can be below floor while
  having been expensive.
- **12 cases, 5 trials, 1 model, 1 environment.** No claim here generalises past this
  corpus, and the categories are 2–3 cases each, so a per-category statement rests on two
  or three floors.
- **The samples in section 4 are `claude-opus-5`, not the `claude-fable-5` rows measured
  here**, and were captured separately from this sweep. They calibrate the floors, not the
  arms.
- **Nothing here measures correctness**, only length against a length. A response can clear
  its floor by 200% and be wrong. `evals/results/report-adequacy-0.1.0.md` is the
  instrument that tries to address that, and its own result is a ceiling.
