import { test } from 'node:test'
import assert from 'node:assert/strict'
import { legacySplit } from '../analysis/phase2b-uncertainty.mjs'

test('legacySplit partitions ids by membership in the legacy set', () => {
  const legacy = new Set(['a', 'b', 'c'])
  const { legacy: leg, fresh } = legacySplit(['a', 'x', 'b', 'y'], legacy)
  assert.deepEqual(leg, ['a', 'b'])
  assert.deepEqual(fresh, ['x', 'y'])
})
