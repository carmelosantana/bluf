import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ordinal } from '../src/ordinal.mjs'

// These cases are all documented in src/ordinal.mjs. They are the edges a hurried
// last-digit fix misses: the teens exception, and negative operands (in JS,
// -1 % 10 === -1, so a bare last-digit comparison never matches a negative).

test('numbers ending in 11, 12 or 13 always take th', () => {
  assert.equal(ordinal(11), '11th')
  assert.equal(ordinal(12), '12th')
  assert.equal(ordinal(13), '13th')
  assert.equal(ordinal(111), '111th')
  assert.equal(ordinal(412), '412th')
  assert.equal(ordinal(1013), '1013th')
})

test('a negative integer takes the suffix of its absolute value', () => {
  assert.equal(ordinal(-1), '-1st')
  assert.equal(ordinal(-2), '-2nd')
  assert.equal(ordinal(-3), '-3rd')
  assert.equal(ordinal(-11), '-11th')
  assert.equal(ordinal(-22), '-22nd')
})

test('zero is 0th', () => {
  assert.equal(ordinal(0), '0th')
})
