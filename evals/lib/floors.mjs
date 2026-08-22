// The minimal-sufficient floor.
//
// Every other instrument in this repository measures how much the style CUT. None of them
// can say whether what is left is enough, because a percentage has no denominator with a
// meaning: cutting 25% off a bloated answer is a win, cutting 25% off a minimal one
// destroys it. This module supplies the denominator — a hand-written shortest-sufficient
// answer per case, committed under evals/results/floors/ — and expresses each measured
// response as its EXCESS OVER that floor.
//
// ---------------------------------------------------------------------------------------
// THE UNIT IS CHARACTERS, AND BOTH SIDES ARE MEASURED. There is no token estimate here.
// ---------------------------------------------------------------------------------------
//
// The obvious design is to compare floors against `outputTokens`, which the committed rows
// carry as a real API-reported count. It was rejected for two independent reasons, and the
// second is the stronger one:
//
//   1. No tokenizer is available and this project adds no dependency, so a floor's token
//      count could only be ESTIMATED from a chars-per-token divisor. Presenting an
//      estimate beside a measured `outputTokens` figure, in the same table, in the same
//      unit, is precisely the failure this repository exists to avoid.
//   2. Even a perfect tokenizer would compare the wrong things. `usage.output_tokens`
//      bills everything the model generated, INCLUDING thinking, and a floor has no
//      thinking to correspond to. The committed rows show how badly that separates the
//      two: chars-per-token across the 120 clean claude-fable-5 rows ranges from 0.25 to
//      3.26 (see observedCharsPerToken below). A row at 0.25 spent most of its output
//      budget reasoning and emitted almost no prose. Dividing such a row by any single
//      constant does not approximate its answer's length; it invents one.
//
// So the analysis runs in characters, where BOTH sides are directly measured:
//
//   - the floor side is `body.length` of the committed floor file, frontmatter excluded
//   - the response side is the row's `chars` field, which `evals/lib/runner.mjs` records
//     as `result.length` — the exact character length of the assistant's response text
//
// Nothing here is estimated, inferred, or converted. The cost of that choice is that this
// instrument's figures are NOT in the same unit as the project's published −25.7%, which is
// a token figure; report-floor-0.1.0.md states that limitation rather than papering over it
// with a divisor.
//
// What it would take to replace this with a real token count: a tokenizer for the model's
// vocabulary, applied to the committed floor bodies, producing a measured count to sit
// beside `outputTokens`. Failing that, a paid capture that sends each floor body through
// the API and reads back its input-token count. Both are out of scope for a no-dependency,
// no-API-call instrument; neither is approximated here.

import { readdir, readFile } from 'node:fs/promises'

export const FLOORS_DIR = new URL('../results/floors/', import.meta.url)

// A floor file is `---\n<header>\n---\n<body>`. The header names the case and states the
// requirements the body must satisfy to count as sufficient, so a reader can dispute the
// floor against a written standard rather than against the author's taste. It is
// deliberately NOT counted: it is the argument for the floor, not the floor.
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/

// Placeholder detection. A floor that says "TODO" or "see above" would silently shrink the
// denominator and inflate every excess figure computed from it, so an empty or stubbed
// floor must fail loudly rather than measure as a very demanding one.
export const PLACEHOLDER_PATTERNS = [
  /^\s*(?:TODO|TBD|FIXME|WIP|placeholder|stub)\b/i,
  /\b(?:to be written|fill (?:this )?in|write me|coming soon)\b/i
]

// The shortest body we will accept at all. `port-default`'s floor is "5173." — five
// characters — and that is correct, so this bar is set below it and catches only the
// genuinely empty.
export const MIN_BODY_CHARS = 4

export function parseFloor (text, { file = '<unknown>' } = {}) {
  if (typeof text !== 'string') throw new Error(`${file}: floor content must be a string`)
  const match = FRONTMATTER.exec(text)
  if (!match) {
    throw new Error(`${file}: floor is missing its \`---\` header block; a floor without stated requirements cannot be disputed`)
  }
  const [, header, rawBody] = match

  const caseId = readScalar(header, 'case', file)
  const category = readScalar(header, 'category', file)
  const requires = readList(header, 'requires', file)
  if (requires.length === 0) {
    throw new Error(`${file}: floor states no requirements, so nothing says what "sufficient" means for this case`)
  }

  const body = rawBody.trim()
  if (body.length < MIN_BODY_CHARS) {
    throw new Error(`${file}: floor body is ${body.length} characters, which is empty or near enough`)
  }
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(body)) {
      throw new Error(`${file}: floor body looks like a placeholder (matched ${pattern}); a stubbed floor silently inflates every excess figure computed from it`)
    }
  }

  return { caseId, category, requires, body, chars: body.length }
}

