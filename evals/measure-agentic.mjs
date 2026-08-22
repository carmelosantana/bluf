import { readFile, stat, mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONDITIONS, readCliVersion, assertUserStyleFresh } from './lib/runner.mjs'
import { runAgenticSweep, FIXTURE_SHAPES } from './lib/agentic.mjs'
import { loadFixtures, copyFixture, runFixtureTest, runHiddenTest, applyOracle, applyNaive } from './lib/fixtures.mjs'
import {
  agenticRowFile, plannedAgenticSweepFiles, fixtureFilterLabel,
  assertOverwritesAllowed, assertGitUsable, OVERWRITE_ALLOWLIST_VAR
} from './lib/overwrite-gate.mjs'

const run = promisify(execFile)

// Every sweep below spends real money — roughly $1 equivalent per call against ~$0.03
// for a prose prompt, so a full 18-call agentic sweep costs about as much as the entire
// 260-call prose sweep. All cheap validation happens up here, before the first paid
// runAgenticTask call.

// One model, pinned: the plan runs the first agentic sweep on claude-fable-5 (see
// docs/superpowers/plans/2026-08-17-agentic-suite.md, "Model"). A second model doubles
// the spend, so adding one must be a deliberate edit here, never an env var.
const AGENTIC_MODEL = 'claude-fable-5'

// Lower than the prose sweep's MAX_TRIALS = 5 because each agentic call costs roughly
// thirty times more: three trials of the full fixture set is already a spend comparable
// to the whole prose sweep.
const MAX_AGENTIC_TRIALS = 3

// The fixture-count analogue of the prose driver's PROMPTS_SHA256 pin: the sweep's cost
// is TRIALS x conditions x THIS, so a fixture added to evals/fixtures/ must not silently
// multiply the spend. Growing the suite is a deliberate act that updates this constant —
// 4 since the hidden-edges adequacy fixture landed. Kept a hand-maintained literal on
// purpose: deriving it from the fixture directory would compare the loader's observation
// with itself and the gate would never fire. The free suite pins this literal against
// loadFixtures() so drift fails `npm test` before it can refuse a paid run.
const EXPECTED_FIXTURES = 4

const TRIALS = Number(process.env.TRIALS ?? 1)
if (!Number.isInteger(TRIALS) || TRIALS < 1) {
  throw new Error(
    `TRIALS must be an integer >= 1, got: ${JSON.stringify(process.env.TRIALS)} (parsed as ${TRIALS})`
  )
}
if (TRIALS > MAX_AGENTIC_TRIALS) {
  throw new Error(
    `TRIALS=${TRIALS} exceeds MAX_AGENTIC_TRIALS=${MAX_AGENTIC_TRIALS}. Each agentic call costs roughly ` +
    'thirty times a prose call, so this ceiling is deliberately lower than the prose sweep\'s. If you ' +
    'genuinely need more, raise the MAX_AGENTIC_TRIALS constant in evals/measure-agentic.mjs.'
  )
}

const RESULTS = new URL('./results/', import.meta.url)

// Gate: every fixture loads and validates. loadFixtures already refuses a manifest
// missing a required field; the checks here are the driver's own preconditions —
// the count pin above, a shape the row schema can carry, and the id alias that
// scheduleSweep keys its rotation on. A fixture whose id were undefined would still
// produce a schedule that "works", with every case keyed to the same undefined slot
// and the condition rotation destroyed.
const fixtures = await loadFixtures()
if (fixtures.length !== EXPECTED_FIXTURES) {
  throw new Error(
    `expected ${EXPECTED_FIXTURES} fixtures under evals/fixtures/ but loaded ${fixtures.length} ` +
    `[${fixtures.map(fixture => fixture.name).join(', ')}]. The sweep's cost is TRIALS x conditions x ` +
    'fixtures, so a changed fixture set must update EXPECTED_FIXTURES deliberately rather than ' +
    'silently changing what a paid run spends and measures.'
  )
}
for (const fixture of fixtures) {
  if (!FIXTURE_SHAPES.includes(fixture.shape)) {
    throw new Error(
      `fixture ${fixture.name} declares shape ${JSON.stringify(fixture.shape)}, not one of ` +
      `[${FIXTURE_SHAPES.join(', ')}]; runAgenticTask would refuse it after money was spent on the schedule`
    )
  }
  if (typeof fixture.id !== 'string' || fixture.id.length === 0 || fixture.id !== fixture.name) {
    throw new Error(
      `fixture ${fixture.name} does not expose id as an alias of name (id: ${JSON.stringify(fixture.id)}); ` +
      'scheduleSweep keys its cases on .id, and an undefined id would silently destroy the condition rotation'
    )
  }
}

