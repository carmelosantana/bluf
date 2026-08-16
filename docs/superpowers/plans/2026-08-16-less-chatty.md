# less-chatty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish `less-chatty`, a Claude Code output style that leads every response with conclusions in bullets and puts depth below, plus an eval harness that measures its real token cost.

**Architecture:** Two standalone Markdown output-style files share a byte-identical body fenced by HTML marker comments; the terse file appends one compression block. A zero-dependency Node harness invokes `claude -p --output-format json` once per (case, condition), pins the condition with `--settings`, and reports per-case token deltas. Pure logic (drift detection, aggregation, argument construction, usage parsing) lives in `evals/lib/` and is unit-tested; process invocation is a thin shell over it.

**Tech Stack:** Node 22 (built-in `node:test`, `node:child_process`), Markdown, no runtime dependencies.

## Global Constraints

- Node 22 or newer. Verified installed: `v22.23.2`.
- **Zero runtime dependencies.** Tests use `node:test` and `node:assert/strict` only. No test framework, no CLI parser, no HTTP client.
- License: MIT.
- Both style files MUST set `keep-coding-instructions: true`. Without it Claude Code drops its built-in software engineering instructions, which is not the intent.
- Output style names, exactly: `Less Chatty` and `Less Chatty (terse)`.
- The two style files MUST share a byte-identical body between `<!-- LESS-CHATTY:SHARED-BODY:START -->` and `<!-- LESS-CHATTY:SHARED-BODY:END -->`.
- Commit as `Carmelo Santana <me@carmelosantana.com>`. This is the standing default identity; do not override it.
- **Nothing is pushed to GitHub until Task 9.** The repository stays local through Task 8.
- The `baseline` eval condition MUST pin `outputStyle` to `"Default"` explicitly. It must never omit the setting and inherit the operator's global config.
- All reporting MUST show per-case rows before any aggregate, and MUST report total tokens alongside output tokens.

---

### Task 1: Repository scaffolding and the main output style

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `output-styles/less-chatty.md`
- Test: `evals/test/style.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `output-styles/less-chatty.md` containing a shared body fenced by `<!-- LESS-CHATTY:SHARED-BODY:START -->` and `<!-- LESS-CHATTY:SHARED-BODY:END -->`. Tasks 2 and 6 depend on those exact marker strings.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "less-chatty",
  "version": "0.1.0",
  "description": "A Claude Code output style that leads with conclusions and puts depth below.",
  "type": "module",
  "private": true,
  "license": "MIT",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "test": "node --test evals/test/",
    "check": "node evals/check.mjs",
    "measure": "node evals/measure.mjs"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.DS_Store
```

- [ ] **Step 3: Create `LICENSE`**

Standard MIT text, copyright line exactly:

```
MIT License

Copyright (c) 2026 Carmelo Santana

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Write the failing test**

Create `evals/test/style.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const MAIN = new URL('../../output-styles/less-chatty.md', import.meta.url)

function frontmatter (text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(match, 'file must open with YAML frontmatter')
  const fields = {}
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return fields
}

test('main style declares the required frontmatter', async () => {
  const text = await readFile(MAIN, 'utf8')
  const fields = frontmatter(text)
  assert.equal(fields.name, 'Less Chatty')
  assert.equal(fields['keep-coding-instructions'], 'true')
  assert.ok(fields.description.length > 0, 'description is shown in the /config picker')
})

test('main style fences a shared body', async () => {
  const text = await readFile(MAIN, 'utf8')
  const start = text.indexOf('<!-- LESS-CHATTY:SHARED-BODY:START -->')
  const end = text.indexOf('<!-- LESS-CHATTY:SHARED-BODY:END -->')
  assert.notEqual(start, -1, 'missing START marker')
  assert.notEqual(end, -1, 'missing END marker')
  assert.ok(start < end, 'START must precede END')
})

test('main style blocks appear in the required order', async () => {
  const text = await readFile(MAIN, 'utf8')
  const headings = [
    '## Precedence',
    '## Never apply these rules to',
    '## Response contract',
    '## Sentence rules',
    '## Pre-send check',
    '## Length is not terseness'
  ]
  let cursor = -1
  for (const heading of headings) {
    const at = text.indexOf(heading)
    assert.notEqual(at, -1, `missing block: ${heading}`)
    assert.ok(at > cursor, `${heading} is out of order`)
    cursor = at
  }
})

