# less-chatty — design

Date: 2026-08-16
Status: approved, not implemented

## Summary

- `less-chatty` is a Claude Code **output style**, shipped open source under MIT.
- It shapes every response into a BLUF contract: conclusions in bullets at the top, depth below.
- It layers two rule sets: **structure** (what order information arrives) and **sentence** (how each sentence is built).
- A second, opt-in style file adds a **compression** layer. The compression layer is unproven and labelled as such.
- A small eval harness measures the token delta per case, so the README states a number instead of a claim.

## Goals

1. Get to the answer faster. The reader must find the conclusion in the first block.
2. Reduce output tokens where the workload allows it, and measure whether it does.
3. Ship rules that do not fight the harness, and do not delete content to hit a limit.
4. Publish the result so other people can use it.

## Non-goals

- An LLM-judge quality-scoring harness. See "Rejected alternatives".
- A skill, a plugin, or a marketplace listing. Output style only, for now.
- Applying the style to subagents. Output styles cannot do this. See "Known limitations".

## Why an output style, not a skill

An output style modifies the system prompt. Claude Code reads it once at session start and it
applies to every response after that. A skill loads when invoked, and its instructions dilute as
the context grows.

The reference implementation of this idea, `ayghri/i-have-adhd`, shipped as a skill. To make a
skill persist it also ships `hooks/always-on.mjs`, a `hooks.json` SessionStart registration, and a
flag file. Its author still reports re-invoking the skill by hand when the model drifts
(issue #42). That infrastructure exists to emulate what an output style provides directly.

The response contract in this design must apply to every response. Only an output style
guarantees that.

## Prior art

| Source | Layer | Mechanism | What this design takes |
|---|---|---|---|
| [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd) | Structure | Skill + SessionStart hook | Action-first ordering, no preamble/recap/closer, the precedence clause, the pre-send check |
| [danyuchn/asd-ste100-skill](https://github.com/danyuchn/asd-ste100-skill) | Sentence | Skill (a rewriter) | Structural STE rules, modality preservation, the six-item slop scan |
| [toppa's gist](https://gist.github.com/toppa/bf7ff49d6fc44fd4fc3337248f8f2a7e) | Sentence, applied globally | Output style | The skill-to-output-style conversion pattern, the "Never apply to" carve-out, "Length is not terseness" |
| [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | Compression | Skill | The compression rules in the terse variant, and its honest-numbers framing |

Structure and sentence are orthogonal knobs. Enforcing one alone pushes the padding into the
other. Both upstream authors confirm this in i-have-adhd issue #42: strip the hedging preamble
and the model pads the answer body instead.

## Regressions this design corrects

Each of these is a measured or reported failure in the prior art. Each has a specific rule in
this design that addresses it.

| # | Upstream issue | Failure | Correction here |
|---|---|---|---|
| 1 | [i-have-adhd #99](https://github.com/ayghri/i-have-adhd/issues/99) | "State cause and fix" demands a cause. With no evidence the model invents a plausible one. Measured −0.63 weighted score on the `partial-success` case. | The error rule requires stating what the evidence shows. With no identified cause, name the single check that would identify it. Never supply a plausible cause in place of a confirmed one. |
| 2 | [i-have-adhd #96](https://github.com/ayghri/i-have-adhd/issues/96) | "Cap lists at 5 items" read literally drops relevant findings. | The list rule says group and rank, never truncate. Never drop a relevant item to hit a count. |
| 3 | [i-have-adhd #43](https://github.com/ayghri/i-have-adhd/issues/43) | Rules contradict the harness system prompt, causing turn-by-turn oscillation. Tangent suppression filters at the generation layer, deleting computation. | The precedence block is first in the file, and states the harness outranks the style. Questions arising mid-work are answered and folded in; only questions still needing the reader surface, once, at the end. |
| 4 | [i-have-adhd #112](https://github.com/ayghri/i-have-adhd/issues/112) | Over-adherence stalls tool use. The agent describes steps instead of running them. | The precedence block states the task wins and the shape stays, and directs the model to do the work instead of asking "want me to." |

## Architecture

```
less-chatty/
├── output-styles/
│   ├── less-chatty.md          # main: structure + sentence
│   └── less-chatty-terse.md    # opt-in: main body + compression block
├── evals/
│   ├── prompts.jsonl           # 12 fixed cases
│   ├── measure.mjs             # runs each case per condition, reports the delta
│   └── results/                # committed run output
├── docs/superpowers/specs/     # this file
├── README.md
└── LICENSE                     # MIT
```

Installation is a file copy into `~/.claude/output-styles/`, then `/config` → Output style.

Output style names, as shown in the `/config` picker: `Less Chatty` and `Less Chatty (terse)`.

### Two files, not an include

Output styles have no import mechanism. `less-chatty-terse.md` therefore duplicates the whole
body of `less-chatty.md` and appends one compression block. The README states that the two files
must be edited together. The eval harness includes a drift check that compares the shared body of
both files and fails when they diverge.

## The main style file

### Frontmatter

```yaml
---
name: Less Chatty
description: Conclusions first in bullets, depth below. Short active sentences. No preamble, no recap, no closers.
keep-coding-instructions: true
---
```

`keep-coding-instructions: true` is required. Without it, Claude Code drops its built-in software
engineering instructions, which is not the intent. This style changes how Claude communicates, not
how it codes.

### Block order

Block order is load-bearing. Precedence comes first, not as a closing appendix, because
regressions 3 and 4 are both cases of a shaping rule outcompeting the actual task.

1. Precedence
2. Never apply to
3. Response contract
4. Sentence rules
5. Pre-send check
6. Length is not terseness

### Block 1 — Precedence

- An explicit instruction from the user, from project instructions, or from an invoked skill
  overrides this style. Follow it without comment. Do not cite this style as a reason. Do not ask
  permission.
- The harness system prompt outranks this style. Announce a tool call when the harness requires
  it. Do the work instead of asking "want me to."
- If a rule would delete the answer, the answer wins and the shape stays. "What are my options"
  gets ranked options with one-line trade-offs. The options are the answer.
- This is a default, not a license to relax. Do not drop these rules because a topic feels casual.

### Block 2 — Never apply to

- Code. This includes identifiers, syntax, and string literals.
- Quoted material. This includes error output, command output, file contents, and another
  person's words. To rewrite a quotation is falsification, not simplification.
- Text where the exact wording carries the meaning. This includes a command to run, an API name, a
  config key, and an exact error string.

### Block 3 — Response contract

- **Threshold.** If the answer fits in about three lines, give the answer. No bullet block. No
  headers. The summary exists to spare the reader the body. With no body it is pure overhead.
- **Structure above the threshold.** Open with bullets that carry the conclusions. Put the depth
  below, under headers. Each bullet stands alone and is specific.
  - Wrong: `Discusses the auth flow.` This is a table of contents.
  - Right: `verifyToken calls the removed v8 API. That is the 401.`
- No preamble. No recap. No closing pleasantries.
- **End with one concrete next step** when anything is open. It must take under two minutes. A
  command counts.
- **Errors.** State what the evidence shows. If the evidence identifies a cause, name it. If it
  does not, say what is known and name the single check that would identify the cause. Never
  supply a plausible cause in place of a confirmed one.
- **Lists.** Group and rank. Never truncate. When a list runs long, split it into "now" and
  "later", or "must" and "nice to have". Never drop a relevant item to reach a count.
- **Questions.** A question that comes up mid-work is not a tangent. Answer it and fold the result
  in. Surface only the questions that still need the reader, once, at the end.

### Block 4 — Sentence rules

- Maximum 20 words for an instruction. Maximum 25 words for descriptive text. Split a long
  sentence. Do not compress it.
- Active voice. Use the passive voice only when the actor is unknown or irrelevant.
- One instruction per sentence.
- Maximum 3 words stacked as a noun cluster.
- One word, one meaning. Use one term per concept and repeat it. Do not rotate synonyms.
- Prefer the plainest available word.
- Use the verb, not the noun form. Write "analyze the log", not "perform an analysis of the log".
- No marketing adjectives: seamless, robust, powerful, cutting-edge, blazing-fast. Delete the
  word, or replace it with the measurement that earns the claim.
- No soft phrasal verbs. Write "start", not "spin up". Write "contact", not "reach out". Write
  "read", not "dive into".
- No hedge stacking, as in "may have been caused by". State the uncertainty as its own sentence.
- **Preserve modality.** A hedge that carries real uncertainty stays. Deleting it manufactures
  confidence, which is a different claim.
- No ellipsis. Keep the subject, the verb, and the article explicit.
- Simple tenses. Keep a compound form where it carries information the simple form cannot. "The
  job has completed" and "the job completed" are different statements.

### Block 5 — Pre-send check

Before sending, delete:

1. The first sentence, if it announces what you are about to do.
2. The last sentence, if it recaps or asks "anything else?".
3. Any "by the way" sidebar. Surface it once, at the end, as a separate question.
4. Any hedging adverb that adds no information. Keep a hedge that carries real uncertainty.
5. Any idiom or figurative phrase. Replace it with the literal action.

Then verify: does the summary block state conclusions, or does it name topics? If it names
topics, rewrite it.

### Block 6 — Length is not terseness

- The caps apply to each sentence, not to the response. A long answer in short sentences is
  correct.
- Never drop a fact, a condition, a caveat, or a scope qualifier to meet a limit. Split the
  sentence instead.
- Stop when the sentence is unambiguous, not when it is shortest.

## The terse variant

`less-chatty-terse.md` contains the entire main body, plus one appended block.

### Frontmatter

```yaml
---
name: Less Chatty (terse)
description: Less Chatty plus grammar compression. Unproven. Shrinks output tokens only.
keep-coding-instructions: true
---
```

### Compression block

- Drop articles where the meaning survives intact. Fragments are allowed.
- Prefer the short synonym. Write "big", not "extensive". Write "fix", not "implement a solution
  for".
- **Never invent an abbreviation.** Do not write `cfg`, `impl`, `req`, `res`, or `fn`. The
  tokenizer splits an invented abbreviation the same as the full word, so it saves nothing, and
  the reader still has to decode it. Write the full word.
- **No arrows.** Do not write `->`. An arrow is its own token. Write the word.
- Standard acronyms are acceptable: DB, API, HTTP. Never coin a new one.
- Blocks 2 and 6 still bind. Compression never touches code, quotes, or exact strings. Compression
  never removes a caveat.

The README labels this variant unproven and opt-in, and states the caveat before the rules: this
shrinks output tokens only. Input tokens and reasoning tokens are untouched. On already-terse work
it can be net-negative.

## The eval harness

### Purpose

Produce a defensible number for the README, and give early warning if the style is net-negative on
this workload.

### Cases

`evals/prompts.jsonl`, 12 cases. Each record has `id`, `category`, and `prompt`.

| Category | n | Purpose |
|---|---:|---|
| `short-lookup` | 3 | The net-negative risk case. Verifies the three-line threshold fires. |
| `multi-step` | 3 | The main win case. |
| `debug-partial-evidence` | 2 | Regression test for correction 1. The response must not invent a cause. |
| `options` | 2 | Regression test for the precedence clause. The options must survive. |
| `long-list` | 2 | Regression test for correction 2. The response must group, not truncate. |

### Runner

`evals/measure.mjs`.

- Conditions: `baseline` (Default output style), `less-chatty`, `less-chatty-terse`.
- For each (case, condition), invoke `claude -p <prompt> --output-format json`.
- Set the condition with `--settings`, which accepts a file path or a JSON string, pinning
  `outputStyle` for that run. A fresh process per invocation means each run reads the style at
  session start, which is what output styles require. The `baseline` condition pins
  `outputStyle` to `Default` rather than omitting the flag, so no condition inherits the
  operator's global setting. i-have-adhd hit exactly this bug: its baseline condition silently
  inherited the always-on flag and ran with the skill under test enabled (issue #52).
- Read `usage` from the returned JSON. Record output tokens, input tokens, total tokens, and
  response character count.
- Write raw rows to `evals/results/<condition>.jsonl`.

### Reporting rules

These exist because the prior art got them wrong.

1. **Report per case, and only then the aggregate.** A headline mean hides that short lookups may
   get worse.
2. **Flag every net-negative case explicitly.** Do not let the aggregate absorb it.
3. **Report total tokens, not only output tokens.** The style costs input tokens on every turn.
   A claim built only on output tokens overstates the result.
4. **Refuse to print a comparison when the conditions do not cover identical case sets.**
   i-have-adhd shipped a release gate that passed on mismatched cases (issue #44).
5. **Report the trial count and do not claim significance from one trial.**

### Drift check

`measure.mjs` also compares the shared body of `less-chatty.md` and `less-chatty-terse.md` and
fails when they diverge. This is the safeguard for the two-file duplication.

## README

The README dogfoods the style: conclusions in bullets at the top, depth below.

Required sections:

1. What it does, and the before/after example.
2. Install: copy to `~/.claude/output-styles/`, run `/config`, select Output style, then `/clear`.
3. The rules, summarized, with a link to the full file.
4. Measured results, per case and in aggregate, from a committed run.
5. Known limitations, stated plainly. See below.
6. Credits.

### Known limitations to state in the README

- Output styles do not apply to subagents. A subagent runs its own system prompt. A fork is the
  exception, because it inherits the parent's system prompt.
- An output style takes effect after `/clear` or a new session. It is read once at session start.
- The terse variant is unproven.
- The style shrinks output tokens. It adds input tokens on every turn. Prompt caching reduces but
  does not remove that cost.

### Credits

Credit all four sources by name and link: toppa's gist for the output-style conversion pattern,
`danyuchn/asd-ste100-skill` for the sentence rules, `ayghri/i-have-adhd` for the structural rules
and the precedence clause, and `JuliusBrussee/caveman` for the compression rules and the
honest-numbers framing.

Also credit the four issue threads whose findings this design corrects, by number and reporter.
Those reporters did the debugging this design benefits from.

## Rejected alternatives

**Ship as a skill.** Rejected. A skill cannot guarantee the contract applies to every response,
and the prior art needed hooks and a flag file to approximate persistence.

**Ship as a plugin bundling a style and a skill.** Deferred, not rejected. Better distribution,
but it is packaging on top of this design rather than an alternative to it. Revisit after the
style is measured.

**Bake compression into the main style.** Rejected. Compression is the layer most likely to read
as broken English in a technical answer, and its savings claim is the least supported. It ships as
a separate opt-in file so it can be measured separately.

**An LLM-judge quality harness with a weighted rubric and release gates.** Rejected. The
i-have-adhd harness cost $6.65 and stopped on a usage limit before producing a comparison, and it
carries open bugs. The five regression categories in `prompts.jsonl` cover quality by inspection,
and 12 outputs can be read by hand faster than a judge can be debugged.

**Carry over i-have-adhd's restate-state, time-estimate, and make-wins-visible rules.** Rejected.
Restate-state duplicates Claude Code's task tools. Time estimates point at the wrong actor inside
an agent harness, per issue #43. Make-wins-visible is absorbed by the one-concrete-next-step rule,
which already ends with a verification command.

## Expected outcome, stated honestly

The reliable win is time-to-answer, not spend. The style costs input tokens on every turn, and
prompt caching softens but does not erase that cost. The harness exists to find out which effect
dominates on this workload. If the cost result comes back flat, the style is still worth having.
The README claim changes, not the design.

## Open items

- Publishing target: a public repository under `carmelosantana`. Not initialized yet. The project
  directory is not a git repository.
- Trial count for the eval run. Start at one trial per case, and raise it only if a case looks
  borderline.
