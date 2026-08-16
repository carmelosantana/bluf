import { writeFile, mkdir, readFile } from 'node:fs/promises'
import {
  CONDITIONS, MODELS, MAIN_ENVIRONMENT, OVERHEAD_ENVIRONMENT, OVERHEAD_MODEL, OVERHEAD_CASES,
  loadCases, runCase
} from './lib/runner.mjs'
import { compare, formatReport } from './lib/report.mjs'
import { checkDrift } from './lib/drift.mjs'

const TRIALS = Number(process.env.TRIALS ?? 1)
const RESULTS = new URL('./results/', import.meta.url)

// Gate: never spend tokens measuring style files that have drifted apart.
const drift = checkDrift(
  await readFile(new URL('../output-styles/less-chatty.md', import.meta.url), 'utf8'),
  await readFile(new URL('../output-styles/less-chatty-terse.md', import.meta.url), 'utf8')
)
if (!drift.ok) {
  console.error(drift.message)
  console.error('refusing to measure drifted style files. run `npm run check`.')
  process.exit(1)
}

const cases = await loadCases()
const rows = {}

await mkdir(RESULTS, { recursive: true })

// Main sweep: every case, every condition, every model, full environment.
for (const model of MODELS) {
  rows[model] = { full: {}, lean: {} }
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
const overheadCases = cases.filter(caseRow => OVERHEAD_CASES.includes(caseRow.id))
if (overheadCases.length !== OVERHEAD_CASES.length) {
  throw new Error('OVERHEAD_CASES names a case id that is not in prompts.jsonl')
}

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
