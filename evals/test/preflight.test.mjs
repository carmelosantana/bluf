import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assertStyleChangedInput } from '../preflight.mjs'
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

test('assertStyleChangedInput refuses a vacuous comparison', () => {
  // NaN < minOverhead is false, so without an explicit finite check a row missing
  // inputTokens passes the floor comparison and green-lights a sweep on an unmeasured arm.
  // Every sibling guard in runner.mjs rejects vacuous input for the same reason.
  assert.throws(() => assertStyleChangedInput({}, {}), /refusing to compare/)
  assert.throws(() => assertStyleChangedInput(row(3593), {}), /refusing to compare/)
  assert.throws(() => assertStyleChangedInput({}, row(5624)), /refusing to compare/)
})
