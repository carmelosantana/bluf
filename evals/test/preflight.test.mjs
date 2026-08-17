import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertStyleChangedInput, isMainEntry } from '../preflight.mjs'
import { MIN_STYLE_OVERHEAD_TOKENS } from '../lib/runner.mjs'

const row = (inputTokens, outputTokens = 5) => ({ inputTokens, outputTokens })

test('assertStyleChangedInput accepts a real measured overhead', () => {
  // Observed during design in a clean room: Default 3,593 input, BLUF 5,624.
  assert.equal(assertStyleChangedInput(row(3593, 266), row(5624, 5)), undefined)
})

test('assertStyleChangedInput rejects the silent Default-against-Default signature', () => {
  // Also observed during design: --setting-sources project WITHOUT a project-level style
  // gave Default 3,589 and "BLUF" 3,591 — a 2-token difference and near-identical output.
  assert.throws(() => assertStyleChangedInput(row(3589, 318), row(3591, 316)), /only 2 tokens more/)
  assert.throws(() => assertStyleChangedInput(row(3589, 318), row(3591, 316)), /Default against Default/)
})

test('assertStyleChangedInput rejects a styled call with less input than baseline', () => {
  assert.throws(() => assertStyleChangedInput(row(5000), row(4000)), /-1000 tokens/)
})

test('assertStyleChangedInput uses the shared minimum overhead constant', () => {
  const justUnder = 3593 + MIN_STYLE_OVERHEAD_TOKENS - 1
  const justOver = 3593 + MIN_STYLE_OVERHEAD_TOKENS

  assert.throws(() => assertStyleChangedInput(row(3593), row(justUnder)))
  assert.equal(assertStyleChangedInput(row(3593), row(justOver)), undefined)
})

test('preflight validates the style install above its first paid call', async () => {
  const source = await readFile(new URL('../preflight.mjs', import.meta.url), 'utf8')
  const guard = source.indexOf('assertProjectStyleInstalled(')
  const spend = source.indexOf('defaultExecute(')

  assert.ok(guard > -1, 'preflight must assert the style is installed')
  assert.ok(spend > -1, 'preflight must actually make the paid calls')
  assert.ok(guard < spend, 'the free check must sit above the first paid call, as evals/measure.mjs does')
})

test('the main-module guard matches a path containing a space', async () => {
  // The guard once compared import.meta.url (percent-encoded) against process.argv[1]
  // (a raw filesystem path), so a clone under a directory like "My Projects" made
  // `npm run preflight` exit 0 with no output — a vacuous pass in the one file whose
  // job is preventing one. Reproduce the shape for real rather than asserting source
  // text: put a copy of preflight.mjs at a spaced path, import it, and check its own
  // guard predicate against that raw path. Nothing here spends — importing the module
  // runs no paid code unless the guard itself matches this process's argv[1], which is
  // the test runner.
  const dir = await mkdtemp(join(tmpdir(), 'bluf spaced preflight-'))
  try {
    const evalsDir = fileURLToPath(new URL('..', import.meta.url))
    // The copy's `./lib/runner.mjs` import must still resolve from the spaced directory.
    await symlink(join(evalsDir, 'lib'), join(dir, 'lib'))
    const spacedEntry = join(dir, 'preflight.mjs')
    await copyFile(join(evalsDir, 'preflight.mjs'), spacedEntry)

    const spaced = await import(pathToFileURL(spacedEntry).href)
    assert.equal(spaced.isMainEntry(spacedEntry), true,
      'the guard must recognise its own file when the path contains a space')
    assert.equal(spaced.isMainEntry(join(dir, 'other.mjs')), false,
      'the guard must not match a different entry path')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('importing preflight as a module never fires the main-module guard', () => {
  // In this process argv[1] is the test runner, not preflight.mjs, so the guard must be
  // false — the property that keeps npm test free of API calls.
  assert.equal(isMainEntry(), false)
})

test('assertStyleChangedInput refuses a vacuous comparison', () => {
  // NaN < minOverhead is false, so without an explicit finite check a row missing
  // inputTokens passes the floor comparison and green-lights a sweep on an unmeasured arm.
  // Every sibling guard in runner.mjs rejects vacuous input for the same reason.
  assert.throws(() => assertStyleChangedInput({}, {}), /refusing to compare/)
  assert.throws(() => assertStyleChangedInput(row(3593), {}), /refusing to compare/)
  assert.throws(() => assertStyleChangedInput({}, row(5624)), /refusing to compare/)
})
