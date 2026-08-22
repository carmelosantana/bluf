// The frozen judge output contract: strict duplicate-key-rejecting parse + exact structural validation.
// No spend.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStrictJSON, validateJudgeResult, parseAndValidateJudgeResult } from '../lib/judge-schema.mjs'

const validResult = () => ({
  responses: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`R${i + 1}`, { correctness: 3, completeness: 4, omission: false }])),
  preferences: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`P${i + 1}`, { preference: 'tie' }]))
})

test('parseStrictJSON parses normal JSON like JSON.parse', () => {
  assert.deepEqual(parseStrictJSON('{"a":1,"b":[true,null,"x\\n"],"c":-2.5e3}'), { a: 1, b: [true, null, 'x\n'], c: -2500 })
})

test('parseStrictJSON REJECTS duplicate object keys (JSON.parse would keep last)', () => {
  assert.equal(JSON.parse('{"R1":1,"R1":2}').R1, 2) // baseline: JSON.parse silently keeps last
  assert.throws(() => parseStrictJSON('{"R1":1,"R1":2}'), /duplicate key "R1"/)
  assert.throws(() => parseStrictJSON('{"a":{"x":1,"x":2}}'), /duplicate key "x"/) // nested
})

test('parseStrictJSON rejects trailing garbage', () => {
  assert.throws(() => parseStrictJSON('{"a":1} junk'), /trailing characters/)
})

test('validateJudgeResult accepts the exact frozen schema', () => {
  assert.deepEqual(validateJudgeResult(validResult()), [])
})

test('validateJudgeResult flags extra/missing keys, bad ranges, wrong types', () => {
  const extra = validResult(); extra.responses.R1.foo = 1
  assert.ok(validateJudgeResult(extra).some(e => /R1 keys must be exactly/.test(e)))

  const missing = validResult(); delete missing.responses.R10
  assert.ok(validateJudgeResult(missing).some(e => /responses keys must be exactly R1\.\.R10/.test(e)))

  const range = validResult(); range.responses.R2.correctness = 6
  assert.ok(validateJudgeResult(range).some(e => /R2\.correctness must be int 1-5/.test(e)))

  const frac = validResult(); frac.responses.R3.completeness = 3.5
  assert.ok(validateJudgeResult(frac).some(e => /R3\.completeness must be int 1-5/.test(e)))

  const omi = validResult(); omi.responses.R4.omission = 'yes'
  assert.ok(validateJudgeResult(omi).some(e => /R4\.omission must be boolean/.test(e)))

  const pref = validResult(); pref.preferences.P1.preference = 'left'
  assert.ok(validateJudgeResult(pref).some(e => /P1\.preference must be/.test(e)))

  const topExtra = validResult(); topExtra.notes = 'hi'
  assert.ok(validateJudgeResult(topExtra).some(e => /top keys must be exactly/.test(e)))
})

test('parseAndValidateJudgeResult: ok on valid, ok:false (never throws) on bad JSON or bad schema', () => {
  const good = parseAndValidateJudgeResult(JSON.stringify(validResult()))
  assert.equal(good.ok, true)
  assert.deepEqual(good.errors, [])

  const badJson = parseAndValidateJudgeResult('{not json')
  assert.equal(badJson.ok, false)
  assert.equal(badJson.value, null)
  assert.ok(badJson.errors.length)

  const dup = parseAndValidateJudgeResult('{"responses":{"R1":{"correctness":1,"correctness":2}}}')
  assert.equal(dup.ok, false)
  assert.ok(dup.errors.some(e => /duplicate key/.test(e)))
})
