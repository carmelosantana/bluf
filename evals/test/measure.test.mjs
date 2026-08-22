import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Source-scan tests for the main paid driver, evals/measure.mjs, matching the pattern
// amortization.test.mjs uses for its sibling. The driver cannot be executed in a test —
// it spends real money — so these assert the structural properties that keep a failure
// from discarding paid rows. They are about error reporting ONLY: nothing here may
// require a change to measurement logic, ordering, or output format.

test('measure.mjs protects every paid call and dumps unpersisted rows on failure', async () => {
  const source = await readFile(new URL('../measure.mjs', import.meta.url), 'utf8')

  // Anchor on the paid region: the try that most closely precedes the first paid
  // call, and the catch after it.
  const firstPaidIndex = source.indexOf('await runCase(')
  assert.ok(firstPaidIndex > -1, 'the driver must actually run paid cases')
  const tryIndex = source.lastIndexOf('try {', firstPaidIndex)
  const catchIndex = source.indexOf('catch (error)', firstPaidIndex)
  assert.ok(
    tryIndex > -1 && tryIndex < firstPaidIndex,
    'every paid runCase call must sit inside a protected region: a strict parseUsage throw on one ' +
    'malformed payload late in a model loop would otherwise discard up to 72 paid calls with a bare ' +
    'stack trace, because rows are only written after the loop completes'
  )
  assert.ok(
    catchIndex > firstPaidIndex,
    'the catch must cover the paid calls'
  )
  assert.ok(
    source.includes('paid rows collected but not written'),
    'the catch path must report the rows already collected and not yet persisted; an unreported paid ' +
    'row is a wasted call nobody can account for — measure-amortization.mjs already does this'
  )
  assert.ok(
    source.indexOf('throw error', catchIndex) > -1,
    'the original failure is the diagnosis and must be rethrown unchanged, not swallowed'
  )
})

test('measure.mjs keeps its result writes inside the protected region', async () => {
  const source = await readFile(new URL('../measure.mjs', import.meta.url), 'utf8')

  const firstPaidIndex = source.indexOf('await runCase(')
  const tryIndex = source.lastIndexOf('try {', firstPaidIndex)
  const catchIndex = source.indexOf('catch (error)', firstPaidIndex)
  const lastResultWrite = source.lastIndexOf('.jsonl`, RESULTS)')
  assert.ok(lastResultWrite > -1, 'the driver must write per-condition result files')
  assert.ok(
    tryIndex < lastResultWrite && lastResultWrite < catchIndex,
    'a write failure after paid calls must still dump the rows that were bought, so every ' +
    'result-file write belongs inside the protected region'
  )
})

test('a mid-sweep failure names the partial result files it leaves on disk', async () => {
  const source = await readFile(new URL('../measure.mjs', import.meta.url), 'utf8')

  const catchIndex = source.indexOf('catch (error)', source.indexOf('await runCase('))
  const warningIndex = source.indexOf('INCOMPLETE SWEEP')
  assert.ok(
    warningIndex > catchIndex,
    'a throw mid-sweep can leave earlier models\' files on disk, each internally complete-looking; ' +
    'the operator must be told in words that they are not a finished measurement'
  )
  assert.ok(
    source.includes('finished measurement'),
    'the warning must tell the operator the files on disk must not be read as a finished measurement'
  )
})

test('the incomplete-sweep warning does not call complete result files partial', async () => {
  const source = await readFile(new URL('../measure.mjs', import.meta.url), 'utf8')

  // If all expected result files were written and only a post-payment check or report
  // generation failed, "they cover only part of the intended sweep" is false and would
  // mislead an operator into discarding good rows. The catch must distinguish the two
  // cases, and "all expected" must derive from the same plannedSweepFiles enumeration
  // the write loops' constants feed — never a hard-coded count.
  assert.ok(
    source.includes("planned.filter(name => name !== 'report.md')"),
    'the expected-file count must be derived from the shared plannedSweepFiles enumeration'
  )
  assert.ok(
    source.includes('AFTER writing all '),
    'the all-files-written case must be reported as complete files with a failed later step'
  )
  assert.ok(
    source.includes('report.md was not'),
    'the all-files-written case must say the report is what is missing'
  )
})