test('precedence is the first block, before any rule', async () => {
  const text = await readFile(MAIN, 'utf8')
  assert.ok(
    text.indexOf('## Precedence') < text.indexOf('## Response contract'),
    'precedence must outrank the rules it governs, and must be read first'
  )
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, with `ENOENT` on `output-styles/less-chatty.md`.

- [ ] **Step 6: Create `output-styles/less-chatty.md`**

````markdown
---
name: Less Chatty
description: Conclusions first in bullets, depth below. Short active sentences. No preamble, no recap, no closers.
keep-coding-instructions: true
---

<!-- LESS-CHATTY:SHARED-BODY:START -->
Write every response so the reader finds the conclusion first.

## Precedence

These rules set the default shape of your output. Other instructions outrank them.

- An explicit instruction from the user, from project instructions, or from an invoked skill overrides these rules. Follow it without comment. Do not cite this style as a reason. Do not ask permission.
- The harness system prompt outranks these rules. Announce a tool call when the harness requires it. Do the work instead of asking "want me to".
- If a rule would delete the answer, the answer wins and the shape stays. "What are my options" gets ranked options with one-line trade-offs. The options are the answer.
- This is a default, not a license to relax. Do not drop these rules because a topic feels casual.

## Never apply these rules to

- Code. This includes identifiers, syntax, and string literals.
- Quoted material. This includes error output, command output, file contents, and another person's words. To rewrite a quotation is falsification, not simplification.
- Text where the exact wording carries the meaning. This includes a command to run, an API name, a config key, and an exact error string.

## Response contract

**Answer short questions short.** If the answer fits in about three lines, give the answer. No bullet block. No headers. The summary exists to spare the reader the body. With no body it is pure overhead.

**Above that threshold, lead with the conclusions.** Open with bullets. Put the depth below, under headers. Each bullet stands alone and is specific.

- Wrong: "Discusses the auth flow." This names a topic.
- Right: "verifyToken calls the removed v8 API. That is the 401."

**No preamble. No recap. No closing pleasantries.**

**End with one concrete next step** when anything is open. It must take under two minutes. A command counts.

**Errors.** State what the evidence shows. If the evidence identifies a cause, name it. If the evidence does not identify a cause, say what is known. Then name the single check that identifies the cause. Never supply a plausible cause in place of a confirmed one.

**Lists.** Group and rank. Never truncate. When a list runs long, split it into "now" and "later", or "must" and "nice to have". Never drop a relevant item to reach a count.

**Questions.** A question that comes up mid-work is not a tangent. Answer it and fold the result in. Surface only the questions that still need the reader, once, at the end.

## Sentence rules

| Rule | Limit |
| --- | --- |
| Sentence length | Maximum 20 words for an instruction. Maximum 25 words for descriptive text. Split a long sentence. Do not compress it. |
| Active voice | Use the passive voice only when the actor is unknown or irrelevant. |
| One instruction per sentence | Do not join two instructions with "and" or "then". |
| Noun clusters | Maximum 3 words stacked as a modifier. |
| One word, one meaning | Use one term per concept and repeat it. Do not rotate synonyms. |
| Plainest available word | Prefer the short common word to the formal or rare word. |
| Verb, not noun | Write "analyze the log". Do not write "perform an analysis of the log". |
| No marketing adjectives | Delete seamless, robust, powerful, cutting-edge, blazing-fast. Replace the word with the measurement that earns the claim. |
| No soft phrasal verbs | Write "start", not "spin up". Write "contact", not "reach out". Write "read", not "dive into". |
| No hedge stacking | Do not chain modal verbs, as in "may have been caused by". State the uncertainty as its own sentence. |
| Preserve modality | Keep a hedge that carries real uncertainty. To delete it manufactures confidence, which is a different claim. |
| No ellipsis | Keep the subject, the verb, and the article explicit. |
| Simple tenses | Keep a compound form where it carries information the simple form cannot. "The job has completed" and "the job completed" are different statements. |

## Pre-send check

Before you send, delete:

1. The first sentence, if it announces what you are about to do.
2. The last sentence, if it recaps or asks "anything else?".
3. Any "by the way" sidebar. Surface it once, at the end, as a separate question.
4. Any hedging adverb that adds no information. Keep a hedge that carries real uncertainty.
5. Any idiom or figurative phrase. Replace it with the literal action.

Then check the summary block. Does it state conclusions, or does it name topics? If it names topics, rewrite it.

## Length is not terseness

The caps apply to each sentence, not to the response. A long answer in short sentences is correct.

Never drop a fact, a condition, a caveat, or a scope qualifier to meet a limit. Split the sentence instead.

Stop when the sentence is unambiguous, not when it is shortest.
<!-- LESS-CHATTY:SHARED-BODY:END -->
````

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 4 tests.

- [ ] **Step 8: Commit**

```bash
git add package.json .gitignore LICENSE output-styles/less-chatty.md evals/test/style.test.mjs
git commit -m "feat: add the Less Chatty output style and its structural test"
```

---

### Task 2: The terse variant and the drift check

**Files:**
- Create: `evals/lib/drift.mjs`
- Create: `output-styles/less-chatty-terse.md`
- Test: `evals/test/drift.test.mjs`
- Modify: `evals/test/style.test.mjs` (add terse-file frontmatter assertions)

**Interfaces:**
- Consumes: the marker strings produced by Task 1.
- Produces: `evals/lib/drift.mjs` exporting `START`, `END`, `extractSharedBody(text)`, and `checkDrift(mainText, terseText)`. Task 6 calls `checkDrift`.

- [ ] **Step 1: Write the failing test**

Create `evals/test/drift.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { START, END, extractSharedBody, checkDrift } from '../lib/drift.mjs'

const MAIN = new URL('../../output-styles/less-chatty.md', import.meta.url)
const TERSE = new URL('../../output-styles/less-chatty-terse.md', import.meta.url)

test('extractSharedBody returns only the fenced body', () => {
  const text = `---\nname: X\n---\n${START}\nBODY\n${END}\ntail`
  assert.equal(extractSharedBody(text), '\nBODY\n')
})

test('extractSharedBody rejects a missing start marker', () => {
  assert.throws(() => extractSharedBody(`no markers here ${END}`), /START/)
})

test('extractSharedBody rejects a missing end marker', () => {
  assert.throws(() => extractSharedBody(`${START} no end`), /END/)
})

test('extractSharedBody rejects reversed markers', () => {
  assert.throws(() => extractSharedBody(`${END}\nBODY\n${START}`), /order/)
})

test('checkDrift passes on identical bodies', () => {
  const a = `${START}\nSAME\n${END}`
  const b = `${START}\nSAME\n${END}\n## Compression\nextra`
  assert.equal(checkDrift(a, b).ok, true)
})

test('checkDrift fails on divergent bodies and names the first difference', () => {
  const a = `${START}\nline one\nline two\n${END}`
  const b = `${START}\nline one\nline TWO\n${END}`
  const result = checkDrift(a, b)
  assert.equal(result.ok, false)
  assert.match(result.message, /line 3/)
})

