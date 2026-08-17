import { writeFile, mkdir, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  CONDITIONS, MODELS, ENVIRONMENTS, MAIN_ENVIRONMENT, OVERHEAD_ENVIRONMENT, OVERHEAD_MODEL,
  OVERHEAD_CASES, PROMPTS_SHA256, loadCases, runCase, readCliVersion,
  assertStyleOverheadPresent, assertUserStyleFresh
} from './lib/runner.mjs'
import { scheduleSweep, SCHEDULE_VERSION } from './lib/schedule.mjs'
import { compare, formatReport } from './lib/report.mjs'
import { plannedSweepFiles, assertOverwritesAllowed, assertGitUsable, OVERWRITE_ALLOWLIST_VAR } from './lib/overwrite-gate.mjs'

const run = promisify(execFile)

// Every sweep below spends real money. All cheap validation happens up here,
// before the first paid runCase call.
//
// Raised from 3 to 5 for the clean-environment sweep. The isolated room is noisier: across
// three replication trials the baseline output totals spanned 28%, against 3.2% for the same
// model in `full`. The extra trials exist to resolve that spread, and the ceiling stays low
// because every trial multiplies a paid sweep.
const MAX_TRIALS = 5

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

// Gate: never start a sweep that would overwrite committed measurement evidence. The
// result files are written unconditionally below, so any of them that git tracks is a
// published-claim citation one successful run away from destruction — the loss is
// silent, and the replacement rows (different trial count, schedule version, CLI
// version) are not equivalent evidence. Enumerating the doomed paths and checking
// them against git is free; recovering destroyed rows is not possible. The escape
// hatch is deliberate and auditable: OVERWRITE_ALLOWLIST_VAR must name each file,
// never a bare boolean.
//
// The per-path probe below reads a non-zero `git ls-files --error-unmatch` exit as
// "untracked, safe to write" — which is only sound once git itself is known to work,
// because a broken git (not installed, dubious-ownership refusal in a container or as
// another user) exits non-zero for EVERY path and would fail the gate open. So git is
// probed once up front, and assertGitUsable refuses to run when the probe fails while
// a .git directory exists at the repository root. When there is genuinely no .git,
// there is no committed evidence to protect and the run proceeds with nothing tracked.
const planned = plannedSweepFiles({
  models: MODELS,
  conditions: Object.keys(CONDITIONS),
  mainEnvironment: MAIN_ENVIRONMENT,
  overheadEnvironment: OVERHEAD_ENVIRONMENT,
  overheadModel: OVERHEAD_MODEL
})
{
  let probeSucceeded = true
  try {
    await run('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: fileURLToPath(new URL('.', import.meta.url))
    })
  } catch {
    probeSucceeded = false
  }
  let gitDirExists = true
  try {
    await stat(new URL('../.git', import.meta.url))
  } catch {
    gitDirExists = false
  }
  assertGitUsable({ probeSucceeded, gitDirExists })

  const trackedFiles = []
  if (probeSucceeded) {
    for (const name of planned) {
      try {
        await run('git', ['ls-files', '--error-unmatch', '--', fileURLToPath(new URL(`./${name}`, RESULTS))], {
          cwd: fileURLToPath(new URL('.', import.meta.url))
        })
        trackedFiles.push(name)
      } catch {
        // untracked: nothing committed at this path, so the sweep may write it
      }
    }
  }
  assertOverwritesAllowed({
    plannedFiles: planned,
    trackedFiles,
    allowValue: process.env[OVERWRITE_ALLOWLIST_VAR]
  })
}

// Gate: verify the USER-level style install before spending. The lean overhead sweep
// passes no --setting-sources, so its styled arm loads the style from the operator's
// ~/.claude/output-styles/bluf.md — a path runCase never checks (its install and
// assertion are clean-environment-only). The post-payment assertStyleOverheadPresent
// check at the end of the sweep does catch a missing or stale install, but only after
// all 260 calls are paid, with no partial mode to recover the lean arm. This read is
// free and READ ONLY: nothing is ever written under ~/.claude.
{
  const userStylePath = join(homedir(), '.claude', 'output-styles', 'bluf.md')
  let installed = null
  try {
    installed = await readFile(userStylePath)
  } catch {
    // absent: assertUserStyleFresh receives null and refuses with the install command
  }
  assertUserStyleFresh({
    path: userStylePath,
    actualSha256: installed === null ? null : createHash('sha256').update(installed).digest('hex')
  })
}

// Warm the CLI-version cache before any money is spent. runCase awaits readCliVersion
// AFTER its paid call returns, so a broken claude binary discovered there throws away a
// row that was already paid for — and that row never reaches allRows, so the
// unpersisted-row accounting below cannot even report the loss. `claude --version` is a
// free local query, so failing here costs nothing.
await readCliVersion()