// Gate: the FIXTURES filter, validated loudly before anything slower runs. FIXTURES is
// a comma-separated subset of fixture names scoping the sweep — the mechanism that lets
// the adequacy sweep pay for the hidden-edges fixture alone instead of re-running the
// three fixtures whose 18 committed rows are already Component 3 evidence. Unset means
// every fixture, writing exactly the unfiltered filenames, unchanged. When set, the run
// writes filenames suffixed with a label derived from the SORTED filter, so a scoped
// sweep can never collide with the committed unfiltered files. An unknown name must
// fail HERE, before any money: a typo that silently produced an empty or partial sweep
// would spend real dollars measuring the wrong thing.
let sweepFixtures = fixtures
let sweepLabel = null
if (process.env.FIXTURES !== undefined) {
  const requested = [...new Set(
    process.env.FIXTURES.split(',').map(name => name.trim()).filter(name => name.length > 0)
  )]
  if (requested.length === 0) {
    throw new Error(
      `FIXTURES is set (${JSON.stringify(process.env.FIXTURES)}) but names no fixture. Unset it to ` +
      `sweep every fixture, or name at least one of [${fixtures.map(fixture => fixture.name).join(', ')}].`
    )
  }
  const known = new Set(fixtures.map(fixture => fixture.name))
  const unknown = requested.filter(name => !known.has(name))
  if (unknown.length > 0) {
    throw new Error(
      `FIXTURES names unknown fixture(s): [${unknown.join(', ')}]. The committed fixtures are ` +
      `[${fixtures.map(fixture => fixture.name).join(', ')}]. A typo must fail here, loudly, ` +
      'rather than silently produce an empty or partial paid sweep.'
    )
  }
  sweepFixtures = fixtures.filter(fixture => requested.includes(fixture.name))
  sweepLabel = fixtureFilterLabel(requested)
}

// Gate: every fixture THIS SWEEP WILL PAY FOR actually goes green, run for real here —
// not merely covered by the last `npm test` someone ran. The non-exploration fixtures
// must go green under their committed oracle patch; the exploration fixture's committed
// state must already be green (it has no oracle — the model only reads, so its test
// doubles as the fixture-rot canary). A fixture that rotted since the last test run
// would otherwise score taskPassed: false in BOTH arms and waste the whole sweep.
// For the hidden-edges shape the contract is stronger and is verified for real too:
// under oracle.patch BOTH suites must go green, and under naive.patch the visible
// suite must go green while the hidden suite FAILS — if that split has rotted, the
// fixture measures nothing about adequacy and no money may be spent on it. Each check
// runs in a temp copy; the committed fixture is never mutated.
for (const fixture of sweepFixtures) {
  const parent = await mkdtemp(join(tmpdir(), 'bluf-agentic-oracle-'))
  const dir = await copyFixture(fixture.name, parent)
  if (fixture.shape !== 'exploration') {
    await applyOracle(fixture.name, dir)
  }
  const oracleResult = await runFixtureTest(dir)
  if (!oracleResult.passed) {
    throw new Error(
      `fixture ${fixture.name} does not go green ` +
      (fixture.shape === 'exploration' ? 'in its committed state' : 'under its own oracle patch') +
      ` (exit ${oracleResult.exitCode}); a fixture that cannot pass would waste the entire paid sweep.\n` +
      `${oracleResult.stdout}\n${oracleResult.stderr}`
    )
  }
  if (fixture.shape === 'hidden-edges') {
    const hiddenOracle = await runHiddenTest(dir)
    if (!hiddenOracle.passed) {
      throw new Error(
        `fixture ${fixture.name}: the hidden suite does not go green under the oracle patch ` +
        `(exit ${hiddenOracle.exitCode}); a hidden suite even the complete fix cannot pass scores ` +
        `every arm inadequate and measures nothing.\n${hiddenOracle.stdout}\n${hiddenOracle.stderr}`
      )
    }
    // The naive split, in its own fresh copy: applying naive.patch on top of the
    // oracle copy would test a chimera of both patches, not the committed naive fix.
    const naiveParent = await mkdtemp(join(tmpdir(), 'bluf-agentic-naive-'))
    const naiveDir = await copyFixture(fixture.name, naiveParent)
    await applyNaive(fixture.name, naiveDir)
    const naiveVisible = await runFixtureTest(naiveDir)
    if (!naiveVisible.passed) {
      throw new Error(
        `fixture ${fixture.name}: the visible suite does not go green under the naive patch ` +
        `(exit ${naiveVisible.exitCode}); the naive fix must look like a success to taskPassed, ` +
        `or the visible/hidden split proves nothing.\n${naiveVisible.stdout}\n${naiveVisible.stderr}`
      )
    }
    const naiveHidden = await runHiddenTest(naiveDir)
    if (naiveHidden.passed) {
      throw new Error(
        `fixture ${fixture.name}: the hidden suite PASSES under the naive patch. There is no ` +
        'adequacy gap left to detect — a hurried fix and a complete fix score identically — so ' +
        'the fixture measures nothing and the sweep must not spend on it.'
      )
    }
    await rm(naiveParent, { recursive: true, force: true })
  }
  await rm(parent, { recursive: true, force: true })
}

