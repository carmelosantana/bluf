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

  for (const guard of ['PROMPTS_SHA256', 'MAX_TRIALS', 'OVERHEAD_CASES', 'assertOverwritesAllowed']) {
    const index = source.indexOf(guard)
    assert.ok(index > -1, `${guard} validation must exist`)
    assert.ok(index < firstPaid, `${guard} validation must precede any spending`)
  }
})

test('the tracked-overwrite gate runs before the first paid call', () => {
  // The gate is free and the loss it prevents is unrecoverable: committed result rows
  // are the evidence behind published claims, and the sweep writes its files
  // unconditionally. A gate below the first runCase would spend money before checking.
  const gate = source.indexOf('assertOverwritesAllowed(')
  const firstPaid = source.indexOf('await runCase(')
  assert.ok(gate > -1, 'measure.mjs must gate on tracked result files')
  assert.ok(firstPaid > -1)
  assert.ok(gate < firstPaid, 'the overwrite gate must precede any spending')
  // The gate must cover every path the run writes, not a hand-kept subset: the planned
  // list has to come from the same constants the write loops interpolate.
  assert.ok(source.includes('plannedSweepFiles('), 'the planned files must be enumerated by the shared pure function')
  assert.ok(source.includes('process.env[OVERWRITE_ALLOWLIST_VAR]'),
    'the escape hatch must be read through the named allowlist variable, never an ad-hoc string')
})

test('the overhead sweep verifies the style reached the model after paying for it', () => {
  // ENVIRONMENTS.lean passes no --setting-sources, so the lean arm loads the style from
  // the operator's user-level ~/.claude/output-styles install — runCase's project-style
  // install and assertion are clean-environment-only, and preflight exercises the clean
  // environment only. Without a post-payment check here, a missing user-level install
  // makes all 20 lean calls measure Default against Default and report success.
  const overheadWrite = source.indexOf('${OVERHEAD_ENVIRONMENT}-${OVERHEAD_MODEL}-${condition}.jsonl')
  assert.ok(overheadWrite > -1, 'the overhead write loop must exist')
  const overheadLoop = source.indexOf('for (const caseRow of overheadCases)', overheadWrite)
  assert.ok(overheadLoop > -1, 'the overhead style check must loop per overhead case, after the write block')
  const call = source.indexOf('assertStyleOverheadPresent(', overheadLoop)
  assert.ok(call > -1, 'the overhead sweep must verify the style applied')
  // After the write block so a throw still leaves the paid rows persisted, but inside
  // the try so the incomplete-sweep accounting still fires.
  const catchIndex = source.indexOf('} catch (error) {')
  assert.ok(catchIndex > -1)
  assert.ok(call < catchIndex, 'the overhead style check must sit inside the try, before the failure accounting')
})