test('the shipped style files share a byte-identical body', async () => {
  const [main, terse] = await Promise.all([
    readFile(MAIN, 'utf8'),
    readFile(TERSE, 'utf8')
  ])
  const result = checkDrift(main, terse)
  assert.equal(result.ok, true, result.message)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot resolve `../lib/drift.mjs`.

- [ ] **Step 3: Create `evals/lib/drift.mjs`**

```js
export const START = '<!-- LESS-CHATTY:SHARED-BODY:START -->'
export const END = '<!-- LESS-CHATTY:SHARED-BODY:END -->'

export function extractSharedBody (text) {
  const start = text.indexOf(START)
  if (start === -1) throw new Error(`missing ${START} marker`)
  const end = text.indexOf(END)
  if (end === -1) throw new Error(`missing ${END} marker`)
  if (end < start) throw new Error('markers are in the wrong order')
  return text.slice(start + START.length, end)
}

export function checkDrift (mainText, terseText) {
  const main = extractSharedBody(mainText)
  const terse = extractSharedBody(terseText)
  if (main === terse) return { ok: true, message: 'shared bodies match' }

  const mainLines = main.split('\n')
  const terseLines = terse.split('\n')
  const limit = Math.max(mainLines.length, terseLines.length)
  for (let i = 0; i < limit; i += 1) {
    if (mainLines[i] === terseLines[i]) continue
    return {
      ok: false,
      message: [
        `shared bodies diverge at line ${i + 1}`,
        `  less-chatty.md:       ${JSON.stringify(mainLines[i] ?? null)}`,
        `  less-chatty-terse.md: ${JSON.stringify(terseLines[i] ?? null)}`
      ].join('\n')
    }
  }
  return { ok: false, message: 'shared bodies diverge' }
}
```

- [ ] **Step 4: Create `output-styles/less-chatty-terse.md`**

Copy `output-styles/less-chatty.md` byte-for-byte, then make exactly two changes:

1. Replace the frontmatter with:

```yaml
---
name: Less Chatty (terse)
description: Less Chatty plus grammar compression. Unproven. Shrinks output tokens only.
keep-coding-instructions: true
---
```

2. Append this block **after** the `<!-- LESS-CHATTY:SHARED-BODY:END -->` marker:

```markdown

## Compression

These rules apply on top of everything above.

- Drop articles where the meaning survives intact. Fragments are allowed.
- Prefer the short synonym. Write "big", not "extensive". Write "fix", not "implement a solution for".
- Never invent an abbreviation. Do not write `cfg`, `impl`, `req`, `res`, or `fn`. The tokenizer splits an invented abbreviation the same as the full word. It saves nothing. The reader still decodes it. Write the full word.
- No arrows. Do not write `->`. An arrow is its own token. Write the word.
- Standard acronyms are acceptable: DB, API, HTTP. Never coin a new one.

"Never apply these rules to" and "Length is not terseness" still bind. Compression never touches code, quotes, or exact strings. Compression never removes a caveat.
```

Do not edit anything between the markers. The drift test enforces this.

- [ ] **Step 5: Add terse assertions to `evals/test/style.test.mjs`**

Append to that file:

```js
const TERSE = new URL('../../output-styles/less-chatty-terse.md', import.meta.url)

test('terse style declares the required frontmatter', async () => {
  const text = await readFile(TERSE, 'utf8')
  const fields = frontmatter(text)
  assert.equal(fields.name, 'Less Chatty (terse)')
  assert.equal(fields['keep-coding-instructions'], 'true')
})

test('terse style appends compression after the shared body', async () => {
  const text = await readFile(TERSE, 'utf8')
  assert.ok(
    text.indexOf('<!-- LESS-CHATTY:SHARED-BODY:END -->') < text.indexOf('## Compression'),
    'compression must sit outside the shared body'
  )
})
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 13 tests.

- [ ] **Step 7: Commit**

```bash
git add output-styles/less-chatty-terse.md evals/lib/drift.mjs evals/test/drift.test.mjs evals/test/style.test.mjs
git commit -m "feat: add the terse variant and a shared-body drift check"
```

---

### Task 3: Eval cases

**Files:**
- Create: `evals/prompts.jsonl`
- Test: `evals/test/prompts.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `evals/prompts.jsonl`, one JSON object per line with the exact keys `id`, `category`, `prompt`. Tasks 5, 6, and 7 read this file.

- [ ] **Step 1: Write the failing test**

Create `evals/test/prompts.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const FILE = new URL('../prompts.jsonl', import.meta.url)

const EXPECTED_COUNTS = {
  'short-lookup': 3,
  'multi-step': 3,
  'debug-partial-evidence': 2,
  options: 2,
  'long-list': 2
}

async function load () {
  const text = await readFile(FILE, 'utf8')
  return text.trim().split('\n').map((line, i) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`line ${i + 1} is not valid JSON: ${error.message}`)
    }
  })
}

test('every case has exactly the required keys', async () => {
  for (const row of await load()) {
    assert.deepEqual(Object.keys(row).sort(), ['category', 'id', 'prompt'])
    assert.ok(row.id.length > 0)
    assert.ok(row.prompt.length > 0)
  }
})

test('case ids are unique', async () => {
  const ids = (await load()).map(row => row.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('categories match the planned distribution', async () => {
  const counts = {}
  for (const row of await load()) {
    counts[row.category] = (counts[row.category] ?? 0) + 1
  }
  assert.deepEqual(counts, EXPECTED_COUNTS)
})

test('there are 12 cases', async () => {
  assert.equal((await load()).length, 12)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, `ENOENT` on `evals/prompts.jsonl`.

- [ ] **Step 3: Create `evals/prompts.jsonl`**

Every prompt must be answerable from general knowledge, with no repository state. The runner executes in a temporary empty directory so no project context leaks into the measurement.

```
{"id":"port-default","category":"short-lookup","prompt":"What port does the Vite dev server use by default?"}
{"id":"git-no-ff","category":"short-lookup","prompt":"In git, what does --no-ff do on a merge?"}
{"id":"to-sorted","category":"short-lookup","prompt":"Does Array.prototype.toSorted mutate the array it is called on?"}
{"id":"health-endpoint","category":"multi-step","prompt":"Add a health check endpoint to an Express app. It reports process uptime and returns 503 when a Postgres ping fails."}
{"id":"actions-workflow","category":"multi-step","prompt":"Write a GitHub Actions workflow that runs Node 22 tests on push and pull request, with dependency caching."}
{"id":"cjs-to-esm","category":"multi-step","prompt":"Convert a CommonJS Node module to ESM, including its test file and its package.json."}
{"id":"401-no-evidence","category":"debug-partial-evidence","prompt":"My integration test fails with 'expected 200, got 401'. The only line I have is the assertion: assert.equal(res.status, 200). What is wrong?"}
{"id":"ci-exit-1","category":"debug-partial-evidence","prompt":"The build passes locally and fails in CI with exit code 1 and no other output. What is wrong?"}
{"id":"scheduled-jobs","category":"options","prompt":"What are my options for running scheduled jobs in a Node service?"}
{"id":"shared-types","category":"options","prompt":"What are my options for sharing types between a TypeScript frontend and backend in a monorepo?"}
{"id":"security-headers","category":"long-list","prompt":"List the security headers a public Next.js app should set, and say what each one does."}
{"id":"docker-cache-miss","category":"long-list","prompt":"List everything that can make a Docker build miss its layer cache on every run."}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add evals/prompts.jsonl evals/test/prompts.test.mjs
git commit -m "feat: add 12 eval cases covering wins and the four regression classes"
```

---

### Task 4: Reporting logic

**Files:**
- Create: `evals/lib/report.mjs`
- Test: `evals/test/report.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `evals/lib/report.mjs` exporting `compare(baselineRows, candidateRows)` and `formatReport(comparison, options)`. Task 6 calls both.

A **row** is `{ caseId, category, trial, condition, inputTokens, outputTokens, totalTokens, chars }`. Task 5 produces rows in exactly this shape.

`compare` returns:

```js
{
  trials: Number,
  perCase: [{ caseId, category, baselineOutput, candidateOutput, deltaOutput,
              baselineTotal, candidateTotal, deltaTotal, netNegative }],
  totals: { baselineOutput, candidateOutput, deltaOutput,
            baselineTotal, candidateTotal, deltaTotal, netNegativeCases }
}
```

`netNegative` is `true` when `deltaTotal > 0`, meaning the candidate spent MORE total tokens than baseline.

- [ ] **Step 1: Write the failing test**

Create `evals/test/report.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compare, formatReport } from '../lib/report.mjs'

function row (caseId, condition, outputTokens, inputTokens = 100, trial = 1) {
  return {
    caseId,
    category: 'short-lookup',
    trial,
    condition,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    chars: outputTokens * 4
  }
}

test('compare sums per case and overall', () => {
  const base = [row('a', 'baseline', 200), row('b', 'baseline', 400)]
  const cand = [row('a', 'less-chatty', 120), row('b', 'less-chatty', 300)]
  const result = compare(base, cand)

  assert.equal(result.perCase.length, 2)
  assert.equal(result.perCase[0].deltaOutput, -80)
  assert.equal(result.totals.deltaOutput, -180)
  assert.equal(result.trials, 1)
})

test('compare flags a case where the candidate spends more total tokens', () => {
  const base = [row('a', 'baseline', 40, 100)]
  const cand = [row('a', 'less-chatty', 35, 900)]
  const result = compare(base, cand)

  assert.equal(result.perCase[0].netNegative, true)
  assert.deepEqual(result.totals.netNegativeCases, ['a'])
})

test('compare does not flag a case where total tokens fall', () => {
  const base = [row('a', 'baseline', 800, 100)]
  const cand = [row('a', 'less-chatty', 300, 400)]
  assert.equal(compare(base, cand).perCase[0].netNegative, false)
})

test('compare refuses mismatched case sets', () => {
  const base = [row('a', 'baseline', 200), row('b', 'baseline', 200)]
  const cand = [row('a', 'less-chatty', 100)]
  assert.throws(() => compare(base, cand), /b/)
})

test('compare refuses mismatched trial coverage', () => {
  const base = [row('a', 'baseline', 200, 100, 1), row('a', 'baseline', 200, 100, 2)]
  const cand = [row('a', 'less-chatty', 100, 100, 1)]
  assert.throws(() => compare(base, cand), /trial/i)
})

test('compare reports the trial count', () => {
  const base = [row('a', 'baseline', 200, 100, 1), row('a', 'baseline', 210, 100, 2)]
  const cand = [row('a', 'less-chatty', 100, 100, 1), row('a', 'less-chatty', 110, 100, 2)]
  assert.equal(compare(base, cand).trials, 2)
})

test('formatReport puts per-case rows before the aggregate', () => {
  const result = compare([row('a', 'baseline', 200)], [row('a', 'less-chatty', 100)])
  const text = formatReport(result, { condition: 'less-chatty' })
  assert.ok(text.indexOf('| a |') < text.indexOf('## Aggregate'))
})

test('formatReport reports total tokens, not only output tokens', () => {
  const result = compare([row('a', 'baseline', 200)], [row('a', 'less-chatty', 100)])
  const text = formatReport(result, { condition: 'less-chatty' })
  assert.match(text, /total/i)
})

test('formatReport names every net-negative case', () => {
  const result = compare([row('a', 'baseline', 40, 100)], [row('a', 'less-chatty', 35, 900)])
  const text = formatReport(result, { condition: 'less-chatty' })
  assert.match(text, /Net-negative/)
  assert.match(text, /`a`/)
})

test('formatReport states the trial count', () => {
  const result = compare([row('a', 'baseline', 200)], [row('a', 'less-chatty', 100)])
  const text = formatReport(result, { condition: 'less-chatty' })
  assert.match(text, /1 trial/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot resolve `../lib/report.mjs`.

- [ ] **Step 3: Create `evals/lib/report.mjs`**

```js
function key (row) {
  return `${row.caseId}#${row.trial}`
}

function sum (rows, field) {
  return rows.reduce((total, row) => total + row[field], 0)
}

export function compare (baselineRows, candidateRows) {
  const baseKeys = baselineRows.map(key)
  const candKeys = candidateRows.map(key)
  const missing = baseKeys.filter(k => !candKeys.includes(k))
  const extra = candKeys.filter(k => !baseKeys.includes(k))

  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      'refusing to compare: conditions do not cover identical (case, trial) sets. ' +
      `missing from candidate: [${missing.join(', ')}]; ` +
      `absent from baseline: [${extra.join(', ')}]`
    )
  }

  const caseIds = [...new Set(baselineRows.map(row => row.caseId))]
  const trials = new Set(baselineRows.map(row => row.trial)).size

  const perCase = caseIds.map(caseId => {
    const base = baselineRows.filter(row => row.caseId === caseId)
    const cand = candidateRows.filter(row => row.caseId === caseId)
    const baselineOutput = sum(base, 'outputTokens')
    const candidateOutput = sum(cand, 'outputTokens')
    const baselineTotal = sum(base, 'totalTokens')
    const candidateTotal = sum(cand, 'totalTokens')
    const deltaTotal = candidateTotal - baselineTotal

    return {
      caseId,
      category: base[0].category,
      baselineOutput,
      candidateOutput,
      deltaOutput: candidateOutput - baselineOutput,
      baselineTotal,
      candidateTotal,
      deltaTotal,
      netNegative: deltaTotal > 0
    }
  })

  return {
    trials,
    perCase,
    totals: {
      baselineOutput: sum(perCase, 'baselineOutput'),
      candidateOutput: sum(perCase, 'candidateOutput'),
      deltaOutput: sum(perCase, 'deltaOutput'),
      baselineTotal: sum(perCase, 'baselineTotal'),
      candidateTotal: sum(perCase, 'candidateTotal'),
      deltaTotal: sum(perCase, 'deltaTotal'),
      netNegativeCases: perCase.filter(row => row.netNegative).map(row => row.caseId)
    }
  }
}

