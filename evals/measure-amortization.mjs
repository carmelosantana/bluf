import { writeFile, mkdir, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  AMORTIZATION_CASE, CONDITIONS, ENVIRONMENTS, MODELS,
  OVERHEAD_ENVIRONMENT, OVERHEAD_MODEL, PROMPTS_SHA256,
  loadCases, runAmortizationPair, assertStyleOverheadPresent,
  assertTurn2ReadFromCache, assertTurn2CarriedTurn1, assertTurn1WasCold
} from './lib/runner.mjs'

// This slice spends real money. Every check below is free and runs before the first
// paid call, matching the rule evals/measure.mjs follows.
const MAX_TRIALS = 3

const TRIALS = Number(process.env.TRIALS ?? 3)
if (!Number.isInteger(TRIALS) || TRIALS < 1) {
  throw new Error(`TRIALS must be an integer >= 1, got: ${JSON.stringify(process.env.TRIALS)} (parsed as ${TRIALS})`)
}
if (TRIALS > MAX_TRIALS) {
  throw new Error(`TRIALS=${TRIALS} exceeds MAX_TRIALS=${MAX_TRIALS}. Raise the constant deliberately if you truly need more.`)
}

const RESULTS = new URL('./results/', import.meta.url)

const promptsText = await readFile(new URL('./prompts.jsonl', import.meta.url), 'utf8')
const promptsHash = createHash('sha256').update(promptsText).digest('hex')
if (promptsHash !== PROMPTS_SHA256) {
  throw new Error(
    `prompts.jsonl hash ${promptsHash} does not match the pinned PROMPTS_SHA256 ${PROMPTS_SHA256}. ` +
    'The prompt set changed, which invalidates every committed result. Update the pin deliberately and re-sweep.'
  )
}

if (!(OVERHEAD_ENVIRONMENT in ENVIRONMENTS)) {
  throw new Error(`OVERHEAD_ENVIRONMENT ${OVERHEAD_ENVIRONMENT} is not a known environment`)
}
if (!MODELS.includes(OVERHEAD_MODEL)) {
  throw new Error(`OVERHEAD_MODEL ${OVERHEAD_MODEL} is not in MODELS`)
}

const cases = await loadCases()
const caseRow = cases.find(row => row.id === AMORTIZATION_CASE)
if (!caseRow) {
  throw new Error(`amortization case ${AMORTIZATION_CASE} is not in prompts.jsonl`)
}

const conditions = Object.keys(CONDITIONS)
const totalCalls = conditions.length * TRIALS * 2
console.log(
  `amortization slice: ${conditions.length} conditions x ${TRIALS} trials x 2 turns = ${totalCalls} calls\n` +
  `case: ${AMORTIZATION_CASE}  model: ${OVERHEAD_MODEL}  environment: ${OVERHEAD_ENVIRONMENT}`
)

await mkdir(RESULTS, { recursive: true })

// A prior run — completed with a different TRIALS, or aborted partway — may have left
// amortization files behind, and a run that then aborts before overwriting all of them
// leaves a slice that silently mixes vintages. Delete exactly the files this run will
// write — the OVERHEAD_MODEL file for each condition — so that any amortization file
// for THIS model on disk afterwards is unambiguously this run's. An amortization file
// for a different model is outside the rm's scope and survives it.
// This is a free action: it sits below every free gate (an aborted gate leaves prior
// results untouched) and above the first paid call.
const targetFor = condition => new URL(`amortization-${OVERHEAD_MODEL}-${condition}.jsonl`, RESULTS)
for (const condition of conditions) {
  await rm(targetFor(condition), { force: true })
}

const allRows = []
const writtenFiles = []
let persistedRows = 0