const rows = {}

await mkdir(RESULTS, { recursive: true })

// Failure-accounting bookkeeping, error reporting ONLY: nothing below alters what is
// measured, in what order, or what a successful run writes. Rows are only persisted
// after a model's entire case loop, and parseUsage is deliberately strict, so without
// this a single malformed payload late in a loop would discard up to 72 paid calls
// with a bare stack trace — the sibling driver measure-amortization.mjs already
// accounts for its paid rows the same way.
const allRows = []
const persisted = new Set()
const writtenFiles = []

try {
  // Main sweep: every case, every condition, every model, full environment.
  //
  // Conditions are INTERLEAVED, not run in blocks. An earlier version ran all twelve
  // baseline calls, then all twelve styled calls, which confounded the condition with
  // elapsed time: any drift over the sweep's runtime landed entirely on the later
  // conditions. Running the conditions for one case back to back means drift hits them
  // equally. A trial is now a whole sweep of every case — the schedule is trial-major,
  // with the case order reshuffled per trial — so repeated trials are repeated
  // measurements of the sweep rather than back-to-back repeats of one case. The order
  // is also rotated per case and trial so no condition permanently occupies
  // the first slot, where it would always be the one paying cache-creation cost.
  for (const model of MODELS) {
    rows[model] = Object.fromEntries(Object.keys(ENVIRONMENTS).map(environment => [environment, {}]))
    for (const condition of Object.keys(CONDITIONS)) {
      rows[model][MAIN_ENVIRONMENT][condition] = []
    }

    for (const entry of scheduleSweep({ cases, conditions: Object.keys(CONDITIONS), trials: TRIALS })) {
      process.stderr.write(`${MAIN_ENVIRONMENT} ${model} ${entry.condition} trial ${entry.trial} ${entry.caseId}\n`)
      const row = await runCase(cases[entry.caseIndex], entry.condition, model, MAIN_ENVIRONMENT, entry.trial)
      // The schedule is the driver's concern, not the runner's, so the version is
      // stamped here rather than in runCase — see SCHEDULE_VERSION in lib/schedule.mjs.
      row.scheduleVersion = SCHEDULE_VERSION
      rows[model][MAIN_ENVIRONMENT][entry.condition].push(row)
      allRows.push(row)
    }

    // Written after the loop: a condition's rows are no longer contiguous.
    for (const condition of Object.keys(CONDITIONS)) {
      const target = new URL(`./${MAIN_ENVIRONMENT}-${model}-${condition}.jsonl`, RESULTS)
      await writeFile(
        target,
        rows[model][MAIN_ENVIRONMENT][condition].map(row => JSON.stringify(row)).join('\n') + '\n'
      )
      for (const row of rows[model][MAIN_ENVIRONMENT][condition]) persisted.add(row)
      writtenFiles.push(target.pathname)
    }

    // The structural guard in runCase proves the style file is on disk. It cannot prove the
    // CLI loaded it — that is CLI behaviour no local assertion observes. Without this, a
    // clean sweep whose style silently failed to load writes a full set of
    // Default-against-Default rows and reports success. Runs after payment because it needs
    // measured input; it cannot save the money, only stop the result being published. It
    // also runs after the rows are persisted, so an abort here still leaves the paid
    // evidence on disk for diagnosis (flagged INCOMPLETE by the catch below).
    //
    // Called once per case, never across the sweep: assertStyleOverheadPresent refuses
    // rows that mix caseIds — deliberately, because a baseline from a different prompt
    // would make the overhead measure the prompt mix rather than the style — so each
    // styled arm is validated against the baseline measured on the same prompt. Sweep
    // rows carry no `turn` field; turn 1 is synthesised because every sweep row is a
    // single-call first turn, which is exactly what the check is defined over.
    for (const caseRow of cases) {
      assertStyleOverheadPresent(
        Object.values(rows[model][MAIN_ENVIRONMENT])
          .flatMap(list => list
            .filter(row => row.caseId === caseRow.id)
            .map(row => ({ ...row, turn: 1 })))
      )
    }
  }

  // Environment-overhead sweep: two designated cases, lean environment, one pinned model.
  // OVERHEAD_MODEL is pinned to claude-opus-5 for comparability with the committed 0.2.0
  // lean rows, which were measured on that model. The old rationale — that the lean flags
  // force claude-opus-5 regardless of what --model requests — did not reproduce on
  // 2026-08-17 (see evals/results/probes/README.md, "Model resolution").
  // Membership was validated at the top of the file, before the paid main sweep.
  const overheadCases = cases.filter(caseRow => OVERHEAD_CASES.includes(caseRow.id))

  for (const condition of Object.keys(CONDITIONS)) {
    rows[OVERHEAD_MODEL][OVERHEAD_ENVIRONMENT][condition] = []
  }

  // Interleaved and rotated for the same reason as the main sweep, and likewise
  // trial-major: a trial is a whole sweep of both cases, with the rotation keyed on
  // case and trial. It matters more here: this sweep exists to isolate the style's
  // input-token overhead, so a systematic cache-cost difference between conditions
  // would land directly on the number it is measuring.
  for (const entry of scheduleSweep({ cases: overheadCases, conditions: Object.keys(CONDITIONS), trials: TRIALS })) {
    process.stderr.write(`${OVERHEAD_ENVIRONMENT} ${OVERHEAD_MODEL} ${entry.condition} trial ${entry.trial} ${entry.caseId}\n`)
    const row = await runCase(overheadCases[entry.caseIndex], entry.condition, OVERHEAD_MODEL, OVERHEAD_ENVIRONMENT, entry.trial)
    row.scheduleVersion = SCHEDULE_VERSION
    rows[OVERHEAD_MODEL][OVERHEAD_ENVIRONMENT][entry.condition].push(row)
    allRows.push(row)
  }

  for (const condition of Object.keys(CONDITIONS)) {
    const target = new URL(`./${OVERHEAD_ENVIRONMENT}-${OVERHEAD_MODEL}-${condition}.jsonl`, RESULTS)
    await writeFile(
      target,
      rows[OVERHEAD_MODEL][OVERHEAD_ENVIRONMENT][condition].map(row => JSON.stringify(row)).join('\n') + '\n'
    )
    for (const row of rows[OVERHEAD_MODEL][OVERHEAD_ENVIRONMENT][condition]) persisted.add(row)
    writtenFiles.push(target.pathname)
  }

  // Same post-payment style check as the main sweep, and it matters MORE here: the lean
  // environment passes no --setting-sources, so this arm loads the style from the
  // operator's user-level ~/.claude/output-styles install, which runCase never verifies —
  // installProjectStyle and its on-disk assertion are clean-environment-only, and
  // `npm run preflight` exercises the clean environment only. Without this, a missing or
  // stale user-level install makes all 20 lean calls measure Default against Default and
  // report the overhead figure as fiction. Per case, with a synthesised turn 1, positioned
  // after the write block, for the reasons documented on the main sweep's check above:
  // a throw here still leaves the paid rows persisted and accounted for.
  for (const caseRow of overheadCases) {
    assertStyleOverheadPresent(
      Object.values(rows[OVERHEAD_MODEL][OVERHEAD_ENVIRONMENT])
        .flatMap(list => list
          .filter(row => row.caseId === caseRow.id)
          .map(row => ({ ...row, turn: 1 })))
    )
  }
} catch (error) {
  // Every row already collected but not yet written to a result file would otherwise
  // vanish with the stack trace — an unreported paid row is a wasted call nobody can
  // account for. Persistence happens per condition, not in run order, so membership in
  // the persisted set — not a count — decides which rows were saved.
  const unpersisted = allRows.filter(row => !persisted.has(row))
  if (unpersisted.length > 0) {
    console.error(`\npaid rows collected but not written to any result file (${unpersisted.length}):`)
    for (const row of unpersisted) console.error(`  ${JSON.stringify(row)}`)
  }
  // A throw mid-sweep is the path where partial result files actually happen: an
  // earlier model's files may already be on disk, each internally complete-looking.
  // Non-zero exit protects the shell, not the files, so the operator must be told —
  // accurately. Two distinct situations end here, and conflating them would mislead:
  // a genuinely partial sweep, and a run whose every result file was written but
  // whose post-payment validation or report generation then failed. "All expected"
  // is derived from the same plannedSweepFiles enumeration the overwrite gate uses
  // (minus report.md, which is only written after this try block), never a
  // hard-coded count.
  if (writtenFiles.length > 0) {
    const expectedResultFiles = planned.filter(name => name !== 'report.md')
    if (writtenFiles.length === expectedResultFiles.length) {
      console.error(
        '\nINCOMPLETE SWEEP: this run aborted AFTER writing all ' +
        `${expectedResultFiles.length} expected result files:\n` +
        writtenFiles.map(path => `  ${path}`).join('\n') + '\n' +
        'The result files themselves are complete — the failure above happened in a ' +
        'post-payment validation step or in report generation, so report.md was not ' +
        'written. Read the error before trusting the rows: it may indict what they ' +
        'measured, not merely how the run ended. A rerun overwrites them.'
      )
    } else {
      console.error(
        '\nINCOMPLETE SWEEP: this run aborted after writing these result files:\n' +
        writtenFiles.map(path => `  ${path}`).join('\n') + '\n' +
        'They cover only part of the intended sweep. Do NOT read them as a ' +
        'finished measurement — a rerun overwrites them.'
      )
    }
  }
  throw error
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
