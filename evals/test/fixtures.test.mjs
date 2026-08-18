import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadFixtures, copyFixture, runFixtureTest, applyOracle, FIXTURE_ROOT } from '../lib/fixtures.mjs'

test('every fixture declares the fields the runner needs', async () => {
  const fixtures = await loadFixtures()
  assert.ok(fixtures.length > 0, 'there must be at least one fixture')

  for (const fixture of fixtures) {
    assert.equal(typeof fixture.name, 'string')
    assert.ok(fixture.prompt.length > 0, `${fixture.name} has no prompt`)
    assert.ok(Array.isArray(fixture.allowedTools) && fixture.allowedTools.length > 0,
      `${fixture.name} must scope its tools explicitly`)
    assert.ok(['exploration', 'failing-test', 'multi-file'].includes(fixture.shape),
      `${fixture.name} has an unknown shape: ${fixture.shape}`)
  }
})

test('no fixture allows the Skill or Agent tool', async () => {
  // Skill: one arm loading skill content the other did not would be attributed to the style.
  // Agent: output styles do not apply to subagents, so the treatment silently stops applying.
  for (const fixture of await loadFixtures()) {
    assert.ok(!fixture.allowedTools.includes('Skill'), `${fixture.name} allows Skill`)
    assert.ok(!fixture.allowedTools.includes('Agent'), `${fixture.name} allows Agent`)
  }
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

test('no fixture test command uses the Node 22 directory-as-module trap', async () => {
  for (const fixture of await loadFixtures()) {
    const command = [fixture.testCommand, ...fixture.testArgs].join(' ')
    assert.doesNotMatch(command, /--test\s+\S*\/(\s|$)/,
      `${fixture.name} runs \`${command}\`; a bare directory after --test fails MODULE_NOT_FOUND on Node 22`)

    // The trap usually hides one level down: `testCommand` is just `npm test`, and the
    // actual `node --test ...` invocation lives in the fixture's package.json test script.
    const pkg = JSON.parse(await readFile(join(fixture.dir, 'package.json'), 'utf8'))
    const script = pkg.scripts?.test ?? ''
    assert.doesNotMatch(script, /--test\s+['"]?\S*\/['"]?(\s|$)/,
      `${fixture.name}'s package.json test script is \`${script}\`; a bare directory after --test fails MODULE_NOT_FOUND on Node 22`)
  }
})

test('a fixture copy never contains the answer key', async () => {
  // oracle.patch (and any *-oracle.patch) IS the fix; fixture.json names the success
  // oracle. If either reached the copy, the model could read it and transplant the exact
  // fix — and the two measured arms would do so at different rates, corrupting the result.
  for (const fixture of await loadFixtures()) {
    const dir = await copyFixture(fixture.name, await mkdtemp(join(tmpdir(), 'bluf-fixture-')))
    const entries = await readdir(dir, { recursive: true })
    for (const entry of entries) {
      const file = basename(entry)
      assert.notEqual(file, 'fixture.json', `${fixture.name} copy leaks fixture.json`)
      assert.ok(!file.endsWith('oracle.patch'), `${fixture.name} copy leaks ${entry}`)
    }
    assert.ok(entries.includes('package.json'), `${fixture.name} copy is missing package.json`)
  }

  // And the exclusion must not over-match: the real source survives the copy.
  const dir = await copyFixture('failing-test', await mkdtemp(join(tmpdir(), 'bluf-fixture-')))
  for (const kept of ['src/parse-duration.mjs', 'test/parse-duration.test.mjs', 'package.json']) {
    await readFile(join(dir, kept)) // throws ENOENT if the copy dropped it
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
