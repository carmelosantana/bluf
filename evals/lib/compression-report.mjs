// Runs the over-compression detector across everything this repository has already paid for.
//
// The corpus is two kinds of committed evidence:
//   - evals/results/samples/*.txt          verbatim prose responses (the .jsonl rows store no text)
//   - evals/results/agentic-transcripts/   the raw stream-json of all 18 agentic calls
//
// This module spends nothing. It exists so the adequacy question gets an answer from data already
// on disk before any further money is spent on it.

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { detectElisions, scanTranscript } from './compression.mjs'

export const SAMPLES_DIR = new URL('../results/samples/', import.meta.url)
export const TRANSCRIPTS_DIR = new URL('../results/agentic-transcripts/', import.meta.url)

// Sample filenames encode the condition in a way the transcripts do not. A file named
// `<case>.<model>.baseline.txt` is an unstyled capture; every other captured sample is a styled
// one, named for the rule version that produced it (0.1.0, 0.2.0). Anything that does not match
// is returned as `unknown` rather than being guessed into a bucket — a miscategorised sample
// would put a styled response's elisions on the baseline's account.
export function conditionOfSample (filename) {
  if (/\.baseline\.txt$/.test(filename)) return 'baseline'
  if (/\.\d+\.\d+\.\d+\.txt$/.test(filename)) return 'styled'
  return 'unknown'
}

// Transcript filenames are written by the driver as
// `<model>-<condition>-<fixture>-t<trial>.jsonl`, so the condition is unambiguous.
export function conditionOfTranscript (filename) {
  if (filename.includes('-baseline-')) return 'baseline'
  if (filename.includes('-bluf-')) return 'bluf'
  return 'unknown'
}

export async function scanCommittedCorpus () {
  const samples = []
  for (const name of (await readdir(SAMPLES_DIR)).filter(n => n.endsWith('.txt')).sort()) {
    const text = await readFile(join(fileURLToPath(SAMPLES_DIR), name), 'utf8')
    samples.push({ file: name, condition: conditionOfSample(name), hits: detectElisions(text) })
  }

  const transcripts = []
  for (const name of (await readdir(TRANSCRIPTS_DIR)).filter(n => n.endsWith('.jsonl')).sort()) {
    const raw = await readFile(join(fileURLToPath(TRANSCRIPTS_DIR), name), 'utf8')
    const events = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    transcripts.push({ file: name, condition: conditionOfTranscript(name), hits: scanTranscript(events) })
  }

  return { samples, transcripts, totals: totalsOf(samples, transcripts) }
}

// Counts per condition, carrying the flagged excerpts with them. A bare count is unfalsifiable;
// this repository does not publish numbers a reader cannot check by hand.
export function totalsOf (samples, transcripts) {
  const totals = {}
  for (const [corpus, entries] of [['samples', samples], ['transcripts', transcripts]]) {
    for (const entry of entries) {
      const bucket = (totals[corpus] ??= {})
      const cell = (bucket[entry.condition] ??= { files: 0, hits: 0, excerpts: [] })
      cell.files += 1
      cell.hits += entry.hits.length
      for (const hit of entry.hits) cell.excerpts.push({ file: entry.file, ...hit })
    }
  }
  return totals
}
