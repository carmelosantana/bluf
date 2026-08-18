import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ordinal } from '../src/ordinal.mjs'

test('renders the common ordinals', () => {
  assert.equal(ordinal(1), '1st')
  assert.equal(ordinal(2), '2nd')
  assert.equal(ordinal(3), '3rd')
  assert.equal(ordinal(4), '4th')
  assert.equal(ordinal(7), '7th')
  assert.equal(ordinal(10), '10th')
})

test('the suffix follows the last digit past ten', () => {
  assert.equal(ordinal(21), '21st')
  assert.equal(ordinal(42), '42nd')
  assert.equal(ordinal(63), '63rd')
  assert.equal(ordinal(100), '100th')
})

test('rejects a non-integer', () => {
  assert.throws(() => ordinal(2.5), RangeError)
})
