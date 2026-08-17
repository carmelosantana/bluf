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
    source.includes('assertStyleOverheadPresent('),
    'the driver must run the input-side style-presence check, not just collect rows'
  )
  assert.ok(
    !source.includes('assertStyledBelowBaseline'),
    'the driver must NOT compare turn-2 output medians: turn 2 re-asks an answered question, so its ' +
    'output length is noise — the paid run measured baseline turn 2 at 15/207/174 and a VALID styled ' +
    'turn 2 at 162, which that check would abort as a false positive'
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

test('measure-amortization checks the input tier of turn 2 after the money is spent', async () => {
  const source = await readFile(new URL('../measure-amortization.mjs', import.meta.url), 'utf8')

  const cacheCheckIndex = source.indexOf('assertTurn2ReadFromCache(')
  assert.ok(
    cacheCheckIndex > -1,
    'the driver must verify turn 2 actually read from the cache; every other guard is output-token only, ' +
    'and a --resume that silently forks a fresh session passes all of them with meaningless figures'
  )
  assert.ok(
    cacheCheckIndex > source.indexOf('allRows.length !== totalCalls'),
    'the cache-read check belongs with the post-run validity checks, after the row-count pin'
  )
  assert.ok(
    source.includes('assertStyleOverheadPresent('),
    'the cache-read check complements the input-side style-presence check; both must run'
  )
})

test('measure-amortization pairs each turn 2 against its turn 1 to catch a forked resume', async () => {
  const source = await readFile(new URL('../measure-amortization.mjs', import.meta.url), 'utf8')

  const carriedIndex = source.indexOf('assertTurn2CarriedTurn1(')
  assert.ok(
    carriedIndex > -1,
    'the driver must verify each turn 2 carried its turn 1 exchange; a forked --resume re-sends a ' +
    'byte-identical prefix that the cache-read check accepts, and only the input-growth comparison catches it'
  )
  assert.ok(
    carriedIndex > source.indexOf('allRows.length !== totalCalls'),
    'the input-growth check belongs with the post-run validity checks, after the row-count pin'
  )
})

test('a validity failure names the complete-looking files it leaves on disk', async () => {
  const source = await readFile(new URL('../measure-amortization.mjs', import.meta.url), 'utf8')

  const invalidIndex = source.indexOf('INVALID SLICE')
  const cacheCheckIndex = source.indexOf('assertTurn2ReadFromCache(allRows)')
  const styledCheckIndex = source.indexOf('assertStyleOverheadPresent(allRows)')
  assert.ok(cacheCheckIndex > -1 && styledCheckIndex > -1, 'both validity checks must run')
  assert.ok(
    invalidIndex > -1,
    'a validity failure leaves all result files on disk with a full row count and nothing marking them ' +
    'invalid; the operator must be told the files exist and must not be read as a measurement'
  )
  assert.ok(
    invalidIndex > cacheCheckIndex && invalidIndex > styledCheckIndex,
    'the warning must live on the failure path of the validity checks themselves'
  )
  assert.ok(
    source.indexOf('writtenFiles.map', invalidIndex) > -1 || source.lastIndexOf('writtenFiles.map') > styledCheckIndex,
    'the warning must name the files by pathname, not gesture at them'
  )
  assert.ok(
    source.indexOf('throw error', invalidIndex) > -1,
    'the original assertion message is the diagnosis and must be rethrown unchanged, not swallowed or replaced'
  )
})

test('measure-amortization warns about the incomplete slice on the path where partial files happen', async () => {
  const source = await readFile(new URL('../measure-amortization.mjs', import.meta.url), 'utf8')

  const catchIndex = source.indexOf('catch (error)')
  assert.ok(catchIndex > -1, 'the paid loop must have an error path')
  const warningIndex = source.indexOf('INCOMPLETE SLICE')
  assert.ok(
    warningIndex > catchIndex,
    'the partial-slice warning must live on the catch path — the only path where partial result files ' +
    'actually occur; a throw mid-loop leaves complete-looking files on disk with nothing marking them partial'
  )
  assert.ok(
    source.includes('finished measurement'),
    'the warning must tell the operator the files on disk must not be read as a finished measurement'
  )
})

test('measure-amortization protects every paid call, not just the pair runner', async () => {
  const source = await readFile(new URL('../measure-amortization.mjs', import.meta.url), 'utf8')

  const tryIndex = source.indexOf('try {')
  const writeIndex = source.indexOf('await writeFile(')
  const catchIndex = source.indexOf('catch (error)')
  assert.ok(tryIndex > -1 && writeIndex > -1 && catchIndex > -1)
  assert.ok(
    tryIndex < writeIndex && writeIndex < catchIndex,
    'writeFile must sit inside the protected region: a write failure after paid calls must still ' +
    'dump the rows that were bought'
  )
})

test('measure-amortization clears its own stale result files before the first paid call', async () => {
  const source = await readFile(new URL('../measure-amortization.mjs', import.meta.url), 'utf8')

  const rmIndex = source.indexOf('await rm(')
  const firstPaidIndex = source.indexOf('runAmortizationPair(', source.indexOf('loadCases'))
  const hashPinIndex = source.indexOf('PROMPTS_SHA256')
  assert.ok(
    rmIndex > -1,
    'the driver must delete the amortization files it is about to write; a stale file from an earlier ' +
    'run with a different trial count would otherwise mix vintages in one slice'
  )
  assert.ok(
    rmIndex > hashPinIndex,
    'the free gates must all run before any file is touched; an aborted gate must leave prior results intact'
  )
  assert.ok(
    rmIndex < firstPaidIndex,
    'clearing must happen before the first paid call, so an aborted run can never leave a mixed-vintage slice'
  )
  assert.ok(
    source.includes('force: true'),
    'clearing must tolerate the files not existing; a fresh checkout has none'
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