function signed (n) {
  return n > 0 ? `+${n}` : String(n)
}

export function formatReport (comparison, { condition }) {
  const { perCase, totals, trials } = comparison
  const lines = []

  lines.push(`# ${condition} vs baseline`)
  lines.push('')
  lines.push(`Measured over ${trials} trial${trials === 1 ? '' : 's'} per case.`)
  lines.push('')
  lines.push('## Per case')
  lines.push('')
  lines.push('| Case | Category | Output (base) | Output (cand) | Δ output | Total (base) | Total (cand) | Δ total |')
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const row of perCase) {
    lines.push(
      `| ${row.caseId} | ${row.category} | ${row.baselineOutput} | ${row.candidateOutput} | ` +
      `${signed(row.deltaOutput)} | ${row.baselineTotal} | ${row.candidateTotal} | ${signed(row.deltaTotal)} |`
    )
  }

  lines.push('')
  lines.push('## Aggregate')
  lines.push('')
  lines.push(`- Output tokens: ${totals.baselineOutput} to ${totals.candidateOutput} (${signed(totals.deltaOutput)})`)
  lines.push(`- Total tokens: ${totals.baselineTotal} to ${totals.candidateTotal} (${signed(totals.deltaTotal)})`)
  lines.push('')

  if (totals.netNegativeCases.length > 0) {
    lines.push('## Net-negative cases')
    lines.push('')
    lines.push('These cases cost MORE total tokens with the style on:')
    lines.push('')
    for (const caseId of totals.netNegativeCases) {
      lines.push(`- \`${caseId}\``)
    }
  } else {
    lines.push('No net-negative cases.')
  }

  lines.push('')
  return lines.join('\n')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 27 tests.

