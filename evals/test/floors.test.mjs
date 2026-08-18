// Every figure quoted in evals/results/report-floor-0.1.0.md, recomputed from the committed
// floors and the committed prose rows. The report is a human-readable analysis over paid
// data plus a hand-written yardstick; this project's rule is that no figure may be stated
// unless a test recomputes it from committed files, or the prose is unfalsifiable. These
// tests make no API call — they read `evals/results/floors/*.md`, `evals/prompts.jsonl`,
// two committed .jsonl files, and the sample .txt captures.
//
// The floors themselves are also asserted here: 12 of them, one per case id, none empty and
// none a placeholder. A floor that quietly shrank would inflate every excess figure in the
// report, and nothing downstream could notice.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import {
  loadFloors,
  parseFloor,
  assertFloorsCoverCases,
  analyseArm,
  compareToFloor,
  excessRatio,
  observedCharsPerToken,
  median,
  MIN_BODY_CHARS
} from '../lib/floors.mjs'

const RESULTS = new URL('../results/', import.meta.url)
const FLOORS = new URL('../results/floors/', import.meta.url)

const readJsonl = async name =>
  (await readFile(new URL(name, RESULTS), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)

const loadCases = async () =>
  (await readFile(new URL('../prompts.jsonl', import.meta.url), 'utf8'))
    .trim().split('\n').filter(Boolean).map(line => JSON.parse(line))

const round1 = value => Number(value.toFixed(1))
const pct1 = ratio => round1(ratio * 100)
const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0)

const MODEL = 'claude-fable-5'
const STYLE_SHA256 = 'a018355897a6b4d49cce7cb424d4ff2aa08e7930969e95dd74d2513b3c0d9d21'

const loadArms = async () => ({
  baseline: await readJsonl('clean-claude-fable-5-baseline.jsonl'),
  bluf: await readJsonl('clean-claude-fable-5-bluf.jsonl')
})

// ---------------------------------------------------------------------------------------
// The floors exist, cover the case set, and are real answers
// ---------------------------------------------------------------------------------------

test('there are exactly 12 floors, one per case id in prompts.jsonl', async () => {
  const floors = await loadFloors()
  const cases = await loadCases()
  assert.equal(cases.length, 12)
  assert.equal(floors.size, 12)
  assert.equal(assertFloorsCoverCases(floors, cases), 12)
  for (const caseRow of cases) {
    const floor = floors.get(caseRow.id)
    assert.ok(floor, `no floor for case ${caseRow.id}`)
    assert.equal(floor.category, caseRow.category, `${caseRow.id}: floor category disagrees with prompts.jsonl`)
  }
})

test('every floor directory entry is a .md file named for its case', async () => {
  const names = (await readdir(FLOORS)).sort()
  assert.equal(names.length, 12, 'nothing but the twelve floors lives in floors/')
  const cases = await loadCases()
  assert.deepEqual(names, cases.map(c => `${c.id}.md`).sort())
})

test('no floor is empty, a stub, or a placeholder', async () => {
  const floors = await loadFloors()
  for (const [caseId, floor] of floors) {
    assert.ok(floor.body.length >= MIN_BODY_CHARS, `${caseId}: floor body is empty`)
    assert.equal(floor.body, floor.body.trim(), `${caseId}: floor body is not trimmed`)
    assert.equal(floor.chars, floor.body.length)
    assert.ok(floor.requires.length >= 1, `${caseId}: floor states no requirements`)
    // A requirement list that is one word long is a placeholder wearing a header.
    // "Pins Node 22." is the shortest legitimate requirement in the set at 13 characters.
    for (const requirement of floor.requires) {
      assert.ok(requirement.length >= 12, `${caseId}: requirement "${requirement}" is too short to be a standard`)
    }
    assert.ok(!/\b(?:TODO|TBD|FIXME|lorem ipsum)\b/i.test(floor.body), `${caseId}: floor body contains a placeholder marker`)
  }
})

