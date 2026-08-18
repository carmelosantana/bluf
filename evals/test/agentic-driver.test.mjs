import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { plannedAgenticSweepFiles, agenticRowFile, agenticTranscriptFile } from '../lib/overwrite-gate.mjs'
import { loadFixtures } from '../lib/fixtures.mjs'

const run = promisify(execFile)

// Same source-text idiom as measure-driver.test.mjs: the driver is a script with
// top-level paid side effects, so importing it from a test would RUN the sweep.
// Ordering and constants are asserted against the source text instead.
const source = await readFile(new URL('../measure-agentic.mjs', import.meta.url), 'utf8')
const firstPaid = source.indexOf('await runAgenticTask(')

test('the driver contains a paid call to anchor the gate ordering against', () => {
  assert.ok(firstPaid > -1, 'measure-agentic.mjs must call runAgenticTask')
})

test('MAX_AGENTIC_TRIALS is a literal 3, below the prose sweep ceiling', async () => {
  const match = source.match(/const MAX_AGENTIC_TRIALS = (\d+)/)
  assert.ok(match, 'MAX_AGENTIC_TRIALS must be a literal constant so the ceiling is reviewable')
  assert.equal(Number(match[1]), 3)
  // Each agentic call costs roughly thirty times a prose call, so the agentic ceiling
  // must stay strictly below the prose sweep's.
  const proseSource = await readFile(new URL('../measure.mjs', import.meta.url), 'utf8')
  const proseMatch = proseSource.match(/const MAX_TRIALS = (\d+)/)
  assert.ok(proseMatch, 'the prose ceiling must still be a literal to compare against')
  assert.ok(Number(match[1]) < Number(proseMatch[1]),
    'MAX_AGENTIC_TRIALS must be lower than the prose sweep\'s MAX_TRIALS')
})

test('every free gate sits above the first paid call', () => {
  // Gate order per the plan: TRIALS bound, fixture load + validation, fixture-green
  // oracle check, tracked-overwrite gate, user-style freshness, CLI-version warm-up.
  // A gate below the first runAgenticTask would spend money before checking.
  for (const guard of [
    'MAX_AGENTIC_TRIALS',
    'EXPECTED_FIXTURES',
    'loadFixtures()',
    'applyOracle(',
    'runFixtureTest(',
    'assertGitUsable(',
    'assertOverwritesAllowed(',
    'assertUserStyleFresh(',
    'await readCliVersion()'
  ]) {
    const index = source.indexOf(guard)
    assert.ok(index > -1, `${guard} validation must exist`)
    assert.ok(index < firstPaid, `${guard} validation must precede any spending`)
  }
})