- [ ] **Step 5: Commit**

```bash
git add evals/lib/report.mjs evals/test/report.test.mjs
git commit -m "feat: add per-case token comparison and reporting"
```

---

### Task 5: The runner

**Files:**
- Create: `evals/lib/runner.mjs`
- Test: `evals/test/runner.test.mjs`

**Interfaces:**
- Consumes: `evals/prompts.jsonl` from Task 3.
- Produces: `evals/lib/runner.mjs` exporting `CONDITIONS`, `buildArgs(prompt, styleName)`, `parseUsage(payload)`, `loadCases(url)`, and `runCase(caseRow, condition, trial)`. Task 6 calls `CONDITIONS`, `loadCases`, and `runCase`.

`CONDITIONS` maps a condition name to the exact `outputStyle` value it pins:

```js
{ baseline: 'Default', 'less-chatty': 'Less Chatty', 'less-chatty-terse': 'Less Chatty (terse)' }
```

- [ ] **Step 1: Probe the real CLI response shape before writing any parser**

Do not guess the JSON shape. Capture it:

```bash
cd "$(mktemp -d)" && claude -p "Reply with the single word: ok" --output-format json --settings '{"outputStyle":"Default"}' | tee /tmp/less-chatty-probe.json | head -60
```

Read `/tmp/less-chatty-probe.json` and note the exact field names under `usage` and the field holding the response text. The parser below assumes `usage.input_tokens`, `usage.output_tokens`, the optional `usage.cache_read_input_tokens` and `usage.cache_creation_input_tokens`, and `result` for the text.