// Gate: never start a sweep that would overwrite committed measurement evidence. Same
// mechanism as evals/measure.mjs, over this driver's planned paths: the per-condition
// row files AND every raw transcript — for an 18-call sweep the transcripts are the
// only durable record of what each paid call actually did. The per-path probe below
// reads a non-zero `git ls-files --error-unmatch` exit as "untracked, safe to write",
// which is only sound once git itself is known to work, so git is probed once up front
// and assertGitUsable refuses to run when the probe fails while a .git directory
// exists at the repository root.
const planned = plannedAgenticSweepFiles({
  model: AGENTIC_MODEL,
  conditions: Object.keys(CONDITIONS),
  fixtures: sweepFixtures.map(fixture => fixture.name),
  trials: TRIALS,
  label: sweepLabel
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

// Gate: the user-level style freshness check, free and READ ONLY — nothing is ever
// written under ~/.claude. The agentic runner installs the project-level style per
// call, but a stale user-level install is how every other sweep in this repo has been
// poisoned, and verifying one file costs nothing against an 18-call spend.
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

// Warm the CLI-version cache before any money is spent. runAgenticTask awaits
// readCliVersion AFTER its paid call returns, so a broken claude binary discovered
// there throws away a row that was already paid for. `claude --version` is free.
await readCliVersion()

// The whole paid loop lives in runAgenticSweep (lib/agentic.mjs), below every gate
// above. Each row is APPENDED to its per-condition file the moment it is produced, so
// a sweep that dies on the last call leaves every already-paid row durable on disk in
// its final location — taskPassed and testExitCode included, never only on stderr.
// Every path the sweep writes interpolates the same agenticRowFile /
// agenticTranscriptFile helpers plannedAgenticSweepFiles enumerated for the gate.
const rows = await runAgenticSweep({
  fixtures: sweepFixtures,
  conditions: Object.keys(CONDITIONS),
  model: AGENTIC_MODEL,
  trials: TRIALS,
  resultsUrl: RESULTS,
  label: sweepLabel,
  log: line => process.stderr.write(line)
})

// No report generation here: Task 5's analysis rules (task success rate first, effect
// against trial spread) are a human decision over the committed rows, not a formatted
// artefact this driver should pre-empt. Summarise what landed and where.
for (const condition of Object.keys(CONDITIONS)) {
  const conditionRows = rows[condition]
  const passed = conditionRows.filter(row => row.taskPassed).length
  console.log(
    `${agenticRowFile(AGENTIC_MODEL, condition, sweepLabel)}: ${conditionRows.length} row(s), ` +
    `taskPassed ${passed}/${conditionRows.length}`
  )
}
