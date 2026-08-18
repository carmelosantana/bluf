// Did the style make anything faster?
//
// It is the third question people ask after tokens and money, and this repository could not
// answer it: no `.jsonl` row in `evals/results/` records a duration. The result rows were
// designed around billing, and wall-clock never made it into the schema.
//
// It is recoverable anyway. The agentic sweeps committed their RAW stream-json transcripts, and
// the CLI's result event carries `duration_ms` (whole call, including local tool execution) and
// `duration_api_ms` (model time alone). So the 24 committed transcripts answer the question for
// free, without buying a single call.
//
// The limit that comes with that: this covers the agentic sweeps only. The 260-call prose sweep
// stored no transcripts, so its timing is gone and cannot be recovered without paying again.

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export const TRANSCRIPTS_DIR = new URL('../results/agentic-transcripts/', import.meta.url)

// Filenames are written by the driver as `<model>-<condition>-<fixture>-t<trial>.jsonl`. A
// filtered sweep appends its label, so `hidden-edges` appears twice in that fixture's names;
// the trailing duplicate is stripped rather than guessed at.
const NAME = /^(?<model>.+?)-(?<condition>baseline|bluf)-(?<fixture>.+)-t(?<trial>\d+)\.jsonl$/

export function parseTranscriptName (filename) {
  const match = NAME.exec(filename)
  if (!match) throw new Error(`transcript filename does not match the driver's pattern: ${filename}`)
  const { model, condition, fixture, trial } = match.groups
  return {
    model,
    condition,
    // `hidden-edges-hidden-edges` is the filter label plus the fixture name, not two fixtures.
    fixture: fixture.replace(/^(.+)-\1$/, '$1'),
    trial: Number(trial)
  }
}

// Every field is required. A transcript missing its result event, or a result event missing a
// duration, must throw rather than contribute a zero — a zero here would read as "instant" and
// drag a median toward a saving that was never measured.
export async function loadTimings (dir = TRANSCRIPTS_DIR) {
  const root = fileURLToPath(dir)
  const files = (await readdir(root)).filter(name => name.endsWith('.jsonl')).sort()
  if (files.length === 0) throw new Error(`no transcripts found in ${root}`)

  const timings = []
  for (const file of files) {
    const raw = await readFile(join(root, file), 'utf8')
    const events = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    const results = events.filter(event => event.type === 'result')
    if (results.length !== 1) {
      throw new Error(`${file} carries ${results.length} result events; exactly 1 is required`)
    }
    const [result] = results
    for (const field of ['duration_ms', 'duration_api_ms', 'num_turns']) {
      if (typeof result[field] !== 'number' || !Number.isFinite(result[field])) {
        throw new Error(`${file}: result event has no usable ${field} (${JSON.stringify(result[field])})`)
      }
    }
    timings.push({
      file,
      ...parseTranscriptName(file),
      wallMs: result.duration_ms,
      apiMs: result.duration_api_ms,
      turns: result.num_turns
    })
  }
  return timings
}

export const median = values => {
  if (values.length === 0) throw new Error('median of an empty set is not a number')
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

// Pairs styled against unstyled on (fixture, trial), the same pairing the token analysis uses.
// An unpaired row is dropped and counted rather than silently ignored, because a half-paired
// set would still produce a plausible median.
export function pairTimings (timings) {
  const baseline = new Map()
  for (const row of timings.filter(row => row.condition === 'baseline')) {
    baseline.set(`${row.model}|${row.fixture}|${row.trial}`, row)
  }

  const pairs = []
  let unpaired = 0
  for (const styled of timings.filter(row => row.condition === 'bluf')) {
    const match = baseline.get(`${styled.model}|${styled.fixture}|${styled.trial}`)
    if (!match) { unpaired += 1; continue }
    pairs.push({
      model: styled.model,
      fixture: styled.fixture,
      trial: styled.trial,
      baselineWallMs: match.wallMs,
      styledWallMs: styled.wallMs,
      baselineApiMs: match.apiMs,
      styledApiMs: styled.apiMs,
      wallDeltaMs: styled.wallMs - match.wallMs,
      apiDeltaMs: styled.apiMs - match.apiMs
    })
  }
  return { pairs, unpaired }
}

export function summariseTimings (pairs) {
  if (pairs.length === 0) throw new Error('no pairs to summarise')
  const wallDeltas = pairs.map(pair => pair.wallDeltaMs)
  const baselineTotal = pairs.reduce((sum, pair) => sum + pair.baselineWallMs, 0)
  const styledTotal = pairs.reduce((sum, pair) => sum + pair.styledWallMs, 0)

  return {
    pairs: pairs.length,
    baselineTotalMs: baselineTotal,
    styledTotalMs: styledTotal,
    totalPercent: (styledTotal - baselineTotal) / baselineTotal * 100,
    medianWallDeltaMs: median(wallDeltas),
    medianApiDeltaMs: median(pairs.map(pair => pair.apiDeltaMs)),
    faster: wallDeltas.filter(delta => delta < 0).length,
    slower: wallDeltas.filter(delta => delta > 0).length,
    unchanged: wallDeltas.filter(delta => delta === 0).length
  }
}
