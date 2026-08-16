# less-chatty

A Claude Code output style that leads with the conclusion and cuts filler — measured, including what it costs.

- Cuts assistant output tokens: **−33.1%** on claude-fable-5 and **−10.4%** on claude-opus-5. The terse variant cuts **−42.8%** and **−25.7%**. Measured on 12 Claude Code-shaped prompts in a full ~122k-token environment, 1 trial per case.
- Costs input tokens on every turn: **+2,040** (Less Chatty) or **+2,327** (terse). Prompt caching reduces that cost per session. It does not remove it.
- Total tokens went **up** in every cleanly measured case. This style buys shorter, denser answers. In this harness it did not buy a smaller bill.
- Every figure is single-trial. Two identical baseline runs drifted 7.1–7.6% (fable) and 8.3–9.1% (opus), depending on the denominator. The Opus −10.4% sits close to that band — read it as directional only. See [Variance](#variance).
- An earlier version of this style made Opus 5 **more** verbose, by +32.2%. Measuring across models caught it. See [The v1 regression](#the-v1-regression-on-opus).

All numbers come from [`evals/results/report.md`](evals/results/report.md) and the archived [`evals/results/report-v1.md`](evals/results/report-v1.md), committed in this repo.

## Before / after

Prompt: *"In git, what does `--no-ff` do on a merge?"* — claude-opus-5, tools disabled. **This pair is an illustrative capture taken separately, after the measured sweep. It is not a row from the results table.** The sweep's own `git-no-ff` opus row measured 495 → 162 output tokens. Both responses below are captured verbatim in [`evals/results/samples/`](evals/results/samples/). The two token counts come from the `usage.output_tokens` field of each capture; the exact commands are recorded in [`samples/CAPTURE.md`](evals/results/samples/CAPTURE.md).

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

**Less Chatty — 183 output tokens** ([full text](evals/results/samples/git-no-ff.claude-opus-5.v2.txt)), in full:

> `--no-ff` forces git to create a merge commit even when the branch could fast-forward.
>
> Without it, if your current branch has no commits since the branch point, git just moves the pointer forward — no merge commit, and the branch's history looks like it was always linear. With `--no-ff`, you get an explicit merge commit with two parents, so the feature branch stays visible as a distinct set of commits.
>
> Common reasons to use it: keeping feature branches identifiable in the log, and making the whole feature revertable with a single `git revert -m 1 <merge-commit>`.

The cut is not free. The styled answer drops both ASCII commit-graph diagrams and a "related knobs" list covering `merge.ff`, `pull.ff`, and `--ff-only`. That is real content, not only padding. If you wanted those knobs, you now have to ask.

## Install

```bash
git clone https://github.com/carmelosantana/less-chatty.git
mkdir -p ~/.claude/output-styles
cp less-chatty/output-styles/*.md ~/.claude/output-styles/
```

Then run `/config`, select **Output style**, pick **Less Chatty**, and run `/clear`. `/config` opens a menu in the terminal. In the desktop app, set the `outputStyle` field in a settings file instead.

## The rules

Full text: [`output-styles/less-chatty.md`](output-styles/less-chatty.md). In summary:

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

**Unproven and opt-in.** It shrinks output tokens only. Input and reasoning tokens are untouched, and it costs more input than the base style (+2,327 per turn vs +2,040). On work that is already terse it can be net-negative, and it was not uniformly smaller in measurement: on opus, `ci-exit-1` came out +207 output tokens **larger** than baseline under terse.

It adds compression rules on top of the base style:

- Drop articles where the meaning survives. Fragments are allowed.
- Prefer the short synonym.
- Never invent an abbreviation — the tokenizer splits `cfg` like the full word, so it saves nothing.
- No arrows. Standard acronyms (DB, API, HTTP) are fine; never coin one.
- Compression never touches code, quotes, exact strings, or caveats.

## Measured results

Output tokens per case, 1 trial each, full environment. Source: [`evals/results/report.md`](evals/results/report.md).

| Case | Category | fable-5 base | fable-5 LC | fable-5 terse | opus-5 base | opus-5 LC | opus-5 terse |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 86 | 5 | 5 | 5 | 5 | 5 |
| git-no-ff | short-lookup | 281 | 109 | 97 | 495 | 162 | 141 |
| to-sorted | short-lookup | 159 | 54 | 77 | 139 | 40 | 50 |
| health-endpoint | multi-step | 904 | 527 | 537 | 1,092 | 879 | 555 |
| actions-workflow | multi-step | 743 | 334 | 593 | 659 | 655 | 505 |
| cjs-to-esm | multi-step | 2,226 | 1,787 | 1,489 | 2,386 | 2,379 | 2,346 |
| 401-no-evidence | debug | 1,413 | 547 | 466 | 898 | 507 | 551 |
| ci-exit-1 | debug | 1,314 | 983 | 1,209 | 1,081 | 786 | 1,288 |
| scheduled-jobs | options | 1,223 | 568 | 575 | 1,123 | 655 | 601 |
| shared-types | options | 1,041 | 623 | 550 | 1,404 | 1,330 | 737 |
| security-headers | long-list | 1,181 | 951 | 797 | 1,836 | 1,649 | 995 |
| docker-cache-miss | long-list | 2,431 | 2,215 | 1,040 | 3,473 | 4,029 | 3,069 |
| **Total** | | **13,002** | **8,703** | **7,435** | **14,591** | **13,076** | **10,843** |

The style loses on some rows even in v2. On opus, `docker-cache-miss` came out **+556** output tokens with Less Chatty, and `ci-exit-1` came out **+207** with terse. Those rows are in the table; they are not excluded from the aggregates.

The aggregate percentages are token-weighted: they divide summed tokens, not per-case percentages. The opus −10.4% is therefore dominated by the two largest cases, `docker-cache-miss` and `cjs-to-esm`, rather than being an average across cases.

### Why output tokens are the headline, not totals

The report's Δ total column is not trustworthy. Two v2 rows carry a cold-cache artifact where cache creation was billed in full at a cache boundary: `actions-workflow` under fable/terse shows a 249,649 candidate total against ~124–126k neighbours, and `security-headers` under opus/terse shows an impossible −17,948 total delta from an 841-token output cut. The same artifact appears in the archived v1 report as a ~245k baseline total against ~122k neighbours. Output tokens are reported by the API per response and carry no such artifact.

Setting the artifact rows aside, the total column tells one consistent story: every cleanly measured case costs between +938 and +2,599 more total tokens with the style on. That is the style's own input overhead. Whether the trade is worth it depends on your input-to-output price ratio, your cache hit rate, and how much you value reading less.

### Style input cost

Measured by isolating `port-default` in the lean environment, where the output delta is exactly 0 in every condition, so the total delta is pure style overhead: **Less Chatty +2,040 input tokens per turn, terse +2,327**. Prompt caching reduces this cost per session but does not remove it.

### Variance

1 trial per case. Between the v1 and v2 runs, the identical baseline condition produced 12,080 vs 13,002 output tokens on fable and 15,914 vs 14,591 on opus. That drift is 922 tokens on fable (7.6% of the v1 run, 7.1% of the v2 run) and 1,323 tokens on opus (8.3% of v1, 9.1% of v2). Per-case single-trial figures sit inside that noise. The aggregate direction is consistent across both runs; individual row deltas are not precise.

The consequence for the headline numbers: the fable results (−33.1%, −42.8%) clear the noise band comfortably. The opus Less Chatty result (−10.4%) is within roughly 1.2× of it and should be read as directional only, not as a precise effect size. The opus terse result (−25.7%) clears it.

## The v1 regression on Opus

The first version of this style cut fable-5 output by 22.7% and **inflated opus-5 output by 32.2%** (15,914 → 21,037). The full run is preserved in [`evals/results/report-v1.md`](evals/results/report-v1.md). This is the strongest argument for measuring across models at all: the same prompt made one model shorter and another longer.

What caused it, per the case data:

- The "Length is not terseness" block only ever forbade cutting. It never forbade adding, which Opus read as licence to expand.
- The summary became additive rather than substitutive. Opus wrote conclusion bullets **and** a full headed body saying the same thing.
- Nothing bounded unrequested context. `port-default` went from 5 to 66 output tokens purely from facts nobody asked for.
- "Never truncate" read as a mandate to enumerate every possibility.

Four v2 rule changes fixed it:

1. "Length is not terseness" now states it protects needed content and does not invite content the question did not ask for.
2. A new contract rule: "The summary replaces the body. It does not introduce it." Saying anything twice is forbidden, and the pre-send check now deletes any section that restates a bullet.
3. A new rule: "Answer what was asked, and stop."
4. "Never truncate" is scoped: relevant means it bears on the question asked. It stops you dropping what the reader needs; it does not ask you to enumerate.

### The regression fix, illustrated

Prompt: *"What port does the Vite dev server use by default?"* — case `port-default`, on claude-opus-5. This compares v1 against v2 of the style; it shows the regression being fixed, not the product's value over no style. Both responses are captured verbatim in [`evals/results/samples/`](evals/results/samples/).

| v1 style (retracted) | v2 style (current) |
| --- | --- |
| 5173.<br><br>Vite serves on `http://localhost:5173` by default. If that port is taken, Vite increments to the next free port (5174, 5175, …). Override it with `--port 3000` on the CLI or `server.port` in `vite.config.js`. | 5173. |

Nobody asked about port collisions or overrides. Opus without any style also answers this prompt in 5 output tokens, so the v1 style was a pure regression here — 66 tokens of unrequested context. On fable-5 the picture differs: the baseline answer was 86 output tokens, and the style cuts it to 5.

## Known limitations

- Output styles do not apply to subagents. A subagent runs its own system prompt. A fork is the exception, since it inherits the parent's.
- An output style takes effect only after `/clear` or a new session. Claude Code reads it once at session start.
- The style shrinks output tokens and adds input tokens on every turn. Prompt caching reduces that cost. It does not remove it.
- The terse variant is unproven.
- The two style files duplicate their shared body, because output styles have no import mechanism. `npm run check` enforces that the shared bodies stay byte-identical.
- Measured on two models with one trial per case. Your workload is not these 12 prompts.

## Reproducing

```bash
npm test          # 60 tests, zero dependencies, Node 22+
npm run check     # verifies the two style files share a byte-identical body
npm run measure   # re-runs the eval sweep
```

**`npm run measure` makes 78 live API calls and costs roughly $16–18.** It is not part of `npm test` and nothing runs it by accident. It rewrites `evals/results/`.

**Install the styles before measuring.** The sweep selects each condition by style name. If the two files are not in `~/.claude/output-styles/`, every condition silently resolves to the default and you measure Default against Default. Run the install step above first.

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
