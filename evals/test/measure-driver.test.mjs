import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../measure.mjs', import.meta.url), 'utf8')

test('MAX_TRIALS allows the five trials the clean environment needs', () => {
  const match = source.match(/const MAX_TRIALS = (\d+)/)
  assert.ok(match, 'MAX_TRIALS must be a literal constant so the ceiling is reviewable')
  assert.equal(Number(match[1]), 5)
})

test('the sweep verifies the style reached the model after paying for it', () => {
  // The structural guard in runCase proves the style file is on disk. It cannot prove the
  // CLI loaded it. Without a post-payment check, a clean sweep whose style failed to load
  // writes 240 Default-against-Default rows and reports success.
  assert.ok(source.includes('assertStyleOverheadPresent('), 'measure.mjs must verify the style applied')
})

test('the style check runs per case, never across the mixed sweep', () => {
  // assertStyleOverheadPresent refuses rows that mix caseIds — deliberately, because a
  // baseline from a different prompt would make the overhead measure the prompt mix
  // rather than the style. A whole-sweep call would therefore throw only AFTER an
  // entire model's sweep had been paid for. The call must sit inside a loop over the
  // cases, with the rows filtered down to the one case under check.
  const callIndex = source.indexOf('assertStyleOverheadPresent(')
  assert.ok(callIndex > -1, 'measure.mjs must call the style check')
  const loopIndex = source.lastIndexOf('for (const caseRow of cases)', callIndex)
  assert.ok(loopIndex > -1, 'the style check must be called once per case, inside a loop over the cases')
  assert.ok(
    source.includes('row.caseId === caseRow.id'),
    'the rows passed to the style check must be filtered to the single case under check'
  )
})

test('every free validation still sits above the first paid call', () => {
  const firstPaid = source.indexOf('await runCase(')
  assert.ok(firstPaid > -1)

  for (const guard of ['PROMPTS_SHA256', 'MAX_TRIALS', 'OVERHEAD_CASES']) {
    assert.ok(source.indexOf(guard) < firstPaid, `${guard} validation must precede any spending`)
  }
})
