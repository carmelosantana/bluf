// Pins the figures README.md states that live nowhere else.
//
// Why this file exists. Every report under evals/results/ has a test that recomputes its figures
// from committed rows, and the prose results table has one too. The README's *derived* prose —
// the payback period, the pooled total-token medians, the cold-cache turn counts — had no such
// pin, and that is exactly where staleness survived: a final review found the payback paragraph
// still quoting the superseded 3-trial run, wrong by roughly 3x in the direction that flattered
// the style, and ranking the two models the wrong way round. The break-even table beside it had
// been updated; the sentence had not, because nothing failed when it drifted.
//
// These tests read README.md as text and recompute each figure from the committed rows. They make
// no API call. If a re-measure moves a number, the README fails here instead of quietly lying.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { perTrialMedianOutputSaved, median } from '../lib/report.mjs'

const README = new URL('../../README.md', import.meta.url)
const RESULTS = new URL('../results/', import.meta.url)

const readReadme = () => readFile(README, 'utf8')
const readRows = async name =>
  (await readFile(new URL(name, RESULTS), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)

const armsFor = async model => ({
  baseline: await readRows(`clean-${model}-baseline.jsonl`),
  bluf: await readRows(`clean-${model}-bluf.jsonl`)
})

// The style's input overhead, as the break-even table uses it. Kept here as the single place the
// README's derived arithmetic gets its constant, so a drift shows up as a failure rather than as
// two figures that quietly disagree.
const INPUT_ADDED = 2030
const RATIO = 5

// Turn 1 pays a cache WRITE (2x) and saves `saved` output; every later turn pays a cache READ
// (0.1x) and saves the same. Payback is the first-turn loss divided by the per-turn gain.
const paybackTurns = saved => (2 * INPUT_ADDED - RATIO * saved) / (RATIO * saved - 0.1 * INPUT_ADDED)

test('the payback figure is derived from the CURRENT rows, and is fable-only', async () => {
  const { baseline, bluf } = await armsFor('claude-fable-5')
  const saved = perTrialMedianOutputSaved(baseline, bluf)
  const turns = paybackTurns(saved)

  assert.equal(Number(turns.toFixed(1)), 3.4, `payback recomputes to ${turns}`)
  const readme = await readReadme()
  assert.match(readme, /roughly \*\*3\.4 further turns\*\*/)

  // The retracted figures must not reappear. They came from the superseded 3-trial run and were
  // wrong in the flattering direction; the README now discloses them only as a correction.
  const paybackParagraph = readme.slice(
    readme.indexOf('**How long the first turn takes to pay back.**'),
    readme.indexOf('**Total tokens, which is not a cost figure.**'))
  assert.ok(paybackParagraph.length > 0, 'the payback paragraph must still exist')
  assert.doesNotMatch(paybackParagraph.split('*An earlier draft')[0], /0\.47|1\.25/,
    'the superseded payback range must not be stated as current')
})

test('no payback period is published for opus, because its saving is not publishable', async () => {
  // The opus output saving is not distinguishable from zero, so anything derived from it is a
  // number built on one this README declines to publish. This guards the specific failure the
  // review found: an opus-derived payback quoted four paragraphs after the retraction.
  const { baseline, bluf } = await armsFor('claude-opus-5')
  const turns = paybackTurns(perTrialMedianOutputSaved(baseline, bluf))
  assert.ok(turns > 6, `opus payback is ${turns.toFixed(2)} turns — far worse than fable, not better`)

  const readme = await readReadme()
  const paragraph = readme.slice(
    readme.indexOf('**How long the first turn takes to pay back.**'),
    readme.indexOf('**Total tokens, which is not a cost figure.**'))
  assert.match(paragraph.replace(/\s+/g, ' '), /\*\*fable only\*\*/,
    'the paragraph must say it is fable-only')
  assert.match(paragraph.replace(/\s+/g, ' '), /No opus figure is quoted here/,
    'and must say why no opus figure is given')
  // Scoped to the claim, not the disclosure: the correction note below it quotes the old
  // wording verbatim on purpose, and that is the point of keeping it.
  assert.doesNotMatch(paragraph.split('*An earlier draft')[0], /soonest on opus/,
    'the inverted ranking must not be stated as current')
})

test('the pooled total-token medians match the clean rows, over 60 pairs each', async () => {
  const readme = await readReadme()
  const expected = { 'claude-fable-5': 1693, 'claude-opus-5': 1856 }

  for (const [model, figure] of Object.entries(expected)) {
    const { baseline, bluf } = await armsFor(model)
    assert.equal(baseline.length, 60, `${model} baseline must carry 60 rows`)

    const deltas = baseline.map(row => {
      const match = bluf.find(other => other.caseId === row.caseId && other.trial === row.trial)
      assert.ok(match, `${model}: no styled row for ${row.caseId}/trial ${row.trial}`)
      return match.totalTokens - row.totalTokens
    })
    assert.equal(deltas.length, 60)
    assert.equal(Math.round(median(deltas)), figure, `${model} pooled median total-token delta`)
  }

  assert.match(readme, /\*\*\+1,693 \(fable\)\*\* and \*\*\+1,856 \(opus\)\*\*/)
  assert.match(readme, /median over all 60 per-case paired differences/)
})

test('the cold-cache artifact figures describe the clean run', async () => {
  // The README says exactly 1 of 240 clean turns carries a full cache-creation charge, at 11,324
  // input tokens against a 4,797 median. Both numbers are recomputed here; an earlier draft
  // quoted the full-environment run's 1-in-144 at 245,184 without saying which run it described.
  let rows = []
  for (const model of ['claude-fable-5', 'claude-opus-5']) {
    const { baseline, bluf } = await armsFor(model)
    rows = rows.concat(baseline, bluf)
  }
  assert.equal(rows.length, 240, 'the clean run is 240 turns')

  const inputs = rows.map(row => row.inputTokens)
  const middle = median(inputs)
  assert.equal(Math.round(middle), 4797)

  const outliers = inputs.filter(value => value > 2 * middle)
  assert.equal(outliers.length, 1, 'exactly one turn carries the cold-cache charge')
  assert.equal(outliers[0], 11324)

  const readme = await readReadme()
  assert.match(readme, /across the 240\s*\n?turns backing the figures above, exactly 1 carries it/)
  assert.match(readme, /11,324 input tokens against a 4,797\s*\n?median/)
})

test('the port-default illustration quotes the current opus median, not the retracted one', async () => {
  const { baseline, bluf } = await armsFor('claude-opus-5')
  const medianFor = rows => median(rows.filter(row => row.caseId === 'port-default').map(row => row.outputTokens))

  assert.equal(medianFor(baseline), 245)
  assert.equal(medianFor(bluf), 5)

  const readme = await readReadme()
  assert.match(readme, /median of 245 output tokens and BLUF answers it in 5/)
  // 140 was the superseded full-environment median. It may appear only as a disclosed correction.
  const illustration = readme.slice(readme.indexOf('Nobody asked about port collisions'))
  const beforeCorrection = illustration.split('(An earlier draft')[0]
  assert.doesNotMatch(beforeCorrection, /\b140\b/, 'the retracted median must not be stated as current')
})

test('the README does not soften the overhead-band limit the agentic report states', async () => {
  // report-agentic-0.1.0.md says only ONE of the three per-turn figures sits inside the committed
  // 2,028-2,038 band. An earlier README draft juxtaposed the three with the band in a way that
  // read as agreement. This is the exact overclaim the review caught being made once already.
  const readme = await readReadme()
  assert.match(readme, /one of the three sits inside that band and the\s*\n?\s*other two land within 8 tokens of its edges/)
})
