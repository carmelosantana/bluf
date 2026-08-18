import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadFixtures, copyFixture, runFixtureTest, runHiddenTest, applyOracle, applyPartialOracle, applyNaive, FIXTURE_ROOT } from '../lib/fixtures.mjs'
import { CONTAMINANT_TOOLS } from '../lib/agentic.mjs'

test('every fixture declares the fields the runner needs', async () => {
  const fixtures = await loadFixtures()
  assert.ok(fixtures.length > 0, 'there must be at least one fixture')

  for (const fixture of fixtures) {
    assert.equal(typeof fixture.name, 'string')
    assert.ok(fixture.prompt.length > 0, `${fixture.name} has no prompt`)
    assert.ok(Array.isArray(fixture.allowedTools) && fixture.allowedTools.length > 0,
      `${fixture.name} must scope its tools explicitly`)
    assert.ok(['exploration', 'failing-test', 'multi-file', 'hidden-edges'].includes(fixture.shape),
      `${fixture.name} has an unknown shape: ${fixture.shape}`)
  }
})

test('no fixture allows a contaminant tool', async () => {
  // Skill: one arm loading skill content the other did not would be attributed to the
  // style. Agent and the Task* family: they dispatch or manage subagent work, and
  // output styles do not apply to subagents, so the treatment silently stops applying.
  // buildAgenticArgs filters these out anyway; a fixture naming one is a mistake worth
  // catching at the manifest.
  for (const fixture of await loadFixtures()) {
    for (const tool of CONTAMINANT_TOOLS) {
      assert.ok(!fixture.allowedTools.includes(tool), `${fixture.name} allows ${tool}`)
    }
  }
})

test('loadFixtures rejects a manifest that declares a loader-owned field', async () => {
  // name, dir and id are the loader's to set: a manifest declaring one would shadow
  // the real value (id keys scheduleSweep's condition rotation, so a shadowed id
  // silently destroys the rotation). The spread order makes the loader win anyway —
  // this pins the louder, earlier defence: outright rejection.
  const manifest = {
    shape: 'failing-test',
    prompt: 'fix it',
    testCommand: 'npm',
    testArgs: ['test'],
    allowedTools: ['Read', 'Edit', 'Bash']
  }
  for (const reserved of ['name', 'dir', 'id']) {
    const root = await mkdtemp(join(tmpdir(), 'bluf-fixture-root-'))
    await mkdir(join(root, 'shadowed'))
    await writeFile(
      join(root, 'shadowed', 'fixture.json'),
      JSON.stringify({ ...manifest, [reserved]: 'impostor' })
    )
    await assert.rejects(
      loadFixtures(pathToFileURL(root + '/')),
      new RegExp(`fixture shadowed declares reserved field ${reserved}`),
      `a manifest declaring ${reserved} must be rejected outright`
    )
  }

  // Positive control, so this test cannot pass vacuously against a loader that
  // rejects everything: the same manifest without the impostor field loads, and the
  // loader's own name/dir/id are in place.
  const root = await mkdtemp(join(tmpdir(), 'bluf-fixture-root-'))
  await mkdir(join(root, 'shadowed'))
  await writeFile(join(root, 'shadowed', 'fixture.json'), JSON.stringify(manifest))
  const loaded = await loadFixtures(pathToFileURL(root + '/'))
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].name, 'shadowed')
  assert.equal(loaded[0].id, 'shadowed')
  assert.ok(loaded[0].dir.endsWith('/shadowed/'), `dir must be loader-set, got ${loaded[0].dir}`)
})

test('every fixture starts RED — its test command fails before any fix', async () => {
  for (const fixture of await loadFixtures()) {
    if (fixture.shape === 'exploration') continue
    const dir = await copyFixture(fixture.name, await mkdtemp(join(tmpdir(), 'bluf-fixture-')))
    const result = await runFixtureTest(dir)
    assert.equal(result.passed, false,
      `${fixture.name} passes before its bug is fixed; it cannot measure a fix`)
  }
})

