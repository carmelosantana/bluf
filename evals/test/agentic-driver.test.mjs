import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { plannedAgenticSweepFiles, agenticRowFile, agenticTranscriptFile, fixtureFilterLabel } from '../lib/overwrite-gate.mjs'
import { loadFixtures } from '../lib/fixtures.mjs'

const run = promisify(execFile)

// Same source-text idiom as measure-driver.test.mjs: the driver is a script with
// top-level paid side effects, so importing it from a test would RUN the sweep.
// Ordering and constants are asserted against the source text instead. The paid
// loop itself lives in lib/agentic.mjs (runAgenticSweep) so its durability is
// exercised behaviourally in agentic.test.mjs; the driver's single call to it is
// the paid anchor every free gate must precede.
const source = await readFile(new URL('../measure-agentic.mjs', import.meta.url), 'utf8')
const libSource = await readFile(new URL('../lib/agentic.mjs', import.meta.url), 'utf8')
const firstPaid = source.indexOf('await runAgenticSweep(')

test('the driver contains a paid call to anchor the gate ordering against', () => {
  assert.ok(firstPaid > -1, 'measure-agentic.mjs must call runAgenticSweep')
  assert.equal(source.indexOf('await runAgenticSweep('), source.lastIndexOf('await runAgenticSweep('),
    'exactly one paid sweep call: a second one could sit below no gate at all')
  // And the sweep function's own loop is where runAgenticTask gets called — the
  // driver must not carry a second, gate-free paid loop of its own.
  assert.ok(libSource.includes('runTask = runAgenticTask'),
    'runAgenticSweep must default to the real paid runner')
  assert.ok(!source.includes('runAgenticTask('), 'the driver itself must never call runAgenticTask directly')
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
    'process.env.FIXTURES',
    'fixtureFilterLabel(',
    'applyOracle(',
    'runFixtureTest(',
    'applyNaive(',
    'runHiddenTest(',
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
  // The write loop now lives in lib/agentic.mjs (runAgenticSweep), so the helpers
  // are asserted there; the driver still gates on the shared enumerator.
  assert.ok(source.includes('plannedAgenticSweepFiles('), 'the planned files must come from the shared enumerator')
  assert.ok(libSource.includes('agenticRowFile('), 'the row-file write loop must interpolate the shared helper')
  assert.ok(libSource.includes('agenticTranscriptFile('), 'the transcript path must interpolate the shared helper')
  for (const text of [source, libSource]) {
    assert.ok(!/`agentic-\$\{/.test(text),
      'no ad-hoc agentic-* filename template may exist; the shared helpers are the single point of truth')
  }
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

test('EXPECTED_FIXTURES is a literal that matches the committed fixture suite', async () => {
  // The hand-maintained literal stands (deriving it from the same directory the
  // loader reads would make the gate compare an observation with itself), but this
  // test is the free-suite alarm: a fixture added or removed without updating the
  // constant fails `npm test` here, not one gate-refusal into a paid run.
  const match = source.match(/const EXPECTED_FIXTURES = (\d+)/)
  assert.ok(match, 'EXPECTED_FIXTURES must stay a reviewable literal so growing the spend is a deliberate edit')
  assert.equal(Number(match[1]), 4, 'the committed suite is four fixtures, hidden-edges included')
  assert.equal(Number(match[1]), (await loadFixtures()).length,
    'the literal must track the committed fixture set; update both in the same change')
})

test('the driver refuses an unknown or empty FIXTURES filter, loudly, before anything is spent', async () => {
  // Behavioural, like the TRIALS tests: each of these values makes the driver throw
  // at the filter-validation gate — after the free fixture load, before the oracle
  // checks, the overwrite gate, and any claude spawn. A typo must never silently
  // produce an empty or partial paid sweep.
  const driver = fileURLToPath(new URL('../measure-agentic.mjs', import.meta.url))
  for (const [value, message] of [
    ['no-such-fixture', /unknown fixture/],
    ['hidden-edges,no-such-fixture', /no-such-fixture/],
    ['hidden-edgse', /hidden-edgse/],
    ['', /names no fixture/],
    [' , ', /names no fixture/]
  ]) {
    await assert.rejects(
      run(process.execPath, [driver], { env: { ...process.env, TRIALS: '1', FIXTURES: value } }),
      error => message.test(error.stderr ?? ''),
      `FIXTURES=${JSON.stringify(value)} must be refused with a message matching ${message}`
    )
  }
})

test('the fixture filter derives its label from the shared pure function, in gate and sweep alike', () => {
  // The label must reach BOTH the gate's enumeration and the paid sweep's write loop
  // as the same value, or a filtered run's gate would judge different filenames than
  // the loop writes — the drift the shared helpers exist to make impossible.
  assert.ok(source.includes('fixtureFilterLabel('), 'the driver must derive the label from the shared helper')
  const labelled = source.split('label: sweepLabel').length - 1
  assert.ok(labelled >= 2,
    'both plannedAgenticSweepFiles and runAgenticSweep must be handed the same sweepLabel')
  // And the summary loop reports the labelled filenames, not the unfiltered ones.
  assert.ok(source.includes('agenticRowFile(AGENTIC_MODEL, condition, sweepLabel)'),
    'the end-of-run summary must name the files this run actually wrote')
})

test('fixtureFilterLabel is deterministic, sorted, and refuses names unsafe for a filename', () => {
  assert.equal(fixtureFilterLabel(['hidden-edges']), 'hidden-edges')
  assert.equal(fixtureFilterLabel(['rename-option', 'hidden-edges']), 'hidden-edges+rename-option')
  assert.equal(fixtureFilterLabel(['hidden-edges', 'rename-option']), 'hidden-edges+rename-option',
    'the order the operator typed must not change which files a run writes')
  assert.throws(() => fixtureFilterLabel([]), /non-empty/)
  assert.throws(() => fixtureFilterLabel(['bad/name']), /filesystem-safe/)
  assert.throws(() => fixtureFilterLabel(['../escape']), /filesystem-safe/)
})

test('a labelled run plans label-suffixed filenames, disjoint from the unfiltered ones', () => {
  const labelled = plannedAgenticSweepFiles({
    model: 'm1', conditions: ['a', 'b'], fixtures: ['f1'], trials: 1, label: 'f1'
  })
  assert.deepEqual(labelled, [
    'agentic-m1-a-f1.jsonl',
    'agentic-m1-b-f1.jsonl',
    'agentic-transcripts/m1-a-f1-f1-t1.jsonl',
    'agentic-transcripts/m1-b-f1-f1-t1.jsonl'
  ], 'the concrete labelled filename shapes are what a scoped run will commit; pin them')
  const unfiltered = new Set(plannedAgenticSweepFiles({
    model: 'm1', conditions: ['a', 'b'], fixtures: ['f1'], trials: 1
  }))
  for (const file of labelled) {
    assert.ok(!unfiltered.has(file), `${file} must never collide with an unfiltered path`)
  }
  // No label (and an explicit null) keeps the committed unfiltered names byte-identical.
  assert.equal(agenticRowFile('m1', 'a', null), 'agentic-m1-a.jsonl')
  assert.equal(agenticTranscriptFile('m1', 'a', 'f1', 1, null), 'agentic-transcripts/m1-a-f1-t1.jsonl')
  // An empty-string label is refused: it would silently produce the unfiltered names.
  assert.throws(() => agenticRowFile('m1', 'a', ''), /label/)
  assert.throws(() => agenticTranscriptFile('m1', 'a', 'f1', 1, ''), /label/)
})

test('the pre-spend gate proves the hidden-edges split for real, above the paid call', () => {
  // Gate 3's extension: under the oracle BOTH suites must go green, and under the
  // naive patch the visible suite must go green while the hidden suite FAILS. If
  // that split has rotted the fixture measures nothing, and the sweep must refuse
  // before any money moves.
  for (const marker of [
    'if (!hiddenOracle.passed)',
    'if (!naiveVisible.passed)',
    'if (naiveHidden.passed)'
  ]) {
    const index = source.indexOf(marker)
    assert.ok(index > -1, `the driver must gate on: ${marker}`)
    assert.ok(index < firstPaid, `${marker} must precede any spending`)
  }
  // The naive split runs in its own fresh copy: applying naive on top of the oracle
  // copy would test a chimera patch state, not the committed naive fix.
  const naiveApply = source.indexOf('applyNaive(')
  const naiveCopy = source.lastIndexOf('copyFixture(', naiveApply)
  assert.ok(naiveCopy > source.indexOf('applyOracle('),
    'the naive check needs a second copyFixture call, after the oracle copy was made')
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
  // evidence of a paid call dies with /tmp. The sweep must aim it at the committed
  // transcripts directory and rewrite the row's path repo-relative, so committed rows
  // never carry one machine's home directory — and the driver must point the sweep at
  // the real results directory.
  assert.ok(source.includes('resultsUrl: RESULTS'), 'the driver must aim the sweep at evals/results/')
  assert.ok(libSource.includes("'./agentic-transcripts/'"), 'the transcripts directory must live under the results directory')
  assert.ok(libSource.includes('transcriptPath: fileURLToPath('),
    'runAgenticTask must be given a durable transcript path, not left to default to /tmp')
  assert.ok(libSource.includes('row.transcriptPath = `evals/results/${transcriptName}`'),
    'the persisted row must carry the repo-relative transcript path')
})

test('the driver uses the raw-stdout agentic executor path, never runner.mjs defaultExecute', () => {
  // defaultExecute returns a parsed object; the agentic path needs raw stream-json
  // stdout so the transcript reaches disk before any parsing. runAgenticTask already
  // wires defaultAgenticExecute in; the driver must not override the executor, and it
  // must not swap the sweep's real paid runner for a stub either — injected runners
  // exist for the test suite, never for a measured run.
  assert.ok(!source.includes('defaultExecute'), 'measure-agentic.mjs must never touch runner.mjs defaultExecute')
  assert.ok(!source.includes('execute:'), 'the driver must not override runAgenticTask\'s executor')
  assert.ok(!source.includes('runTask'), 'the driver must not override runAgenticSweep\'s paid runner')
})

test('paid rows are appended durably as they are produced, never held for an end-of-loop write', () => {
  // The reviewer's traced failure: rows persisted only after the whole loop, so a
  // parser throw on call 18 of 18 dumped 17 already-paid rows to stderr — taskPassed
  // and testExitCode died with the terminal scrollback. The sweep must append each
  // row to its final per-condition file the moment it exists, truncate those files
  // up front so a rerun never doubles rows, and keep the stderr accounting only as
  // the last-resort net for a row whose own append failed. The behavioural proof —
  // an execute stub that succeeds then throws, earlier rows readable from disk —
  // lives in agentic.test.mjs; these markers pin the mechanism in the source.
  for (const marker of [
    'await appendFile(',
    "await writeFile(rowFiles[condition], '')",
    'const persisted = new Set()',
    'allRows.filter(row => !persisted.has(row))',
    'INCOMPLETE SWEEP',
    'row.scheduleVersion = SCHEDULE_VERSION'
  ]) {
    assert.ok(libSource.includes(marker), `runAgenticSweep must carry the durability marker: ${marker}`)
  }
  // Append order: the row reaches disk before it is counted as persisted, and the
  // append happens inside the loop, before the next paid call can start.
  const append = libSource.indexOf('await appendFile(')
  assert.ok(append > libSource.indexOf('await runTask('), 'the append belongs to the row just paid for')
  assert.ok(append < libSource.indexOf('persisted.add(row)'), 'a row is only "persisted" once its append returned')
})
