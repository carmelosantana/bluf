// Pure parts of the Ollama judge driver (no network): the seed derivation and the shared JSON schema.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ollamaSeedInt, OLLAMA_PINNED_DIGEST, OLLAMA_NUM_CTX } from '../lib/judge-ollama.mjs'
import { JUDGE_JSON_SCHEMA, validateJudgeResult } from '../lib/judge-schema.mjs'

test('ollamaSeedInt is a deterministic 32-bit int from the manifest seed prefix', () => {
  assert.equal(ollamaSeedInt('dd94f85aae49718f802c7e067a76c082'), parseInt('dd94f85a', 16))
  assert.equal(ollamaSeedInt('dd94f85aae49718f802c7e067a76c082'), ollamaSeedInt('dd94f85aae49718f802c7e067a76c082'))
  assert.throws(() => ollamaSeedInt('nothex'), /hex manifest seed/)
})

test('pinned digest and context are the protocol values', () => {
  assert.equal(OLLAMA_PINNED_DIGEST, '22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643')
  assert.equal(OLLAMA_NUM_CTX, 131072)
})

test('JUDGE_JSON_SCHEMA describes the same shape validateJudgeResult accepts', () => {
  // sanity: required top keys and the response/preference sub-shapes line up with the validator
  assert.deepEqual(JUDGE_JSON_SCHEMA.required.sort(), ['preferences', 'responses'])
  assert.equal(JUDGE_JSON_SCHEMA.properties.responses.required.length, 10)
  assert.equal(JUDGE_JSON_SCHEMA.properties.preferences.required.length, 5)
  // a value shaped per the schema validates cleanly
  const good = {
    responses: Object.fromEntries(JUDGE_JSON_SCHEMA.properties.responses.required.map(l => [l, { correctness: 1, completeness: 5, omission: true }])),
    preferences: Object.fromEntries(JUDGE_JSON_SCHEMA.properties.preferences.required.map(l => [l, { preference: 'tie' }]))
  }
  assert.deepEqual(validateJudgeResult(good), [])
})
