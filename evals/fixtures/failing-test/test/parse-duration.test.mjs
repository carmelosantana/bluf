import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDuration } from '../src/parse-duration.mjs'

test('parses each unit into milliseconds', () => {
  assert.equal(parseDuration('300ms'), 300)
  assert.equal(parseDuration('5s'), 5000)
  assert.equal(parseDuration('2m'), 120000)
  assert.equal(parseDuration('3h'), 10800000)
  assert.equal(parseDuration('1d'), 86400000)
})

test('rejects an unparseable duration', () => {
  assert.throws(() => parseDuration('later'), /unparseable/)
})
