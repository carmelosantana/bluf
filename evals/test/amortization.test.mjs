import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  AMORTIZATION_CASE, CONDITIONS, OVERHEAD_ENVIRONMENT, OVERHEAD_MODEL,
  ENVIRONMENTS, MODELS, loadCases
} from '../lib/runner.mjs'

test('the amortization case exists in the pinned prompt set', async () => {
  const cases = await loadCases()
  assert.ok(
    cases.some(row => row.id === AMORTIZATION_CASE),
    `${AMORTIZATION_CASE} must be one of the pinned prompts`
  )
})

test('the amortization constants name a real environment and model', () => {
  assert.ok(OVERHEAD_ENVIRONMENT in ENVIRONMENTS)
  assert.ok(MODELS.includes(OVERHEAD_MODEL))
})

test('the amortization sweep covers every condition, baseline included', () => {
  // Without a baseline arm there is nothing to subtract the overhead from.
  assert.deepEqual(Object.keys(CONDITIONS).sort(), ['baseline', 'bluf', 'bluf-terse'])
})

test('measure-amortization validates the prompt pin before any paid call', async () => {
  const source = await readFile(new URL('../measure-amortization.mjs', import.meta.url), 'utf8')
  const pinIndex = source.indexOf('PROMPTS_SHA256')
  const callIndex = source.indexOf('runAmortizationPair(')

  assert.ok(pinIndex > -1, 'the entry point must gate on the prompt hash pin')
  assert.ok(callIndex > -1, 'the entry point must actually run the paid pairs')
  assert.ok(
    pinIndex < callIndex,
    'every free validation must sit above the first paid call, matching evals/measure.mjs'
  )
})

test('measure-amortization pins the expected row count and runs the validity check', async () => {
  const source = await readFile(new URL('../measure-amortization.mjs', import.meta.url), 'utf8')

  assert.ok(
    source.includes('assertStyledBelowBaseline('),
    'the driver must run the measured-baseline validity check, not just collect rows'
  )
  assert.ok(
    source.includes('allRows.length !== totalCalls'),
    'the driver must pin the exact expected row count; the validity check cannot know the intended trial count'
  )
  assert.ok(
    source.includes('error?.rows'),
    'a paid row attached to a thrown error must be reported, or the call is wasted unaccountably'
  )
})

test('measure-amortization writes to its own result files and never the main sweep files', async () => {
  const source = await readFile(new URL('../measure-amortization.mjs', import.meta.url), 'utf8')

  assert.ok(source.includes('amortization-'), 'results must go to amortization-prefixed files')
  assert.ok(
    !source.includes('full-'),
    'the amortization slice must never name a main-sweep result file, whose rows are the evidence for published figures'
  )
})