**If the observed field names differ, update `parseUsage` and its test to match the observed shape, and note the change in the commit message.** The rest of the plan is unaffected.

- [ ] **Step 2: Write the failing test**

Create `evals/test/runner.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONDITIONS, buildArgs, parseUsage, loadCases } from '../lib/runner.mjs'

test('baseline pins Default explicitly and never omits the setting', () => {
  assert.equal(CONDITIONS.baseline, 'Default')
  const args = buildArgs('hi', CONDITIONS.baseline)
  const settings = JSON.parse(args[args.indexOf('--settings') + 1])
  assert.equal(settings.outputStyle, 'Default')
})

test('every condition pins an explicit output style', () => {
  for (const [name, style] of Object.entries(CONDITIONS)) {
    assert.ok(style.length > 0, `${name} must pin a style`)
  }
})

test('buildArgs requests print mode and JSON output', () => {
  const args = buildArgs('what is 2 + 2', 'Less Chatty')
  assert.ok(args.includes('-p'))
  assert.deepEqual(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2),
    ['--output-format', 'json'])
  assert.ok(args.includes('what is 2 + 2'))
})

test('buildArgs passes the prompt as one argument, never through a shell', () => {
  const args = buildArgs('rm -rf / ; echo pwned', 'Default')
  assert.ok(args.includes('rm -rf / ; echo pwned'))
})

test('parseUsage counts cache reads and cache writes as input tokens', () => {
  const usage = parseUsage({
    result: 'four chars',
    usage: {
      input_tokens: 10,
      output_tokens: 50,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 90
    }
  })
  assert.equal(usage.inputTokens, 1000)
  assert.equal(usage.outputTokens, 50)
  assert.equal(usage.totalTokens, 1050)
  assert.equal(usage.chars, 10)
})

test('parseUsage tolerates absent cache fields', () => {
  const usage = parseUsage({ result: 'x', usage: { input_tokens: 5, output_tokens: 7 } })
  assert.equal(usage.inputTokens, 5)
  assert.equal(usage.totalTokens, 12)
})

test('parseUsage rejects a payload with no usage block', () => {
  assert.throws(() => parseUsage({ result: 'x' }), /usage/)
})

test('loadCases reads the shipped case file', async () => {
  const cases = await loadCases()
  assert.equal(cases.length, 12)
  assert.equal(typeof cases[0].prompt, 'string')
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot resolve `../lib/runner.mjs`.

- [ ] **Step 4: Create `evals/lib/runner.mjs`**

```js
import { execFile } from 'node:child_process'
import { readFile, mkdtemp } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = promisify(execFile)

export const CONDITIONS = {
  baseline: 'Default',
  'less-chatty': 'Less Chatty',
  'less-chatty-terse': 'Less Chatty (terse)'
}

export function buildArgs (prompt, styleName) {
  return [
    '-p', prompt,
    '--output-format', 'json',
    '--settings', JSON.stringify({ outputStyle: styleName })
  ]
}

export function parseUsage (payload) {
  const usage = payload?.usage
  if (!usage) throw new Error('response has no usage block')

  const inputTokens =
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  const outputTokens = usage.output_tokens ?? 0

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    chars: (payload.result ?? '').length
  }
}

export async function loadCases (url = new URL('../prompts.jsonl', import.meta.url)) {
  const text = await readFile(url, 'utf8')
  return text.trim().split('\n').map(line => JSON.parse(line))
}

export async function runCase (caseRow, condition, trial = 1) {
  const cwd = await mkdtemp(join(tmpdir(), 'less-chatty-eval-'))
  const args = buildArgs(caseRow.prompt, CONDITIONS[condition])
  const { stdout } = await run('claude', args, { cwd, maxBuffer: 32 * 1024 * 1024 })
  const usage = parseUsage(JSON.parse(stdout))

  return {
    caseId: caseRow.id,
    category: caseRow.category,
    trial,
    condition,
    ...usage
  }
}
```

`runCase` executes in a fresh temporary directory so no project files, `CLAUDE.md`, or local settings leak into the measurement. It uses `execFile`, not `exec`, so the prompt is never interpreted by a shell.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 35 tests.

- [ ] **Step 6: Commit**

```bash
git add evals/lib/runner.mjs evals/test/runner.test.mjs
git commit -m "feat: add the eval runner with explicit baseline isolation"
```

---

### Task 6: The two CLI entry points

**Files:**
- Create: `evals/check.mjs`
- Create: `evals/measure.mjs`
- Create: `evals/results/.gitkeep`

**Interfaces:**
- Consumes: `checkDrift` (Task 2), `compare` and `formatReport` (Task 4), `CONDITIONS`, `loadCases`, `runCase` (Task 5).
- Produces: two executable entry points, wired to `npm run check` and `npm run measure` from Task 1.

- [ ] **Step 1: Create `evals/check.mjs`**

```js
import { readFile } from 'node:fs/promises'
import { checkDrift } from './lib/drift.mjs'

const main = await readFile(new URL('../output-styles/less-chatty.md', import.meta.url), 'utf8')
const terse = await readFile(new URL('../output-styles/less-chatty-terse.md', import.meta.url), 'utf8')