// A two-key, one-list header format, parsed by hand rather than with a YAML dependency.
// `key: value` for scalars; `key:` followed by `- ` lines for the list, with continuation
// lines (indented, no leading `-`) folded into the preceding item.
function readScalar (header, key, file) {
  const line = header.split('\n').find(l => l.startsWith(`${key}:`))
  if (line === undefined) throw new Error(`${file}: floor header has no \`${key}:\``)
  const value = line.slice(key.length + 1).trim()
  if (value === '') throw new Error(`${file}: floor header has an empty \`${key}:\``)
  return value
}

function readList (header, key, file) {
  const lines = header.split('\n')
  const start = lines.findIndex(l => l.trim() === `${key}:`)
  if (start === -1) throw new Error(`${file}: floor header has no \`${key}:\` list`)
  const items = []
  for (const raw of lines.slice(start + 1)) {
    if (raw.trim() === '') continue
    if (/^\S/.test(raw) && !raw.startsWith('- ')) break // next top-level key
    if (raw.startsWith('- ')) items.push(raw.slice(2).trim())
    else if (items.length > 0) items[items.length - 1] += ' ' + raw.trim()
  }
  return items
}

// Loads every committed floor, keyed by case id. Throws if a file's declared `case:`
// disagrees with its filename — a floor filed under the wrong case would be compared
// against the wrong responses and nothing downstream could notice.
export async function loadFloors (dir = FLOORS_DIR) {
  const names = (await readdir(dir)).filter(name => name.endsWith('.md')).sort()
  const floors = new Map()
  for (const name of names) {
    const text = await readFile(new URL(name, dir), 'utf8')
    const floor = parseFloor(text, { file: name })
    const expected = name.replace(/\.md$/, '')
    if (floor.caseId !== expected) {
      throw new Error(`${name}: declares case "${floor.caseId}" but is filed as "${expected}"`)
    }
    if (floors.has(floor.caseId)) throw new Error(`${name}: duplicate floor for case "${floor.caseId}"`)
    floors.set(floor.caseId, { ...floor, file: name })
  }
  return floors
}

// Every case in `cases` must have exactly one floor and vice versa. A missing floor means a
// case silently drops out of the aggregate; a surplus floor means one was written against a
// prompt that no longer exists.
export function assertFloorsCoverCases (floors, cases) {
  const caseIds = cases.map(c => c.id)
  const missing = caseIds.filter(id => !floors.has(id))
  const surplus = [...floors.keys()].filter(id => !caseIds.includes(id))
  const problems = []
  if (missing.length > 0) problems.push(`no floor for [${missing.join(', ')}]`)
  if (surplus.length > 0) problems.push(`floor without a case for [${surplus.join(', ')}]`)
  if (problems.length > 0) throw new Error(`floors do not cover the case set: ${problems.join('; ')}`)
  return caseIds.length
}

