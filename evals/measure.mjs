import { writeFile, mkdir, readFile } from 'node:fs/promises'
import {
  CONDITIONS, MODELS, ENVIRONMENTS, MAIN_ENVIRONMENT, OVERHEAD_ENVIRONMENT, OVERHEAD_MODEL,
  OVERHEAD_CASES, loadCases, runCase
} from './lib/runner.mjs'
import { compare, formatReport } from './lib/report.mjs'
import { checkDrift } from './lib/drift.mjs'

// Every sweep below spends real money. All cheap validation happens up here,
// before the first paid runCase call.
const MAX_TRIALS = 3

const TRIALS = Number(process.env.TRIALS ?? 1)
if (!Number.isInteger(TRIALS) || TRIALS < 1) {
  throw new Error(
    `TRIALS must be an integer >= 1, got: ${JSON.stringify(process.env.TRIALS)} (parsed as ${TRIALS})`
  )
}
if (TRIALS > MAX_TRIALS) {
  throw new Error(
    `TRIALS=${TRIALS} exceeds MAX_TRIALS=${MAX_TRIALS}. Every trial multiplies a paid API sweep, ` +
    'so this ceiling is deliberate. If you genuinely need more, raise the MAX_TRIALS constant in evals/measure.mjs.'
  )
}

const RESULTS = new URL('./results/', import.meta.url)

// Gate: never spend tokens measuring style files that have drifted apart.
let drift
try {
  drift = checkDrift(
    await readFile(new URL('../output-styles/less-chatty.md', import.meta.url), 'utf8'),
    await readFile(new URL('../output-styles/less-chatty-terse.md', import.meta.url), 'utf8')
  )
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
if (!drift.ok) {
  console.error(drift.message)
  console.error('refusing to measure drifted style files. run `npm run check`.')
  process.exit(1)
}

const cases = await loadCases()

// Overhead-sweep preconditions, checked before any money is spent: a typo here
// would otherwise only surface after the entire main sweep had already run.
for (const id of OVERHEAD_CASES) {
  if (!cases.some(caseRow => caseRow.id === id)) {
    throw new Error(`OVERHEAD_CASES names a case id that is not in prompts.jsonl: ${id}`)
  }
}
if (!MODELS.includes(OVERHEAD_MODEL)) {
  throw new Error(
    `OVERHEAD_MODEL=${OVERHEAD_MODEL} is not in MODELS [${MODELS.join(', ')}]. ` +
    'The overhead sweep reuses the row bucket the main sweep creates for that model, ' +
    'so OVERHEAD_MODEL must be one of the models the main sweep runs.'
  )
}

const rows = {}

await mkdir(RESULTS, { recursive: true })

// Main sweep: every case, every condition, every model, full environment.
for (const model of MODELS) {
  rows[model] = Object.fromEntries(Object.keys(ENVIRONMENTS).map(environment => [environment, {}]))
  for (const condition of Object.keys(CONDITIONS)) {
    rows[model][MAIN_ENVIRONMENT][condition] = []
    for (let trial = 1; trial <= TRIALS; trial += 1) {
      for (const caseRow of cases) {
        process.stderr.write(`${MAIN_ENVIRONMENT} ${model} ${condition} trial ${trial} ${caseRow.id}\n`)
        rows[model][MAIN_ENVIRONMENT][condition].push(
          await runCase(caseRow, condition, model, MAIN_ENVIRONMENT, trial)
        )
      }
    }
    await writeFile(
      new URL(`./${MAIN_ENVIRONMENT}-${model}-${condition}.jsonl`, RESULTS),
      rows[model][MAIN_ENVIRONMENT][condition].map(row => JSON.stringify(row)).join('\n') + '\n'
    )
  }
}

// Environment-overhead sweep: two designated cases, lean environment, one pinned model.
// OVERHEAD_MODEL must be claude-opus-5: the lean flags force that model regardless of
// what --model requests, so pinning it is what holds the model constant.
// Membership was validated at the top of the file, before the paid main sweep.
const overheadCases = cases.filter(caseRow => OVERHEAD_CASES.includes(caseRow.id))

for (const condition of Object.keys(CONDITIONS)) {
  rows[OVERHEAD_MODEL][OVERHEAD_ENVIRONMENT][condition] = []
  for (let trial = 1; trial <= TRIALS; trial += 1) {
    for (const caseRow of overheadCases) {
      process.stderr.write(`${OVERHEAD_ENVIRONMENT} ${OVERHEAD_MODEL} ${condition} trial ${trial} ${caseRow.id}\n`)
      rows[OVERHEAD_MODEL][OVERHEAD_ENVIRONMENT][condition].push(
        await runCase(caseRow, condition, OVERHEAD_MODEL, OVERHEAD_ENVIRONMENT, trial)
      )
    }
  }
  await writeFile(
    new URL(`./${OVERHEAD_ENVIRONMENT}-${OVERHEAD_MODEL}-${condition}.jsonl`, RESULTS),
    rows[OVERHEAD_MODEL][OVERHEAD_ENVIRONMENT][condition].map(row => JSON.stringify(row)).join('\n') + '\n'
  )
}

const reports = []
for (const model of MODELS) {
  for (const condition of Object.keys(CONDITIONS)) {
    if (condition === 'baseline') continue
    reports.push(formatReport(
      compare(rows[model][MAIN_ENVIRONMENT].baseline, rows[model][MAIN_ENVIRONMENT][condition]),
      { condition, model, environment: MAIN_ENVIRONMENT }
    ))
  }
}

for (const condition of Object.keys(CONDITIONS)) {
  if (condition === 'baseline') continue
  reports.push(formatReport(
    compare(
      rows[OVERHEAD_MODEL][OVERHEAD_ENVIRONMENT].baseline,
      rows[OVERHEAD_MODEL][OVERHEAD_ENVIRONMENT][condition]
    ),
    { condition, model: OVERHEAD_MODEL, environment: OVERHEAD_ENVIRONMENT }
  ))
}

const report = reports.join('\n\n---\n\n')
await writeFile(new URL('./report.md', RESULTS), report)
console.log(report)
