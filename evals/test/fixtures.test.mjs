import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadFixtures, copyFixture, runFixtureTest, applyOracle, applyPartialOracle, FIXTURE_ROOT } from '../lib/fixtures.mjs'

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

test('the fixture set spans all three shapes', async () => {
  const shapes = new Set((await loadFixtures()).map(f => f.shape))
  assert.deepEqual([...shapes].sort(), ['exploration', 'failing-test', 'multi-file'])
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