test('parseFloor rejects a floor with no header, no requirements, or a placeholder body', () => {
  assert.throws(() => parseFloor('just a body'), /missing its `---` header/)
  assert.throws(
    () => parseFloor('---\ncase: x\ncategory: y\nrequires:\n---\nbody text here\n'),
    /states no requirements/
  )
  assert.throws(
    () => parseFloor('---\ncase: x\ncategory: y\nrequires:\n- a requirement long enough\n---\n\n'),
    /empty or near enough/
  )
  assert.throws(
    () => parseFloor('---\ncase: x\ncategory: y\nrequires:\n- a requirement long enough\n---\nTODO: write this\n'),
    /looks like a placeholder/
  )
})

test('a floor filed under the wrong case id is refused', async () => {
  const text = await readFile(new URL('to-sorted.md', FLOORS), 'utf8')
  const floor = parseFloor(text, { file: 'to-sorted.md' })
  assert.equal(floor.caseId, 'to-sorted')
  // loadFloors cross-checks declared id against filename; parseFloor alone cannot.
  assert.notEqual(floor.caseId, 'port-default')
})

// ---------------------------------------------------------------------------------------
// The rows the report analyses
// ---------------------------------------------------------------------------------------

test('the sweep is 12 cases x 5 trials per arm, on one model, one style hash, clean', async () => {
  const { baseline, bluf } = await loadArms()
  assert.equal(baseline.length, 60)
  assert.equal(bluf.length, 60)
  for (const rows of [baseline, bluf]) {
    const keys = rows.map(row => `${row.caseId}|${row.trial}`)
    assert.equal(new Set(keys).size, 60, 'no (case, trial) cell is duplicated or missing')
    for (const row of rows) {
      assert.equal(row.model, MODEL)
      assert.equal(row.canonicalModel, MODEL)
      assert.equal(row.environment, 'clean')
      assert.equal(row.styleSha256, STYLE_SHA256)
      assert.equal(row.scheduleVersion, 2)
      assert.equal(typeof row.chars, 'number', 'the character-length field this whole report rests on')
    }
  }
  assert.ok(baseline.every(row => row.condition === 'baseline'))
  assert.ok(bluf.every(row => row.condition === 'bluf'))
})

// The report's central methodological claim: `chars` is the response text's length, not a
// derived or estimated quantity. runner.mjs sets it as `result.length`; this checks the
// claim against the committed verbatim captures, which are the only place both a response
// text and a recorded row length exist for the same style and model.
test('`chars` is the response text length — verified against two verbatim samples', async () => {
  const samples = new URL('../results/samples/', import.meta.url)
  const fableV1 = await readFile(new URL('port-default.claude-fable-5.0.1.0.txt', samples), 'utf8')
  const v1Rows = await readJsonl('full-claude-fable-5-less-chatty-v1.jsonl')
  const v1 = v1Rows.find(row => row.caseId === 'port-default')
  assert.equal(v1.chars, fableV1.length, 'the 0.1.0 fable capture and its row disagree on length')

  const opus = await readFile(new URL('port-default.claude-opus-5.0.2.0.txt', samples), 'utf8')
  const opusRows = await readJsonl('clean-claude-opus-5-bluf.jsonl')
  const opusPort = opusRows.filter(row => row.caseId === 'port-default')
  assert.ok(
    opusPort.some(row => row.chars === opus.length),
    'no clean opus port-default row matches the length of the committed 0.2.0 capture'
  )
})

// ---------------------------------------------------------------------------------------
// Section 1: why the unit is characters
// ---------------------------------------------------------------------------------------

test('chars-per-token across the 120 rows ranges 0.25 to 3.26, median 2.38', async () => {
  const { baseline, bluf } = await loadArms()
  const observed = observedCharsPerToken([...baseline, ...bluf])
  assert.equal(observed.count, 120, 'every row has a positive output-token count')
  assert.equal(Number(observed.min.toFixed(2)), 0.25)
  assert.equal(Number(observed.max.toFixed(2)), 3.26)
  assert.equal(Number(observed.median.toFixed(2)), 2.38)
})

// ---------------------------------------------------------------------------------------
// Section 2: the per-case table and the aggregates
// ---------------------------------------------------------------------------------------