test('every fixture goes GREEN when its committed oracle patch is applied', async () => {
  // The trap this pins: a design probe's fixture used `node --test test/`, which throws
  // MODULE_NOT_FOUND on Node 22, so its test could never pass no matter how correct the fix.
  // Both arms "failed" and the measurement was meaningless. A fixture is unusable until
  // this passes.
  for (const fixture of await loadFixtures()) {
    if (fixture.shape === 'exploration') continue
    const dir = await copyFixture(fixture.name, await mkdtemp(join(tmpdir(), 'bluf-fixture-')))
    await applyOracle(fixture.name, dir)
    const result = await runFixtureTest(dir)
    assert.equal(result.passed, true,
      `${fixture.name} does not go green with its own oracle patch:\n${result.stdout}\n${result.stderr}`)
  }
})

// Node 22 resolves a bare directory after --test as a MODULE and throws MODULE_NOT_FOUND
// — with or without a trailing slash (`node --test test`, `node --test test/`,
// `node --test ./test` all fail). A QUOTED glob is safe: Node's own matcher expands it.
// A concrete .mjs/.cjs/.js file is safe too. Every argument after --test is checked,
// not just the first, so a flag between --test and the directory cannot hide the trap.
// An UNQUOTED glob is rejected too: the shell expands it before Node sees it, so the
// quoted-glob rule is enforced here rather than left as convention.
function hitsNode22DirectoryTrap (command) {
  const flagIndex = command.search(/(?:^|\s)--test(?=\s|$)/)
  if (flagIndex === -1) return false
  const rest = command.slice(command.indexOf('--test', flagIndex) + '--test'.length)
  for (const token of rest.match(/'[^']*'|"[^"]*"|\S+/g) ?? []) {
    if (token.startsWith('-')) continue // another flag; the real target can come later
    const quoted = /^(['"]).*\1$/.test(token)
    const target = quoted ? token.slice(1, -1) : token
    if (/[*?[]/.test(target)) {
      if (quoted) continue // Node's matcher expands a quoted glob; this is the approved form
      return true // an unquoted glob is shell-dependent, not the approved form
    }
    if (/\.[cm]?js$/.test(target)) continue // a concrete test file is safe
    return true // anything else is a bare directory, slash or not
  }
  return false
}

test('the Node 22 trap guard rejects bare directories, slash or not, and allows quoted globs', () => {
  assert.ok(hitsNode22DirectoryTrap('node --test test'), 'a bare directory with no slash is still the trap')
  assert.ok(hitsNode22DirectoryTrap('node --test test/'))
  assert.ok(hitsNode22DirectoryTrap('node --test ./test'))
  assert.ok(hitsNode22DirectoryTrap('node --test --experimental-test-coverage test/'),
    'a flag between --test and the directory must not hide the trap')
  assert.ok(hitsNode22DirectoryTrap('node --test test/*.test.mjs'),
    'an unquoted glob is shell-dependent; only the quoted form is approved')
  assert.ok(!hitsNode22DirectoryTrap("node --test 'test/*.test.mjs'"), 'a quoted glob is the correct form')
})

test('no fixture test command uses the Node 22 directory-as-module trap', async () => {
  for (const fixture of await loadFixtures()) {
    const command = [fixture.testCommand, ...fixture.testArgs].join(' ')
    assert.ok(!hitsNode22DirectoryTrap(command),
      `${fixture.name} runs \`${command}\`; a bare directory after --test fails MODULE_NOT_FOUND on Node 22`)

    // The trap usually hides one level down: `testCommand` is just `npm test`, and the
    // actual `node --test ...` invocation lives in the fixture's package.json test script.
    const pkg = JSON.parse(await readFile(join(fixture.dir, 'package.json'), 'utf8'))
    const script = pkg.scripts?.test ?? ''
    assert.ok(!hitsNode22DirectoryTrap(script),
      `${fixture.name}'s package.json test script is \`${script}\`; a bare directory after --test fails MODULE_NOT_FOUND on Node 22`)

    // The hidden suite is scored on exit code exactly like the visible one, so the
    // same trap would silently turn every hidden run into MODULE_NOT_FOUND — and
    // hiddenPassed: false in both arms would read as an adequacy result while
    // measuring nothing. Check the manifest command and the script it points at.
    if (fixture.hiddenCommand !== undefined) {
      const hidden = [fixture.hiddenCommand, ...fixture.hiddenArgs].join(' ')
      assert.ok(!hitsNode22DirectoryTrap(hidden),
        `${fixture.name}'s hidden command is \`${hidden}\`; a bare directory after --test fails MODULE_NOT_FOUND on Node 22`)
      const hiddenScript = pkg.scripts?.['test:hidden'] ?? ''
      assert.ok(!hitsNode22DirectoryTrap(hiddenScript),
        `${fixture.name}'s package.json test:hidden script is \`${hiddenScript}\`; a bare directory after --test fails MODULE_NOT_FOUND on Node 22`)
    }
  }
})

test('a fixture copy never contains the answer key', async () => {
  // Every committed patch is an answer key — oracle.patch and partial-oracle.patch are
  // the fix, naive.patch is the exact wrong answer the contract measures against — and
  // fixture.json names the success oracle and the hidden suite's command. If any reached
  // the copy, the model could read it and transplant the fix — and the two measured arms
  // would do so at different rates, corrupting the result. naive.patch is the case that
  // motivated widening the filter to every *.patch: it does NOT end in `oracle.patch`,
  // so the old filter would have copied it straight into the model's working tree.
  for (const fixture of await loadFixtures()) {
    const dir = await copyFixture(fixture.name, await mkdtemp(join(tmpdir(), 'bluf-fixture-')))
    const entries = await readdir(dir, { recursive: true })
    for (const entry of entries) {
      const file = basename(entry)
      assert.notEqual(file, 'fixture.json', `${fixture.name} copy leaks fixture.json`)
      assert.ok(!file.endsWith('.patch'), `${fixture.name} copy leaks ${entry}`)
    }
    assert.ok(entries.includes('package.json'), `${fixture.name} copy is missing package.json`)
  }

  // And the exclusion must not over-match: the real source survives the copy — including
  // the hidden TEST FILES, which must reach the copy because they have to run there.
  const dir = await copyFixture('failing-test', await mkdtemp(join(tmpdir(), 'bluf-fixture-')))
  for (const kept of ['src/parse-duration.mjs', 'test/parse-duration.test.mjs', 'package.json']) {
    await readFile(join(dir, kept)) // throws ENOENT if the copy dropped it
  }
  const hiddenDir = await copyFixture('hidden-edges', await mkdtemp(join(tmpdir(), 'bluf-fixture-')))
  for (const kept of ['src/ordinal.mjs', 'test/ordinal.test.mjs', 'test-hidden/ordinal-edges.test.mjs', 'package.json']) {
    await readFile(join(hiddenDir, kept)) // throws ENOENT if the copy dropped it
  }
})

test('a test run that exceeds its timeout is scored as a failure with a numeric-or-null exit code', async () => {
  // 50 ms cannot fit an npm invocation, so the child is killed by the timeout. Limits are
  // options precisely so this test does not take the production 120 s.
  const dir = await copyFixture('failing-test', await mkdtemp(join(tmpdir(), 'bluf-fixture-')))
  const result = await runFixtureTest(dir, { timeout: 50 })
  assert.equal(result.passed, false, 'a timed-out run must never be scored as a pass')
  assert.ok(result.exitCode === null || typeof result.exitCode === 'number',
    `exitCode must be a number or null, got ${typeof result.exitCode}: ${result.exitCode}`)
  assert.match(result.stderr, /killed|SIG/i, 'the timeout kill must be recorded in stderr')
})

test('a test run that overflows maxBuffer is scored as a failure, not a string exit code', async () => {
  const dir = await copyFixture('failing-test', await mkdtemp(join(tmpdir(), 'bluf-fixture-')))
  const result = await runFixtureTest(dir, { maxBuffer: 1 })
  assert.equal(result.passed, false)
  assert.equal(result.exitCode, null,
    'a buffer blowout has no exit code; it must not leak ERR_CHILD_PROCESS_STDIO_MAXBUFFER into exitCode')
  assert.match(result.stderr, /ERR_CHILD_PROCESS_STDIO_MAXBUFFER/,
    'the real failure reason must be recorded in stderr')
})

test('no fixture declares a dependency', async () => {
  for (const fixture of await loadFixtures()) {
    const pkg = JSON.parse(await readFile(join(fixture.dir, 'package.json'), 'utf8'))
    assert.equal(pkg.dependencies, undefined, `${fixture.name} declares dependencies`)
    assert.equal(pkg.devDependencies, undefined, `${fixture.name} declares devDependencies`)
  }
})

test('the fixture set spans all four shapes', async () => {
  const shapes = new Set((await loadFixtures()).map(f => f.shape))
  assert.deepEqual([...shapes].sort(), ['exploration', 'failing-test', 'hidden-edges', 'multi-file'])
})

test('prompts match the register real usage shows', async () => {
  // Median real session-opening prompt is 86 characters. A 300-character invented prompt
  // would measure a different task than users actually give Claude Code.
  for (const fixture of await loadFixtures()) {
    assert.ok(fixture.prompt.length <= 200,
      `${fixture.name}'s prompt is ${fixture.prompt.length} chars; real prompts median 86`)
  }
})

test('a partial fix does not satisfy the multi-file fixture — and fails for the right reason', async () => {
  const dir = await copyFixture('rename-option', await mkdtemp(join(tmpdir(), 'bluf-fixture-')))
  await applyPartialOracle('rename-option', dir)
  const result = await runFixtureTest(dir)
  assert.equal(result.passed, false, 'a partial rename must not pass; otherwise this is not a multi-file task')

  // Failing is not enough. This test once went red because docs/ was missing from the
  // copy and readdir threw ENOENT — not because the rename was partial. Pin the reason:
  // the suite must collect its full set of tests, and the failures must be exactly the
  // assertions covering the un-renamed consumer and the untouched documentation.
  const tap = result.stdout
  assert.match(tap, /^# tests 5$/m,
    `the fixture suite must collect all 5 tests, not die before running them:\n${tap}\n${result.stderr}`)
  assert.match(tap, /^not ok \d+ - the client honours maxRetries/m,
    'the un-renamed consumer must be a named failure')
  assert.match(tap, /^not ok \d+ - docs\/options\.md exists and documents maxRetries, not the old name/m,
    'the untouched documentation must be a named failure')
  assert.match(tap, /^not ok \d+ - no file under src\/ or docs\/ still uses the old option name/m,
    'the cross-file scan must be a named failure')
  assert.match(tap, /^# fail 3$/m,
    `exactly the three multi-file assertions fail, nothing else and for no other reason:\n${tap}`)
})

test('copyFixture produces a byte-identical, independently mutable copy', async () => {
  const dir = await copyFixture('failing-test', await mkdtemp(join(tmpdir(), 'bluf-fixture-')))
  await writeFile(join(dir, 'package.json'), '{}')

  const second = await copyFixture('failing-test', await mkdtemp(join(tmpdir(), 'bluf-fixture-')))
  const pristine = JSON.parse(await readFile(join(second, 'package.json'), 'utf8'))
  assert.ok(pristine.scripts, 'mutating one copy must not affect the source or another copy')

  // Byte-identical means byte-identical: the copied source must match the committed one.
  const committedRoot = fileURLToPath(new URL('failing-test/', FIXTURE_ROOT))
  for (const file of ['src/parse-duration.mjs', 'test/parse-duration.test.mjs', 'package.json']) {
    const committed = await readFile(join(committedRoot, file))
    const copied = await readFile(join(second, file))
    assert.ok(committed.equals(copied), `${file} in the copy differs from the committed fixture`)
  }
})

test('the hidden-edges fixture goes GREEN on BOTH suites under its oracle patch', async () => {
  // The visible half is already covered by the every-fixture green test above; this
  // pins the other half: the committed oracle really is the COMPLETE fix. If the
  // hidden suite failed under the oracle, hiddenPassed could never be true and the
  // adequacy instrument would be unable to distinguish any fix from any other.
  const dir = await copyFixture('hidden-edges', await mkdtemp(join(tmpdir(), 'bluf-fixture-')))
  await applyOracle('hidden-edges', dir)
  const visible = await runFixtureTest(dir)
  assert.equal(visible.passed, true,
    `the oracle must pass the visible suite:\n${visible.stdout}\n${visible.stderr}`)
  const hidden = await runHiddenTest(dir)
  assert.equal(hidden.passed, true,
    `the oracle must pass the hidden suite too:\n${hidden.stdout}\n${hidden.stderr}`)
})

test('the naive fix splits the suites: visible GREEN, hidden RED — the property that makes the fixture measure anything', async () => {
  // THE load-bearing assertion of the hidden-edges shape. If the naive fix passed the
  // hidden suite too, there would be no adequacy gap for the fixture to detect and
  // hiddenPassed would be a constant, not a measurement. Note this test also proves
  // runHiddenTest strips NODE_TEST_CONTEXT: this very process is a `node --test`
  // child, so an un-stripped hidden run would exit 0 despite its failing tests and
  // the RED half below would fail.
  const dir = await copyFixture('hidden-edges', await mkdtemp(join(tmpdir(), 'bluf-fixture-')))
  await applyNaive('hidden-edges', dir)

  const visible = await runFixtureTest(dir)
  assert.equal(visible.passed, true,
    `the naive fix must pass the visible suite — otherwise it is not a plausible fix:\n${visible.stdout}\n${visible.stderr}`)
  // The visible run collects exactly the visible tests: `npm test` must not also run
  // the hidden suite. If the globs overlapped, this run would have failed above — and
  // the count pins it structurally rather than leaving it to luck.
  assert.match(visible.stdout, /^# tests 3$/m,
    `npm test must run the 3 visible tests and nothing else:\n${visible.stdout}`)

  const hidden = await runHiddenTest(dir)
  assert.equal(hidden.passed, false,
    `the naive fix passed the hidden suite; there is no adequacy gap to detect and the fixture measures nothing:\n${hidden.stdout}`)
  // Failing is not enough — pin the reason, as the partial-oracle test does: the
  // failures must be exactly the documented edges the naive fix misses.
  assert.match(hidden.stdout, /^not ok \d+ - numbers ending in 11, 12 or 13 always take th$/m,
    'the teens exception must be a named hidden failure')
  assert.match(hidden.stdout, /^not ok \d+ - a negative integer takes the suffix of its absolute value$/m,
    'the negative-operand case must be a named hidden failure')
  assert.match(hidden.stdout, /^# fail 2$/m,
    `exactly the two documented-edge tests fail, nothing else and for no other reason:\n${hidden.stdout}`)
})

test('runHiddenTest refuses a fixture that has no hidden suite', async () => {
  // A missing hidden suite must never read as a passed or failed one. The function
  // throws; the caller (Task 4's driver) scores hiddenPassed as null.
  const dir = await copyFixture('failing-test', await mkdtemp(join(tmpdir(), 'bluf-fixture-')))
  await assert.rejects(runHiddenTest(dir), /has no hidden suite/)
})

test('a hidden run that exceeds its timeout is scored as a failure with a numeric-or-null exit code', async () => {
  // Same contract as runFixtureTest: 50 ms cannot fit an npm invocation, so the child
  // is killed. A hung hidden suite must score as a failed one, never as an error that
  // leaks a string into exitCode.
  const dir = await copyFixture('hidden-edges', await mkdtemp(join(tmpdir(), 'bluf-fixture-')))
  const result = await runHiddenTest(dir, { timeout: 50 })
  assert.equal(result.passed, false, 'a timed-out hidden run must never be scored as a pass')
  assert.ok(result.exitCode === null || typeof result.exitCode === 'number',
    `exitCode must be a number or null, got ${typeof result.exitCode}: ${result.exitCode}`)
  assert.match(result.stderr, /killed|SIG/i, 'the timeout kill must be recorded in stderr')
})

test('a hidden run that overflows maxBuffer is scored as a failure, not a string exit code', async () => {
  const dir = await copyFixture('hidden-edges', await mkdtemp(join(tmpdir(), 'bluf-fixture-')))
  const result = await runHiddenTest(dir, { maxBuffer: 1 })
  assert.equal(result.passed, false)
  assert.equal(result.exitCode, null,
    'a buffer blowout has no exit code; it must not leak ERR_CHILD_PROCESS_STDIO_MAXBUFFER into exitCode')
  assert.match(result.stderr, /ERR_CHILD_PROCESS_STDIO_MAXBUFFER/,
    'the real failure reason must be recorded in stderr')
})

test('loadFixtures rejects a hidden-suite manifest that is declared by halves or by shape alone', async () => {
  const manifest = {
    shape: 'hidden-edges',
    prompt: 'fix it',
    testCommand: 'npm',
    testArgs: ['test'],
    hiddenCommand: 'npm',
    hiddenArgs: ['run', 'test:hidden'],
    allowedTools: ['Read', 'Edit', 'Bash']
  }

  // One half of the pair without the other: runHiddenTest would only discover the
  // hole at scoring time, after the paid run. Reject at load instead.
  for (const dropped of ['hiddenCommand', 'hiddenArgs']) {
    const root = await mkdtemp(join(tmpdir(), 'bluf-fixture-root-'))
    await mkdir(join(root, 'halved'))
    const halved = { ...manifest }
    delete halved[dropped]
    await writeFile(join(root, 'halved', 'fixture.json'), JSON.stringify(halved))
    await assert.rejects(
      loadFixtures(pathToFileURL(root + '/')),
      /declares only one of hiddenCommand\/hiddenArgs/,
      `a manifest missing ${dropped} but keeping the other half must be rejected`
    )
  }

  // The hidden-edges shape without any hidden suite at all: its whole reason for
  // existing would be silently absent.
  const root = await mkdtemp(join(tmpdir(), 'bluf-fixture-root-'))
  await mkdir(join(root, 'hollow'))
  const hollow = { ...manifest }
  delete hollow.hiddenCommand
  delete hollow.hiddenArgs
  await writeFile(join(root, 'hollow', 'fixture.json'), JSON.stringify(hollow))
  await assert.rejects(
    loadFixtures(pathToFileURL(root + '/')),
    /shape hidden-edges but declares no hiddenCommand\/hiddenArgs/
  )

  // Positive control: the full manifest loads, with the pair intact.
  const okRoot = await mkdtemp(join(tmpdir(), 'bluf-fixture-root-'))
  await mkdir(join(okRoot, 'whole'))
  await writeFile(join(okRoot, 'whole', 'fixture.json'), JSON.stringify(manifest))
  const loaded = await loadFixtures(pathToFileURL(okRoot + '/'))
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].hiddenCommand, 'npm')
  assert.deepEqual(loaded[0].hiddenArgs, ['run', 'test:hidden'])
})