export function median (values) {
  if (values.length === 0) throw new Error('median of an empty set is undefined')
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Excess over floor, as a ratio of the floor: 0 means the response is exactly the floor
// length, +1.0 means it is twice the floor, −0.5 means it is half the floor and therefore
// too short to have contained a sufficient answer.
export const excessRatio = (chars, floorChars) => (chars - floorChars) / floorChars

// Chars per output token, observed per row. Reported ONLY to justify the refusal to convert
// between the two units — its spread is the evidence that no single divisor exists. Rows
// with zero output tokens are skipped rather than dividing by zero.
export function observedCharsPerToken (rows) {
  const ratios = rows.filter(row => row.outputTokens > 0).map(row => row.chars / row.outputTokens)
  if (ratios.length === 0) throw new Error('no rows with a positive output-token count')
  return { count: ratios.length, min: Math.min(...ratios), median: median(ratios), max: Math.max(...ratios) }
}

// The whole analysis, per arm.
//
// `medianChars` is the median across the arm's trials for that case, matching the house
// convention in evals/lib/report.mjs — a single runaway or a single stub does not move it.
// `trialsBelowFloor` counts the individual observations that came in under the floor, which
// the median hides and which is the sharper signal: it says how OFTEN an arm returned less
// than a sufficient answer, not merely whether it typically did.
//
// The aggregate is character-weighted — summed response characters against the summed floor,
// counting the floor once per trial — so a long case counts for more than a short one, in
// the same way the project's token aggregate does. `medianExcess` is the unweighted middle
// case, given beside it because the two answer different questions.
export function analyseArm (rows, floors) {
  if (rows.length === 0) throw new Error('refusing to analyse an arm with no rows')
  const caseIds = [...new Set(rows.map(row => row.caseId))]

  const perCase = caseIds.map(caseId => {
    const floor = floors.get(caseId)
    if (!floor) throw new Error(`no floor for case "${caseId}"`)
    const caseRows = rows.filter(row => row.caseId === caseId)
    const chars = caseRows.map(row => row.chars)
    const medianChars = median(chars)
    return {
      caseId,
      category: floor.category,
      trials: caseRows.length,
      floorChars: floor.chars,
      medianChars,
      minChars: Math.min(...chars),
      maxChars: Math.max(...chars),
      excess: excessRatio(medianChars, floor.chars),
      belowFloor: medianChars < floor.chars,
      trialsBelowFloor: chars.filter(value => value < floor.chars).length
    }
  })

  const totalChars = perCase.reduce((sum, row) => sum + row.medianChars * row.trials, 0)
  const totalFloor = perCase.reduce((sum, row) => sum + row.floorChars * row.trials, 0)
  const observedChars = rows.reduce((sum, row) => sum + row.chars, 0)

  return {
    perCase,
    totals: {
      rows: rows.length,
      // Summed observed characters, and the same floor counted once per row. The weighted
      // excess divides the two.
      observedChars,
      floorChars: totalFloor,
      // Guard against the medians and the raw sum drifting apart unnoticed; the weighted
      // figure below is built from medians on purpose (see the note above), and this keeps
      // the difference visible rather than silent.
      medianWeightedChars: totalChars,
      weightedExcess: excessRatio(totalChars, totalFloor),
      medianExcess: median(perCase.map(row => row.excess)),
      casesBelowFloor: perCase.filter(row => row.belowFloor).map(row => row.caseId),
      trialsBelowFloor: perCase.reduce((sum, row) => sum + row.trialsBelowFloor, 0)
    }
  }
}

// Both arms, plus the paired per-case view the report tabulates. The two arms must cover
// the same (case, trial) multiset, for the same reason evals/lib/report.mjs insists on it:
// an unpaired comparison measures the coverage, not the style.
export function compareToFloor (baselineRows, candidateRows, floors) {
  assertPaired(baselineRows, candidateRows)
  const baseline = analyseArm(baselineRows, floors)
  const candidate = analyseArm(candidateRows, floors)
  const byId = new Map(candidate.perCase.map(row => [row.caseId, row]))
  const perCase = baseline.perCase.map(base => {
    const cand = byId.get(base.caseId)
    return {
      caseId: base.caseId,
      category: base.category,
      floorChars: base.floorChars,
      baselineChars: base.medianChars,
      candidateChars: cand.medianChars,
      baselineExcess: base.excess,
      candidateExcess: cand.excess,
      baselineBelowFloor: base.belowFloor,
      candidateBelowFloor: cand.belowFloor,
      baselineTrialsBelowFloor: base.trialsBelowFloor,
      candidateTrialsBelowFloor: cand.trialsBelowFloor
    }
  })
  return { baseline, candidate, perCase }
}

function assertPaired (baselineRows, candidateRows) {
  const describe = rows => rows.map(row => `${row.caseId}#${row.trial}`).sort().join(',')
  if (describe(baselineRows) !== describe(candidateRows)) {
    throw new Error('refusing to compare: the two arms do not cover the same (case, trial) multiset')
  }
}

export const pct = ratio => `${ratio >= 0 ? '+' : ''}${(ratio * 100).toFixed(1)}%`