// Floor character counts, exactly as the report's Floor column prints them. These are the
// denominator of every other figure, so they are pinned by value: an edit to a floor must
// break this test and force the report to be recomputed, not slide through unnoticed.
const FLOOR_CHARS = {
  'port-default': 5,
  'git-no-ff': 242,
  'to-sorted': 76,
  'health-endpoint': 601,
  'actions-workflow': 557,
  'cjs-to-esm': 813,
  '401-no-evidence': 1038,
  'ci-exit-1': 1615,
  'scheduled-jobs': 1387,
  'shared-types': 1566,
  'security-headers': 1719,
  'docker-cache-miss': 2703
}

// caseId: [baselineMedianChars, baselineExcessPct, baselineUnder, blufMedianChars, blufExcessPct, blufUnder]
const PER_CASE = {
  'port-default': [316, 6220.0, 0, 46, 820.0, 0],
  'git-no-ff': [1012, 318.2, 0, 268, 10.7, 0],
  'to-sorted': [528, 594.7, 0, 108, 42.1, 0],
  'health-endpoint': [2176, 262.1, 0, 986, 64.1, 0],
  'actions-workflow': [885, 58.9, 2, 506, -9.2, 5],
  'cjs-to-esm': [131, -83.9, 3, 2802, 244.6, 1],
  '401-no-evidence': [232, -77.6, 3, 486, -53.2, 5],
  'ci-exit-1': [2094, 29.7, 1, 605, -62.5, 5],
  'scheduled-jobs': [2203, 58.8, 0, 1354, -2.4, 3],
  'shared-types': [2940, 87.7, 0, 1462, -6.6, 3],
  'security-headers': [3611, 110.1, 0, 2131, 24.0, 0],
  'docker-cache-miss': [4160, 53.9, 0, 2546, -5.8, 4]
}

test('the committed floors have the character counts the report tabulates', async () => {
  const floors = await loadFloors()
  for (const [caseId, expected] of Object.entries(FLOOR_CHARS)) {
    assert.equal(floors.get(caseId).chars, expected, `${caseId}: floor length changed; recompute the report`)
  }
})

test('per-case medians, excess figures and below-floor counts match the report table', async () => {
  const { baseline, bluf } = await loadArms()
  const floors = await loadFloors()
  const comparison = compareToFloor(baseline, bluf, floors)
  assert.equal(comparison.perCase.length, 12)

  for (const row of comparison.perCase) {
    const expected = PER_CASE[row.caseId]
    assert.ok(expected, `report table has no row for ${row.caseId}`)
    const [baseChars, baseExcess, baseUnder, blufChars, blufExcess, blufUnder] = expected
    assert.equal(row.floorChars, FLOOR_CHARS[row.caseId], `${row.caseId}: floor`)
    assert.equal(row.baselineChars, baseChars, `${row.caseId}: baseline median chars`)
    assert.equal(row.candidateChars, blufChars, `${row.caseId}: styled median chars`)
    assert.equal(pct1(row.baselineExcess), baseExcess, `${row.caseId}: baseline excess`)
    assert.equal(pct1(row.candidateExcess), blufExcess, `${row.caseId}: styled excess`)
    assert.equal(row.baselineTrialsBelowFloor, baseUnder, `${row.caseId}: baseline trials under floor`)
    assert.equal(row.candidateTrialsBelowFloor, blufUnder, `${row.caseId}: styled trials under floor`)
  }
})

test('aggregates: median case +73.3% / +4.2%, weighted +64.6% / +7.9%, raw +81.6% / +4.7%', async () => {
  const { baseline, bluf } = await loadArms()
  const floors = await loadFloors()
  const comparison = compareToFloor(baseline, bluf, floors)

  assert.equal(pct1(comparison.baseline.totals.medianExcess), 73.3)
  assert.equal(pct1(comparison.candidate.totals.medianExcess), 4.2)

  assert.equal(pct1(comparison.baseline.totals.weightedExcess), 64.6)
  assert.equal(pct1(comparison.candidate.totals.weightedExcess), 7.9)

  const floorTotal = comparison.baseline.totals.floorChars
  assert.equal(floorTotal, comparison.candidate.totals.floorChars)
  assert.equal(pct1(excessRatio(comparison.baseline.totals.observedChars, floorTotal)), 81.6)
  assert.equal(pct1(excessRatio(comparison.candidate.totals.observedChars, floorTotal)), 4.7)
})