test('the fixture-green check runs on a temp copy, never the committed fixture', () => {
  // The oracle gate must copy the fixture before applying the answer key: applying it
  // to the committed tree would leak the answer into every later measured run.
  const oracleGate = source.indexOf('applyOracle(')
  assert.ok(oracleGate > -1)
  const copyIndex = source.lastIndexOf('copyFixture(', oracleGate)
  const tempIndex = source.lastIndexOf('mkdtemp(', oracleGate)
  assert.ok(copyIndex > -1, 'the oracle must be applied to a copyFixture copy')
  assert.ok(tempIndex > -1, 'the copy must live in a temp directory')
  // And a fixture that cannot go green must abort the run, not merely warn.
  assert.ok(/if \(!oracleResult\.passed\) \{\s*\n\s*throw new Error/.test(source),
    'a fixture that fails its oracle check must throw before any spending')
})

test('the TRIALS bound is enforced in source above the first paid call', () => {
  const bound = source.indexOf('TRIALS > MAX_AGENTIC_TRIALS')
  const shape = source.indexOf('!Number.isInteger(TRIALS) || TRIALS < 1')
  assert.ok(bound > -1, 'the driver must compare TRIALS against MAX_AGENTIC_TRIALS')
  assert.ok(shape > -1, 'the driver must refuse a non-integer or sub-1 TRIALS')
  assert.ok(bound < firstPaid && shape < firstPaid, 'both TRIALS checks must precede any spending')
})

test('the driver refuses a trial count above the ceiling, and a malformed one', async () => {
  // Behavioural, not just textual: the TRIALS gate is the first statement after the
  // imports, so running the driver with a bad TRIALS exits before ANY subprocess is
  // spawned — no claude call, no git call, no fixture test. Nothing here can spend.
  const driver = fileURLToPath(new URL('../measure-agentic.mjs', import.meta.url))
  for (const [trials, message] of [
    ['9', /exceeds MAX_AGENTIC_TRIALS=3/],
    ['1.5', /must be an integer >= 1/],
    ['0', /must be an integer >= 1/],
    ['nope', /must be an integer >= 1/]
  ]) {
    await assert.rejects(
      run(process.execPath, [driver], { env: { ...process.env, TRIALS: trials } }),
      error => message.test(error.stderr ?? ''),
      `TRIALS=${trials} must be refused with a message matching ${message}`
    )
  }
})

test('the overwrite gate fails closed when git is unusable', () => {
  // Same fail-closed discipline as measure.mjs: `git ls-files --error-unmatch` exits
  // non-zero for every path when git itself is broken, which would read as "nothing
  // tracked" and fail the gate open. The probe outcome must be judged before any
  // per-path result is trusted.
  const probe = source.indexOf("'rev-parse', '--is-inside-work-tree'")
  assert.ok(probe > -1, 'the driver must probe git usability with rev-parse --is-inside-work-tree')
  const decision = source.indexOf('assertGitUsable(')
  assert.ok(decision > probe, 'the probe outcome must be judged by the pure assertGitUsable decision')
  assert.ok(decision < source.indexOf('assertOverwritesAllowed('),
    'git must be proven usable before the per-path tracked check is trusted')
  assert.ok(source.includes('process.env[OVERWRITE_ALLOWLIST_VAR]'),
    'the escape hatch must be read through the named allowlist variable, never an ad-hoc string')
})

test('the user-level style install is verified free of charge, read-only', () => {
  const check = source.indexOf('assertUserStyleFresh(')
  assert.ok(check > -1, 'the driver must verify the user-level style install')
  assert.ok(check < firstPaid, 'the user-level style check must precede any spending')
  assert.ok(source.includes('homedir()'), 'the user-level path must come from os.homedir, never a hard-coded /home')
  assert.ok(!/writeFile[^\n]*homedir/.test(source) && !/homedir[^\n]*writeFile/.test(source),
    'nothing may be written under the home directory: the check is read-only')
})

test('the planned files are enumerated by the shared pure function the write loop shares', () => {
  // The gate's planned list and the write loop's targets must be the SAME
  // interpolation, or a drifted name waves a doomed file straight past the gate.
  assert.ok(source.includes('plannedAgenticSweepFiles('), 'the planned files must come from the shared enumerator')
  assert.ok(source.includes('agenticRowFile('), 'the row-file write loop must interpolate the shared helper')
  assert.ok(source.includes('agenticTranscriptFile('), 'the transcript path must interpolate the shared helper')
  assert.ok(!/`agentic-\$\{/.test(source),
    'no ad-hoc agentic-* filename template may exist in the driver; the shared helpers are the single point of truth')
})

test('plannedAgenticSweepFiles enumerates exactly the row files and every transcript', () => {
  const files = plannedAgenticSweepFiles({
    model: 'm1',
    conditions: ['a', 'b'],
    fixtures: ['f1', 'f2'],
    trials: 2
  })
  assert.deepEqual(files, [
    agenticRowFile('m1', 'a'),
    agenticRowFile('m1', 'b'),
    agenticTranscriptFile('m1', 'a', 'f1', 1),
    agenticTranscriptFile('m1', 'b', 'f1', 1),
    agenticTranscriptFile('m1', 'a', 'f2', 1),
    agenticTranscriptFile('m1', 'b', 'f2', 1),
    agenticTranscriptFile('m1', 'a', 'f1', 2),
    agenticTranscriptFile('m1', 'b', 'f1', 2),
    agenticTranscriptFile('m1', 'a', 'f2', 2),
    agenticTranscriptFile('m1', 'b', 'f2', 2)
  ])
  assert.deepEqual(
    [agenticRowFile('m1', 'a'), agenticTranscriptFile('m1', 'a', 'f1', 1)],
    ['agentic-m1-a.jsonl', 'agentic-transcripts/m1-a-f1-t1.jsonl'],
    'the concrete filename shapes are what evals/results/ will carry; pin them'
  )
})

test('fixtures expose id as an alias of name, so scheduleSweep can key on .id', async () => {
  // The resolution of the .id/.name mismatch: scheduleSweep keys its cases on .id and
  // fixtures are its cases. Without the alias every schedule entry carries
  // caseId: undefined — the schedule still "works" while the rotation collapses.
  for (const fixture of await loadFixtures()) {
    assert.equal(fixture.id, fixture.name, `${fixture.name} must expose id === name`)
    assert.ok(fixture.id.length > 0)
  }
})

test('transcripts persist under evals/results, and rows record the repo-relative path', () => {
  // transcriptPath defaults to a temp directory inside runAgenticTask, where the raw
  // evidence of a paid call dies with /tmp. The driver must aim it at the committed
  // transcripts directory and rewrite the row's path repo-relative, so committed rows
  // never carry one machine's home directory.
  assert.ok(source.includes("'./agentic-transcripts/'"), 'the transcripts directory must live under evals/results/')
  assert.ok(source.includes('transcriptPath: fileURLToPath('),
    'runAgenticTask must be given a durable transcript path, not left to default to /tmp')
  assert.ok(source.includes('row.transcriptPath = `evals/results/${transcriptName}`'),
    'the persisted row must carry the repo-relative transcript path')
})

test('the driver uses the raw-stdout agentic executor path, never runner.mjs defaultExecute', () => {
  // defaultExecute returns a parsed object; the agentic path needs raw stream-json
  // stdout so the transcript reaches disk before any parsing. runAgenticTask already
  // wires defaultAgenticExecute in; the driver must not override it.
  assert.ok(!source.includes('defaultExecute'), 'measure-agentic.mjs must never touch runner.mjs defaultExecute')
  assert.ok(!source.includes('execute:'), 'the driver must not override runAgenticTask\'s executor')
})

test('the sweep carries the same unpersisted-row accounting as the prose driver', () => {
  // Rows persist per condition after the loop, so a throw mid-sweep must name every
  // paid row that never reached a file — membership in the persisted set, not a count.
  for (const marker of [
    'const persisted = new Set()',
    'allRows.filter(row => !persisted.has(row))',
    'INCOMPLETE SWEEP',
    'row.scheduleVersion = SCHEDULE_VERSION'
  ]) {
    assert.ok(source.includes(marker), `the driver must carry the accounting marker: ${marker}`)
  }
})