const result = checkDrift(main, terse)
console.log(result.message)
if (!result.ok) process.exit(1)
```

- [ ] **Step 2: Verify the drift check passes on the real files**

Run: `npm run check`
Expected: prints `shared bodies match`, exit code 0.

- [ ] **Step 3: Verify the drift check actually fails when the files diverge**

First confirm a change OUTSIDE the markers does not trip it:

```bash
cp output-styles/less-chatty-terse.md /tmp/terse.bak
printf '\nAppended outside the markers.\n' >> output-styles/less-chatty-terse.md
npm run check; echo "exit=$?"
```

Expected: `shared bodies match` and `exit=0`. The compression block lives outside the markers, so edits there must never fail the check.

Now break it INSIDE the body:

```bash
cp /tmp/terse.bak output-styles/less-chatty-terse.md
sed -i 's/^## Precedence$/## Precedence CHANGED/' output-styles/less-chatty-terse.md
npm run check; echo "exit=$?"
```

Expected: `shared bodies diverge at line N`, the two differing lines printed, and `exit=1`.

Restore and confirm clean:

```bash
cp /tmp/terse.bak output-styles/less-chatty-terse.md
npm run check && git diff --quiet output-styles/ && echo "restored clean"
```

Expected: `shared bodies match`, then `restored clean`.

- [ ] **Step 4: Create `evals/results/.gitkeep`**

An empty file. It keeps the directory in git before any run exists.

- [ ] **Step 5: Create `evals/measure.mjs`**

```js
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { CONDITIONS, loadCases, runCase } from './lib/runner.mjs'
import { compare, formatReport } from './lib/report.mjs'
import { checkDrift } from './lib/drift.mjs'

const TRIALS = Number(process.env.TRIALS ?? 1)
const RESULTS = new URL('./results/', import.meta.url)

// Gate: never spend tokens measuring style files that have drifted apart.
const drift = checkDrift(
  await readFile(new URL('../output-styles/less-chatty.md', import.meta.url), 'utf8'),
  await readFile(new URL('../output-styles/less-chatty-terse.md', import.meta.url), 'utf8')
)
if (!drift.ok) {
  console.error(drift.message)
  console.error('refusing to measure drifted style files. run `npm run check`.')
  process.exit(1)
}

const cases = await loadCases()
const rows = {}

await mkdir(RESULTS, { recursive: true })

for (const condition of Object.keys(CONDITIONS)) {
  rows[condition] = []
  for (let trial = 1; trial <= TRIALS; trial += 1) {
    for (const caseRow of cases) {
      process.stderr.write(`${condition} trial ${trial} ${caseRow.id}\n`)
      rows[condition].push(await runCase(caseRow, condition, trial))
    }
  }
  await writeFile(
    new URL(`./${condition}.jsonl`, RESULTS),
    rows[condition].map(row => JSON.stringify(row)).join('\n') + '\n'
  )
}

const reports = []
for (const condition of Object.keys(CONDITIONS)) {
  if (condition === 'baseline') continue
  reports.push(formatReport(compare(rows.baseline, rows[condition]), { condition }))
}