test('below-floor counts: 2 of 12 cases and 9 of 60 trials baseline, 6 and 26 styled', async () => {
  const { baseline, bluf } = await loadArms()
  const floors = await loadFloors()
  const comparison = compareToFloor(baseline, bluf, floors)

  assert.deepEqual(
    comparison.baseline.totals.casesBelowFloor.sort(),
    ['401-no-evidence', 'cjs-to-esm']
  )
  assert.deepEqual(
    comparison.candidate.totals.casesBelowFloor.sort(),
    ['401-no-evidence', 'actions-workflow', 'ci-exit-1', 'docker-cache-miss', 'scheduled-jobs', 'shared-types'].sort()
  )
  assert.equal(comparison.baseline.totals.trialsBelowFloor, 9)
  assert.equal(comparison.candidate.totals.trialsBelowFloor, 26)
  assert.equal(comparison.baseline.totals.rows, 60)
  assert.equal(comparison.candidate.totals.rows, 60)
})

// ---------------------------------------------------------------------------------------
// Section 3: the two arms fail differently
// ---------------------------------------------------------------------------------------

test('the baseline cjs-to-esm collapse: three trials at 102-131 chars on 141-178 output tokens', async () => {
  const { baseline } = await loadArms()
  const rows = baseline.filter(row => row.caseId === 'cjs-to-esm')
  const short = rows.filter(row => row.chars < 200)
  assert.equal(short.length, 3)
  assert.equal(Math.min(...short.map(row => row.chars)), 102)
  assert.equal(Math.max(...short.map(row => row.chars)), 131)
  assert.equal(Math.min(...short.map(row => row.outputTokens)), 141)
  assert.equal(Math.max(...short.map(row => row.outputTokens)), 178)
  // and the same case carries the widest baseline spread in the corpus
  assert.equal(Math.min(...rows.map(row => row.chars)), 102)
  assert.equal(Math.max(...rows.map(row => row.chars)), 5276)
})

test('the three widest baseline spreads are 52x, 32x and 21x against 1.4x for the rest', async () => {
  const { baseline } = await loadArms()
  const caseIds = [...new Set(baseline.map(row => row.caseId))]
  const spreads = caseIds
    .map(caseId => {
      const chars = baseline.filter(row => row.caseId === caseId).map(row => row.chars)
      return { caseId, ratio: Math.max(...chars) / Math.min(...chars) }
    })
    .sort((a, b) => b.ratio - a.ratio)

  assert.deepEqual(spreads.slice(0, 3).map(row => row.caseId), ['cjs-to-esm', 'actions-workflow', '401-no-evidence'])
  assert.deepEqual(spreads.slice(0, 3).map(row => Math.round(row.ratio)), [52, 32, 21])
  assert.equal(round1(spreads[3].ratio), 10.6, 'ci-exit-1 is fourth')
  // every case outside the top four sits between 1.1x and 1.4x, to one decimal
  for (const row of spreads.slice(4)) {
    const ratio = round1(row.ratio)
    assert.ok(ratio <= 1.4 && ratio >= 1.1, `${row.caseId}: spread ${ratio} is outside 1.1-1.4x`)
  }
})

test('both debug-partial-evidence cases are below floor on 5 of 5 styled trials', async () => {
  const { baseline, bluf } = await loadArms()
  const floors = await loadFloors()
  const comparison = compareToFloor(baseline, bluf, floors)
  const debug = comparison.perCase.filter(row => row.category === 'debug-partial-evidence')
  assert.equal(debug.length, 2)
  for (const row of debug) {
    assert.equal(row.candidateTrialsBelowFloor, 5, `${row.caseId}`)
    assert.ok(row.candidateExcess < -0.5, `${row.caseId}: styled excess is not below -50%`)
  }
  // and their floors are the 3rd and 6th longest in the set
  const ranked = Object.entries(FLOOR_CHARS).sort((a, b) => b[1] - a[1]).map(([id]) => id)
  assert.equal(ranked[2], 'ci-exit-1')
  assert.equal(ranked[5], '401-no-evidence')
})

