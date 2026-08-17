import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  CONDITIONS, MODELS, ENVIRONMENTS, MAIN_ENVIRONMENT, OVERHEAD_ENVIRONMENT, OVERHEAD_MODEL,
  OVERHEAD_CASES, PROMPTS_SHA256, loadCases, runCase, rotate
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
    await readFile(new URL('../output-styles/bluf.md', import.meta.url), 'utf8'),
    await readFile(new URL('../output-styles/bluf-terse.md', import.meta.url), 'utf8')
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

// Gate: never spend tokens measuring a case set that no longer matches the pin. A
// silent edit to prompts.jsonl would produce results that look comparable to the
// committed ones but answer different questions.
const promptsDigest = createHash('sha256')
  .update(await readFile(new URL('./prompts.jsonl', import.meta.url)))
  .digest('hex')
if (promptsDigest !== PROMPTS_SHA256) {
  console.error(
    `evals/prompts.jsonl does not match PROMPTS_SHA256 in evals/lib/runner.mjs.\n` +
    `  expected: ${PROMPTS_SHA256}\n` +
    `  actual:   ${promptsDigest}\n` +
    'If the case set changed on purpose, update the constant and treat every committed ' +
    'result as superseded. Refusing to spend a paid sweep on an unpinned case set.'
  )
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
for (const [label, environment] of [['MAIN_ENVIRONMENT', MAIN_ENVIRONMENT], ['OVERHEAD_ENVIRONMENT', OVERHEAD_ENVIRONMENT]]) {
  if (!(environment in ENVIRONMENTS)) {
    throw new Error(
      `${label}=${environment} is not a key of ENVIRONMENTS [${Object.keys(ENVIRONMENTS).join(', ')}]. ` +
      'Without this check an invalid OVERHEAD_ENVIRONMENT would only fail after the whole main sweep had run.'
    )
  }
}

const rows = {}

await mkdir(RESULTS, { recursive: true })

// Main sweep: every case, every condition, every model, full environment.
//
// Conditions are INTERLEAVED, not run in blocks. An earlier version ran all twelve
// baseline calls, then all twelve styled calls, which confounded the condition with
// elapsed time: any drift over the sweep's runtime landed entirely on the later
// conditions. Running the conditions for one case back to back means drift hits them
// equally. The order is also rotated per case so no condition permanently occupies
// the first slot, where it would always be the one paying cache-creation cost.
for (const model of MODELS) {
  rows[model] = Object.fromEntries(Object.keys(ENVIRONMENTS).map(environment => [environment, {}]))
  for (const condition of Object.keys(CONDITIONS)) {
    rows[model][MAIN_ENVIRONMENT][condition] = []
  }

  for (const [index, caseRow] of cases.entries()) {
    for (let trial = 1; trial <= TRIALS; trial += 1) {
      for (const condition of rotate(Object.keys(CONDITIONS), index)) {
        process.stderr.write(`${MAIN_ENVIRONMENT} ${model} ${condition} trial ${trial} ${caseRow.id}\n`)
        rows[model][MAIN_ENVIRONMENT][condition].push(
          await runCase(caseRow, condition, model, MAIN_ENVIRONMENT, trial)
        )
      }
    }
  }

  // Written after the loop: a condition's rows are no longer contiguous.
  for (const condition of Object.keys(CONDITIONS)) {
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
}

// Interleaved and rotated for the same reason as the main sweep. It matters more
// here: this sweep exists to isolate the style's input-token overhead, so a
// systematic cache-cost difference between conditions would land directly on the
// number it is measuring.
for (const [index, caseRow] of overheadCases.entries()) {
  for (let trial = 1; trial <= TRIALS; trial += 1) {
    for (const condition of rotate(Object.keys(CONDITIONS), index)) {
      process.stderr.write(`${OVERHEAD_ENVIRONMENT} ${OVERHEAD_MODEL} ${condition} trial ${trial} ${caseRow.id}\n`)
      rows[OVERHEAD_MODEL][OVERHEAD_ENVIRONMENT][condition].push(
        await runCase(caseRow, condition, OVERHEAD_MODEL, OVERHEAD_ENVIRONMENT, trial)
      )
    }
  }
}

for (const condition of Object.keys(CONDITIONS)) {
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
