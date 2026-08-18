// Every figure quoted in evals/results/report-compression-0.1.0.md, recomputed from the
// committed corpus. Makes no API call — it reads files this repository already paid for.
//
// The report's headline is a ZERO. A zero is the easiest number in the world to produce by
// accident: a scanner pointed at an empty directory, a filter that matches nothing, a corpus
// that silently shrank. These tests exist to make this particular zero mean something, by
// pinning the corpus size and by proving the scanner still fires on planted content.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  scanCommittedCorpus, conditionOfSample, conditionOfTranscript, SAMPLES_DIR, TRANSCRIPTS_DIR
} from '../lib/compression-report.mjs'
import { detectElisions, scanTranscript } from '../lib/compression.mjs'

test('the corpus is the size the report says it is', async () => {
  const { samples, transcripts } = await scanCommittedCorpus()
  assert.equal(samples.length, 12, 'the report quotes 12 committed prose samples')
  assert.equal(transcripts.length, 18, 'the report quotes all 18 agentic transcripts')
})

test('every transcript is attributed to a real condition, 9 per arm', async () => {
  const { totals } = await scanCommittedCorpus()
  assert.equal(totals.transcripts.baseline.files, 9)
  assert.equal(totals.transcripts.bluf.files, 9)
  assert.equal(totals.transcripts.unknown, undefined, 'an unattributed transcript would corrupt the split')
})

test('every prose sample is attributed, and the split is the one the report quotes', async () => {
  const { totals } = await scanCommittedCorpus()
  assert.equal(totals.samples.unknown, undefined, 'an unattributed sample would corrupt the split')
  assert.equal(totals.samples.baseline.files, 1)
  assert.equal(totals.samples.styled.files, 11)
})

test('the scan finds zero elisions — the reported result', async () => {
  const { totals } = await scanCommittedCorpus()
  for (const corpus of ['samples', 'transcripts']) {
    for (const [condition, cell] of Object.entries(totals[corpus])) {
      assert.equal(cell.hits, 0, `${corpus}/${condition} now has hits: ${JSON.stringify(cell.excerpts)}`)
      assert.deepEqual(cell.excerpts, [])
    }
  }
})

test('the zero is not the scanner failing to look', async () => {
  // The failure this guards: a scan that would report zero on ANY input. Plant a known elision
  // into a real committed sample and a real committed transcript and require both to fire.
  const sample = await readFile(join(fileURLToPath(SAMPLES_DIR), 'port-default.claude-opus-5.0.2.0.txt'), 'utf8')
  const planted = `${sample}\n// ... rest of the implementation\n`
  assert.equal(detectElisions(sample).length, 0)
  assert.ok(detectElisions(planted).length > 0, 'the detector must fire on a real sample with an elision added')

  const raw = await readFile(
    join(fileURLToPath(TRANSCRIPTS_DIR), 'claude-fable-5-bluf-rename-option-t1.jsonl'), 'utf8')
  const events = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  assert.equal(scanTranscript(events).length, 0)

  const assistant = events.find(event => event.type === 'assistant' &&
    (event.message?.content ?? []).some(block => block.type === 'text'))
  assert.ok(assistant, 'this transcript must contain an assistant text block for the plant to be meaningful')
  const plantedEvents = events.map(event => event === assistant
    ? {
        ...event,
        message: {
          ...event.message,
          content: event.message.content.map(block => block.type === 'text'
            ? { ...block, text: `${block.text}\n/* unchanged */` }
            : block)
        }
      }
    : event)
  assert.ok(scanTranscript(plantedEvents).length > 0, 'the transcript scanner must fire on a real transcript with an elision added')
})

test('the transcripts actually contain assistant prose to scan', async () => {
  // A transcript set with no assistant text blocks would score zero forever. The report's zero
  // is only meaningful if there was prose there to flag.
  const { transcripts } = await scanCommittedCorpus()
  let withProse = 0
  for (const entry of transcripts) {
    const raw = await readFile(join(fileURLToPath(TRANSCRIPTS_DIR), entry.file), 'utf8')
    const events = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    const chars = events
      .filter(event => event.type === 'assistant')
      .flatMap(event => event.message?.content ?? [])
      .filter(block => block.type === 'text')
      .reduce((sum, block) => sum + block.text.length, 0)
    if (chars > 0) withProse += 1
  }
  assert.equal(withProse, 18, 'every transcript must carry assistant prose for the zero to mean anything')
})

test('condition attribution is decided by rule, not by guessing', () => {
  assert.equal(conditionOfSample('git-no-ff.claude-opus-5.baseline.txt'), 'baseline')
  assert.equal(conditionOfSample('port-default.claude-opus-5.0.2.0.txt'), 'styled')
  assert.equal(conditionOfSample('something-else.txt'), 'unknown')
  assert.equal(conditionOfTranscript('claude-fable-5-baseline-explain-cache-t1.jsonl'), 'baseline')
  assert.equal(conditionOfTranscript('claude-fable-5-bluf-explain-cache-t1.jsonl'), 'bluf')
  assert.equal(conditionOfTranscript('mystery.jsonl'), 'unknown')
})