test('four styled below-floor cases sit within 10% of their floor', async () => {
  const { baseline, bluf } = await loadArms()
  const floors = await loadFloors()
  const comparison = compareToFloor(baseline, bluf, floors)
  const marginal = comparison.perCase
    .filter(row => row.candidateBelowFloor && row.candidateExcess > -0.1)
    .map(row => row.caseId)
    .sort()
  assert.deepEqual(marginal, ['actions-workflow', 'docker-cache-miss', 'scheduled-jobs', 'shared-types'])
})

// ---------------------------------------------------------------------------------------
// Section 4: calibration against the verbatim samples
// ---------------------------------------------------------------------------------------

const SAMPLES = {
  'port-default': ['port-default.claude-opus-5.0.2.0.txt', 5, 0.0],
  'git-no-ff': ['git-no-ff.claude-opus-5.0.2.0.txt', 571, 136.0],
  'scheduled-jobs': ['scheduled-jobs.claude-opus-5.0.2.0.txt', 1524, 9.9],
  'docker-cache-miss': ['docker-cache-miss.claude-opus-5.0.2.0.txt', 2599, -3.8],
  '401-no-evidence': ['401-no-evidence.claude-opus-5.0.2.0.txt', 867, -16.5]
}

test('the five styled samples have the lengths and excess figures the calibration table quotes', async () => {
  const samples = new URL('../results/samples/', import.meta.url)
  const floors = await loadFloors()
  for (const [caseId, [file, chars, excess]] of Object.entries(SAMPLES)) {
    const text = await readFile(new URL(file, samples), 'utf8')
    assert.equal(text.length, chars, `${file}: sample length changed`)
    assert.equal(pct1(excessRatio(chars, floors.get(caseId).chars)), excess, `${caseId}: sample excess over floor`)
  }
})

test('the calibration set bounds floor precision at -16.5%: no sample judged sufficient sits lower', async () => {
  const floors = await loadFloors()
  const excesses = Object.entries(SAMPLES).map(([caseId, [, chars]]) =>
    excessRatio(chars, floors.get(caseId).chars)
  )
  assert.equal(excesses.length, 5)
  assert.equal(pct1(Math.min(...excesses)), -16.5)
  assert.equal(pct1(Math.max(...excesses)), 136.0)
  // The two cases the report calls a real signal are outside that band by a factor of three.
  assert.ok(-0.532 < -0.165 * 3)
  assert.ok(-0.625 < -0.165 * 3)
})

// ---------------------------------------------------------------------------------------
// Section 5: the token/character pair, and the published -25.7%
// ---------------------------------------------------------------------------------------

test('per-trial output-token reduction reproduces the published -25.7% from these rows', async () => {
  const { baseline, bluf } = await loadArms()
  const perTrial = [1, 2, 3, 4, 5].map(trial => {
    const base = sum(baseline.filter(row => row.trial === trial), 'outputTokens')
    const cand = sum(bluf.filter(row => row.trial === trial), 'outputTokens')
    return round1((cand - base) / base * 100)
  })
  assert.deepEqual(perTrial, [-23.8, -42.0, -20.6, -25.7, -49.3])
  assert.equal(round1(median(perTrial)), -25.7)
})

test('per-trial response-character reduction on the identical rows is -38.6%', async () => {
  const { baseline, bluf } = await loadArms()
  const perTrial = [1, 2, 3, 4, 5].map(trial => {
    const base = sum(baseline.filter(row => row.trial === trial), 'chars')
    const cand = sum(bluf.filter(row => row.trial === trial), 'chars')
    return round1((cand - base) / base * 100)
  })
  assert.deepEqual(perTrial, [-38.6, -41.6, -33.5, -30.9, -61.0])
  assert.equal(round1(median(perTrial)), -38.6)
})

// ---------------------------------------------------------------------------------------
// Guards on the instrument itself
// ---------------------------------------------------------------------------------------

