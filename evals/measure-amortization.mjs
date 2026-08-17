import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  AMORTIZATION_CASE, CONDITIONS, ENVIRONMENTS, MODELS,
  OVERHEAD_ENVIRONMENT, OVERHEAD_MODEL, PROMPTS_SHA256,
  loadCases, runAmortizationPair, assertStyledBelowBaseline
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

const allRows = []

for (const condition of conditions) {
  const rows = []
  for (let trial = 1; trial <= TRIALS; trial += 1) {
    let pair
    try {
      pair = await runAmortizationPair(
        caseRow, condition, OVERHEAD_MODEL, OVERHEAD_ENVIRONMENT, trial
      )
    } catch (error) {
      // runAmortizationPair attaches the rows it already bought. Reporting them is this
      // driver's job — an unreported paid row is a wasted call nobody can account for.
      const bought = error?.rows ?? error?.cause?.rows ?? []
      if (bought.length > 0) {
        console.error(`\npaid rows already collected before the failure (${bought.length}):`)
        for (const row of bought) console.error(`  ${JSON.stringify(row)}`)
      }
      throw error
    }
    rows.push(...pair)
    for (const row of pair) {
      console.log(
        `  ${condition} trial ${trial} turn ${row.turn}: ` +
        `uncached ${row.inputUncached}, cache-read ${row.inputCacheRead}, ` +
        `cache-write ${row.inputCacheWrite} (1h ${row.inputCacheWrite1h}, 5m ${row.inputCacheWrite5m}), ` +
        `output ${row.outputTokens}`
      )
    }
  }
  const target = new URL(`amortization-${OVERHEAD_MODEL}-${condition}.jsonl`, RESULTS)
  await writeFile(target, rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  console.log(`wrote ${target.pathname}`)
  allRows.push(...rows)
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

// The real validity check: styled turn-2 output measured against the baseline arm this slice
// just bought, rather than against a hardcoded ceiling.
assertStyledBelowBaseline(allRows)

console.log('\nDone. The figure that matters is turn 2: which tier the style overhead lands in.')
