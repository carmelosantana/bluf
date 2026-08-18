import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadFixtures, copyFixture, runFixtureTest, applyOracle } from '../lib/fixtures.mjs'

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
  }
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
})