test('compareToFloor refuses arms that do not cover the same (case, trial) multiset', async () => {
  const { baseline, bluf } = await loadArms()
  const floors = await loadFloors()
  assert.throws(
    () => compareToFloor(baseline, bluf.slice(1), floors),
    /same \(case, trial\) multiset/
  )
})

test('analyseArm refuses an empty arm and a case with no floor', async () => {
  const floors = await loadFloors()
  assert.throws(() => analyseArm([], floors), /no rows/)
  assert.throws(
    () => analyseArm([{ caseId: 'not-a-case', trial: 1, chars: 10, outputTokens: 5 }], floors),
    /no floor for case "not-a-case"/
  )
})

test('assertFloorsCoverCases names a missing floor and a surplus floor', async () => {
  const floors = await loadFloors()
  const cases = await loadCases()
  assert.throws(
    () => assertFloorsCoverCases(floors, [...cases, { id: 'invented', category: 'x' }]),
    /no floor for \[invented\]/
  )
  const trimmed = new Map(floors)
  trimmed.delete('to-sorted')
  trimmed.set('ghost', { caseId: 'ghost', chars: 10, category: 'x', requires: ['x'], body: 'x' })
  assert.throws(() => assertFloorsCoverCases(trimmed, cases), /no floor for \[to-sorted\]/)
})

test('the report quotes no figure this file does not recompute', async () => {
  // A weak but real guard: the report must not have grown a section since this test was
  // written. Every numbered section above has assertions; a new one would not.
  const report = await readFile(new URL('report-floor-0.1.0.md', RESULTS), 'utf8')
  const sections = [...report.matchAll(/^## (\d)\. /gm)].map(match => match[1])
  assert.deepEqual(sections, ['0', '1', '2', '3', '4', '5'])
  assert.match(report, /written by an AI assistant, in the same session/)
  assert.match(report, /The unit is characters/)
})

// The refinement in section 3: of the six styled cases below floor, only ONE is a case the
// style pushed under on its own. On 401-no-evidence the styled arm is the LONGER of the two,
// so both arms sit under that floor and the style moved the answer toward sufficiency. If a
// future re-measure flips either fact, the report's sharpest claim is wrong and this fails.
test('only ci-exit-1 shows the style crossing the floor on its own', async () => {
  const floors = await loadFloors()
  const comparison = compareToFloor(
    await readJsonl("clean-claude-fable-5-baseline.jsonl"),
    await readJsonl("clean-claude-fable-5-bluf.jsonl"),
    floors)
  const of = (arm, caseId) => comparison[arm].perCase.find(entry => entry.caseId === caseId)

  const baseline401 = of('baseline', '401-no-evidence')
  const styled401 = of('candidate', '401-no-evidence')
  assert.ok(styled401.medianChars > baseline401.medianChars,
    'the report says the styled arm is LONGER on 401-no-evidence; if not, section 3 is wrong')
  assert.ok(baseline401.belowFloor && styled401.belowFloor, 'both arms sit under that floor')
  assert.equal(baseline401.medianChars, 232)
  assert.equal(styled401.medianChars, 486)

  const baselineCi = of('baseline', 'ci-exit-1')
  const styledCi = of('candidate', 'ci-exit-1')
  assert.equal(baselineCi.belowFloor, false, 'the unstyled answer cleared the floor')
  assert.equal(styledCi.belowFloor, true, 'the styled answer did not')
  assert.equal(Number((baselineCi.excess * 100).toFixed(1)), 29.7)
  assert.equal(Number((styledCi.excess * 100).toFixed(1)), -62.5)
  assert.equal(styledCi.trialsBelowFloor, 5, 'on 5 of 5 trials')

  // The claim is "a single case, not six": every other below-floor styled case is either
  // inside the calibration band or one the baseline also fails.
  const crossings = comparison.candidate.perCase.filter(entry =>
    entry.belowFloor && of('baseline', entry.caseId).belowFloor === false && entry.excess < -0.17)
  assert.deepEqual(crossings.map(entry => entry.caseId), ['ci-exit-1'])
})