const report = reports.join('\n\n---\n\n')
await writeFile(new URL('./report.md', RESULTS), report)
console.log(report)
```

`compare` throws when the condition sets do not match, so a partial run fails loudly instead of printing a number that looks like a measurement.

- [ ] **Step 6: Verify `measure.mjs` parses and its imports resolve, without spending tokens**

Run: `node --check evals/measure.mjs && node -e "import('./evals/lib/runner.mjs').then(m => console.log(Object.keys(m).join(',')))"`
Expected: prints `CONDITIONS,buildArgs,loadCases,parseUsage,runCase`.

Module namespace keys are sorted alphabetically by the JavaScript specification, so this is the sorted order, not the declaration order in the source file.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS, 35 tests.

- [ ] **Step 8: Commit**

```bash
git add evals/check.mjs evals/measure.mjs evals/results/.gitkeep
git commit -m "feat: add the check and measure entry points"
```

---

### Task 7: Install the styles and run the measurement

**Files:**
- Create: `~/.claude/output-styles/less-chatty.md` (copy, outside the repository)
- Create: `~/.claude/output-styles/less-chatty-terse.md` (copy, outside the repository)
- Create: `evals/results/baseline.jsonl`
- Create: `evals/results/less-chatty.jsonl`
- Create: `evals/results/less-chatty-terse.jsonl`
- Create: `evals/results/report.md`

**Interfaces:**
- Consumes: everything from Tasks 1 through 6.
- Produces: `evals/results/report.md`, whose numbers Task 8 quotes in the README.

**Cost note:** this task makes 36 real Claude invocations at one trial per case (12 cases × 3 conditions). Confirm with Carmelo before running it if the plan is being executed unattended.

- [ ] **Step 1: Install the style files where Claude Code reads them**

```bash
mkdir -p ~/.claude/output-styles && cp output-styles/less-chatty.md output-styles/less-chatty-terse.md ~/.claude/output-styles/
```

- [ ] **Step 2: Verify Claude Code sees both styles**

```bash
cd "$(mktemp -d)" && claude -p "Reply with the single word: ok" --output-format json --settings '{"outputStyle":"Less Chatty"}' | head -20
```

Expected: valid JSON, no error about an unknown output style. An unknown style name is the failure this step catches.

- [ ] **Step 3: Run the measurement**

Run: `npm run measure`
Expected: progress lines on stderr for all 36 invocations, then the report on stdout. Writes four files into `evals/results/`.

- [ ] **Step 4: Read the report and check the four regression cases by hand**

Open `evals/results/report.md` for the numbers, then read the raw responses for these four cases in `evals/results/less-chatty.jsonl` and confirm by inspection:

1. `401-no-evidence` — the response must NOT assert a definite cause. It must say what is known and name one check. This is the regression from i-have-adhd #99.
2. `docker-cache-miss` — the response must group or rank a long list. It must NOT truncate to five items. This is the regression from i-have-adhd #96.
3. `scheduled-jobs` — the response must still present multiple ranked options. The options are the answer. This is the precedence clause working.
4. `port-default` — the response must be short prose with no bullet block and no headers. This is the three-line threshold working.

**If any of the four fails, stop. Fix the rule in `output-styles/less-chatty.md`, mirror the fix into the terse file, run `npm run check`, and re-run `npm run measure`.** Do not proceed to the README with a known regression.

- [ ] **Step 5: Commit the results**

```bash
git add evals/results/
git commit -m "chore: record the first measured eval run"
```

---

### Task 8: README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: `evals/results/report.md` from Task 7.
- Produces: the published front page.

- [ ] **Step 1: Write `README.md`**

This step gives section requirements rather than finished prose, because sections 1, 2, and 6 quote numbers and responses that do not exist until Task 7 runs. Every part that CAN be fixed in advance is given verbatim below: the install commands, the limitations, and the credits. Write the rest against the committed `evals/results/report.md`.

The README must dogfood the style: conclusions in bullets at the top, depth below. Required sections, in this order:

1. **One-line description**, then a bullet block stating what it does and what it measurably costs. Quote the real aggregate from `evals/results/report.md`. Do not round in your favour. Do not omit net-negative cases.
2. **Before / after**, a side-by-side table with one real prompt and its two real responses, taken from the committed `evals/results/*.jsonl`, not invented.
3. **Install**:
   ```bash
   git clone https://github.com/carmelosantana/less-chatty.git
   cp less-chatty/output-styles/*.md ~/.claude/output-styles/
   ```
   Then: run `/config`, select **Output style**, pick **Less Chatty**, and run `/clear`.
4. **The rules**, summarized in one list, linking to `output-styles/less-chatty.md` for the full text.
5. **The terse variant**, labelled unproven and opt-in, with its caveat stated before its rules: it shrinks output tokens only, input and reasoning tokens are untouched, and on already-terse work it can be net-negative.
6. **Measured results**, the per-case table from `evals/results/report.md`, plus `npm run measure` for reproducing it.
7. **Known limitations**, verbatim:
   - Output styles do not apply to subagents. A subagent runs its own system prompt. A fork is the exception, because it inherits the parent's system prompt.
   - An output style takes effect after `/clear` or a new session. Claude Code reads it once at session start.
   - The terse variant is unproven.
   - The style shrinks output tokens and adds input tokens on every turn. Prompt caching reduces that cost. It does not remove it.
8. **Credits**, naming and linking all four sources and the four issue threads:
   - [toppa's ASD-STE100 gist](https://gist.github.com/toppa/bf7ff49d6fc44fd4fc3337248f8f2a7e) — the skill-to-output-style conversion pattern, the "Never apply to" carve-out, and "Length is not terseness".
   - [danyuchn/asd-ste100-skill](https://github.com/danyuchn/asd-ste100-skill) — the structural sentence rules, modality preservation, and the slop scan.
   - [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd) — the structural rules, the precedence clause, and the pre-send check.
   - [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) — the compression rules and the honest-numbers framing.
   - Issues [#99](https://github.com/ayghri/i-have-adhd/issues/99), [#96](https://github.com/ayghri/i-have-adhd/issues/96), [#43](https://github.com/ayghri/i-have-adhd/issues/43), and [#112](https://github.com/ayghri/i-have-adhd/issues/112), whose reporters found the four failures this style corrects.
9. **License**: MIT.

- [ ] **Step 2: Verify every number in the README matches the committed report**

```bash
grep -oE '[-+]?[0-9]+' README.md | head -40
```

Cross-check each figure against `evals/results/report.md` by eye. A README number with no source in that file is a defect.

- [ ] **Step 3: Run the full test suite and the drift check**

Run: `npm test && npm run check`
Expected: PASS, 35 tests, then `shared bodies match`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README with measured results and credits"
```

---

### Task 9: Publish

**Files:**
- No files created. This task creates the GitHub repository and pushes.

**Interfaces:**
- Consumes: the complete local repository from Tasks 1 through 8.
- Produces: `https://github.com/carmelosantana/less-chatty`, public.

- [ ] **Step 1: Confirm the working tree is clean and the history is complete**

```bash
git status --short && git log --oneline
```

Expected: no output from `git status`, and 10 commits: the spec, this plan, and one per implementation task (Tasks 1 through 8).

- [ ] **Step 2: Confirm with Carmelo before creating the public repository**

Creating the repository publishes it. Carmelo approved `carmelosantana/less-chatty` as public, after implementation. Confirm the moment has arrived before running Step 3.

- [ ] **Step 3: Create the repository and push**

```bash
gh repo create carmelosantana/less-chatty --public --source=. --remote=origin --push --description "A Claude Code output style that leads with conclusions and puts depth below."
```

- [ ] **Step 4: Verify the push**

```bash
gh repo view carmelosantana/less-chatty --json url,visibility,defaultBranchRef
```

Expected: `"visibility": "PUBLIC"` and `"defaultBranchRef": {"name": "main"}`.

- [ ] **Step 5: Add repository topics for discovery**

```bash
gh repo edit carmelosantana/less-chatty --add-topic claude-code --add-topic output-style --add-topic ai-agents --add-topic developer-tools
```

---

## Spec coverage check

| Spec section | Task |
|---|---|
| Architecture and file layout | 1, 2, 3, 6 |
| Main style file, blocks 1 through 6 | 1 |
| `keep-coding-instructions: true` | 1 (asserted in `style.test.mjs`) |
| Terse variant and compression block | 2 |
| Two files, not an include; drift check | 2, 6 |
| Eval cases, 12 across 5 categories | 3 |
| Runner, `--settings`, baseline isolation | 5 |
| Reporting rules 1 through 5 | 4 |
| README, all required sections | 8 |
| Known limitations | 8 |
| Credits | 8 |
| Correction 1 (#99, invented causes) | 1 (rule), 7 (verified) |
| Correction 2 (#96, list truncation) | 1 (rule), 7 (verified) |
| Correction 3 (#43, harness conflict) | 1 (rule), 7 (verified) |
| Correction 4 (#112, tool-use stalls) | 1 (rule) |
| Publishing target | 9 |
| Trial count, start at 1 | 6 (`TRIALS` env var, default 1), 7 |
