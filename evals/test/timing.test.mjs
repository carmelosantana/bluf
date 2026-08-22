// The wall-clock figures README.md states, recomputed from the committed transcripts.
//
// This is the only published claim whose source is a transcript rather than a result row,
// because no row records a duration. That makes it the easiest figure to get quietly wrong.
//
// It is also a claim of NO effect, which is what a broken loader produces for free — an empty
// set, a failed pairing, or a duration read as zero would all look like "no difference". Each
// of those is made to fail loudly below.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  loadTimings, pairTimings, summariseTimings, parseTranscriptName, median
} from '../lib/timing.mjs'

test('every committed transcript yields a usable timing', async () => {
  const timings = await loadTimings()
  assert.equal(timings.length, 24, '18 calls from the agentic sweep plus 6 from the adequacy sweep')

  for (const row of timings) {
    assert.ok(row.wallMs > 0, `${row.file} has a non-positive wall duration`)
    assert.ok(row.apiMs > 0, `${row.file} has a non-positive api duration`)
    // API time is model time inside the call; it cannot exceed the whole call.
    assert.ok(row.apiMs <= row.wallMs, `${row.file}: api ${row.apiMs}ms exceeds wall ${row.wallMs}ms`)
    assert.ok(row.turns >= 1)
  }
})

test("the filename parser survives the filtered sweep's doubled label", () => {
  assert.deepEqual(parseTranscriptName('claude-fable-5-baseline-explain-cache-t1.jsonl'),
    { model: 'claude-fable-5', condition: 'baseline', fixture: 'explain-cache', trial: 1 })
  // A FIXTURES=hidden-edges run writes the filter label AND the fixture name; that is one fixture.
  assert.deepEqual(parseTranscriptName('claude-fable-5-bluf-hidden-edges-hidden-edges-t3.jsonl'),
    { model: 'claude-fable-5', condition: 'bluf', fixture: 'hidden-edges', trial: 3 })
  assert.throws(() => parseTranscriptName('not-a-transcript.jsonl'), /does not match/)
})

test('every transcript pairs — none is silently dropped', async () => {
  const { pairs, unpaired } = pairTimings(await loadTimings())
  assert.equal(unpaired, 0, 'an unpaired row would still produce a plausible median')
  assert.equal(pairs.length, 12, '12 styled runs, each with an unstyled partner')
})

test('the style has no measurable effect on wall-clock time — the published claim', async () => {
  const { pairs } = pairTimings(await loadTimings())
  const summary = summariseTimings(pairs)

  // The direction split IS the claim. Six each way is as close to "no effect" as 12 pairs get.
  assert.equal(summary.faster, 6, 'pairs faster under the style')
  assert.equal(summary.slower, 6, 'pairs slower under the style')
  assert.equal(summary.faster + summary.slower, pairs.length, 'no pair is exactly equal')

  // Totals in whole seconds, as the README quotes them.
  assert.equal(Math.round(summary.baselineTotalMs / 1000), 222)
  assert.equal(Math.round(summary.styledTotalMs / 1000), 223)
  assert.equal(Number(summary.totalPercent.toFixed(1)), 0.8)

  // Under a third of a second, on calls averaging roughly 18 seconds.
  assert.ok(Math.abs(summary.medianWallDeltaMs) < 1000,
    `median wall delta is ${summary.medianWallDeltaMs}ms — no longer negligible`)
  const meanCallSeconds = summary.baselineTotalMs / pairs.length / 1000
  assert.ok(meanCallSeconds > 15 && meanCallSeconds < 22,
    `mean baseline call is ${meanCallSeconds.toFixed(1)}s; the README says roughly 18`)
})

test('the no-effect result is not an artefact of an empty or broken set', async () => {
  // Each of these would read as "no difference" if its guard were missing.
  assert.throws(() => summariseTimings([]), /no pairs/)
  assert.throws(() => median([]), /empty/)

  // A zero duration must never be accepted: it would look like an instant call and drag the
  // median toward a saving nobody measured.
  const timings = await loadTimings()
  assert.ok(timings.every(row => row.wallMs > 0))

  // And the pairing keys must actually be doing work — mislabel one side and nothing may pair.
  const broken = timings.map(row =>
    row.condition === 'baseline' ? { ...row, fixture: `${row.fixture}-nope` } : row)
  assert.equal(pairTimings(broken).pairs.length, 0, 'pairing keys are not doing any work')
})

test('timing survives only for the agentic sweeps, and STORY.md says so', async () => {
  // The 260-call prose sweep stored no transcripts, so its wall-clock is unrecoverable without
  // paying again. If prose transcripts are ever stored, widen this deliberately rather than
  // letting the claim quietly pass on a partial corpus.
  const timings = await loadTimings()
  assert.ok(timings.every(row => row.model === 'claude-fable-5'),
    'every timed call is fable; no opus timing exists anywhere in the repo')

  const story = await readFile(new URL('../../STORY.md', import.meta.url), 'utf8')
  assert.match(story, /6 of 12 pairs faster/, 'STORY.md must state the direction split')
  assert.match(story.replace(/\s+/g, ' '), /no measurable effect on wall-clock time/i)
})