// The try covers every paid call AND the writes of what they bought: a failure anywhere
// after the first paid call must still account for every row that was paid for.
try {
  for (const condition of conditions) {
    const rows = []
    for (let trial = 1; trial <= TRIALS; trial += 1) {
      const pair = await runAmortizationPair(
        caseRow, condition, OVERHEAD_MODEL, OVERHEAD_ENVIRONMENT, trial
      )
      rows.push(...pair)
      allRows.push(...pair)
      for (const row of pair) {
        console.log(
          `  ${condition} trial ${trial} turn ${row.turn}: ` +
          `uncached ${row.inputUncached}, cache-read ${row.inputCacheRead}, ` +
          `cache-write ${row.inputCacheWrite} (1h ${row.inputCacheWrite1h}, 5m ${row.inputCacheWrite5m}), ` +
          `output ${row.outputTokens}`
        )
      }
    }
    const target = targetFor(condition)
    await writeFile(target, rows.map(row => JSON.stringify(row)).join('\n') + '\n')
    writtenFiles.push(target.pathname)
    persistedRows += rows.length
    console.log(`wrote ${target.pathname}`)
  }
} catch (error) {
  // runAmortizationPair attaches the rows it already bought to the error. Together with
  // the completed pairs not yet persisted to a file, these are the paid rows that would
  // otherwise vanish with the stack trace — an unreported paid row is a wasted call
  // nobody can account for.
  const bought = error?.rows ?? error?.cause?.rows ?? []
  const unpersisted = [...allRows.slice(persistedRows), ...bought]
  if (unpersisted.length > 0) {
    console.error(`\npaid rows collected but not written to any result file (${unpersisted.length}):`)
    for (const row of unpersisted) console.error(`  ${JSON.stringify(row)}`)
  }
  // A throw mid-loop is the path where partial result files actually happen: whole
  // conditions may already be on disk, each file internally complete-looking. Non-zero
  // exit protects the shell, not the files, so the operator must be told in words.
  if (writtenFiles.length > 0) {
    console.error(
      '\nINCOMPLETE SLICE: this run aborted after writing these result files:\n' +
      writtenFiles.map(path => `  ${path}`).join('\n') + '\n' +
      `They cover only part of the intended ${conditions.length}-condition slice and were never ` +
      'validated against each other. Do NOT read them as a finished measurement — delete them, ' +
      'or re-run the slice to completion (a fresh run clears them itself).'
    )
  }
  throw error
}

// The validity checks equalise the arms against each other but cannot know how many trials
// were intended, so a slice that lost the same trial in every condition would pass as a
// quietly smaller-n measurement. Pin the exact count here.
if (allRows.length !== totalCalls) {
  throw new Error(
    `expected ${totalCalls} rows (${conditions.length} conditions x ${TRIALS} trials x 2 turns) ` +
    `but collected ${allRows.length}. The result files above are already written; do not treat ` +
    'them as a complete slice.'
  )
}

// The real validity checks. All run after the money is spent — that is their job, not a
// defect: they convert a quiet false success into a loud abort (see the comment on
// assertTurn2ReadFromCache).
try {
  // First: did each resumed turn 2 actually read the cached prefix back? Every other
  // guard is output-token only, and the input tier is the figure this whole slice
  // exists to measure.
  assertTurn2ReadFromCache(allRows)

  // Second: did each turn 2 carry turn 1's exchange? A forked --resume re-sends a
  // byte-identical prefix that the cache serves back, so it passes the check above;
  // only the input-growth comparison against its own turn 1 catches it.
  assertTurn2CarriedTurn1(allRows)

  // Third: was every turn 1 a COLD cache write? The published turn-1 column and the
  // one-turn break-even are cold-write figures, and no other check enforces that
  // precondition — the style-overhead check below compares summed inputTokens, which
  // is identical whether the prefix was written or read.
  assertTurn1WasCold(allRows)

  // Fourth: was the style actually in the system prompt? Verified on the INPUT side —
  // each styled arm's turn-1 input median must exceed the baseline's by the measured
  // style overhead. Output length cannot answer this question: the paid run measured
  // an unstyled turn 1 at 5 output tokens (the styled figure) and a valid styled
  // turn 2 at 162 (baseline territory), so output-side comparisons either pass a
  // missing style or abort a valid run.
  assertStyleOverheadPresent(allRows)
} catch (error) {
  // On this path every result file is on disk with its full row count — a slice that
  // looks finished and is not. Nothing inside the files marks them invalid, so the
  // operator must be told in words. The rethrown assertion message is the diagnosis;
  // this warning only adds what it cannot know: which files it leaves behind.
  console.error(
    '\nINVALID SLICE: this run wrote its complete result files before validation failed:\n' +
    writtenFiles.map(path => `  ${path}`).join('\n') + '\n' +
    'They hold a complete-looking slice that failed a validity check (the error below is the ' +
    'diagnosis). Do NOT read them as a measurement — delete them, or fix the cause and re-run ' +
    'the slice (a fresh run clears them itself).'
  )
  throw error
}

console.log('\nDone. The figure that matters is turn 2: which tier the style overhead lands in.')
