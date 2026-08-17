import { test } from 'node:test'
import assert from 'node:assert/strict'
import { permuteCases, scheduleSweep, MAX_SHARED_ADJACENCY } from '../lib/schedule.mjs'

const cases = Array.from({ length: 12 }, (_, i) => ({ id: `case-${i}` }))
const adjacencies = order => new Set(order.slice(1).map((id, i) => `${order[i]}>${id}`))

test('permuteCases is a permutation — every case exactly once', () => {
  for (let trial = 1; trial <= 5; trial += 1) {
    const permuted = permuteCases(cases, trial)
    assert.equal(permuted.length, cases.length)
    assert.deepEqual([...permuted.map(c => c.id)].sort(), [...cases.map(c => c.id)].sort())
  }
})

test('permuteCases is deterministic', () => {
  assert.deepEqual(permuteCases(cases, 3), permuteCases(cases, 3))
})

test('permuteCases gives every trial a distinct order', () => {
  const orders = [1, 2, 3, 4, 5].map(trial => permuteCases(cases, trial).map(c => c.id).join(','))
  assert.equal(new Set(orders).size, 5)
})

test('permuteCases does not merely rotate one cycle', () => {
  // The failure this pins: a per-trial OFFSET into a fixed stride leaves every trial a
  // rotation of the same cycle, sharing 10 of 11 adjacencies. A seeded shuffle does not.
  const orders = [1, 2, 3, 4, 5].map(trial => permuteCases(cases, trial).map(c => c.id))

  for (let i = 0; i < orders.length; i += 1) {
    for (let j = i + 1; j < orders.length; j += 1) {
      const shared = [...adjacencies(orders[i])].filter(pair => adjacencies(orders[j]).has(pair)).length
      assert.ok(
        shared <= MAX_SHARED_ADJACENCY,
        `trials ${i + 1} and ${j + 1} share ${shared} adjacent pairs, above the pinned ceiling`
      )
    }
  }
})

test('permuteCases leaves a single-case set alone', () => {
  assert.deepEqual(permuteCases([{ id: 'only' }], 4), [{ id: 'only' }])
})

test('permuteCases rejects a trial number that is not a positive integer', () => {
  assert.throws(() => permuteCases(cases, 0), /trial number/)
  assert.throws(() => permuteCases(cases, 1.5), /trial number/)
})

test('scheduleSweep runs whole trials, not repeated cases', () => {
  const schedule = scheduleSweep({ cases, conditions: ['baseline', 'bluf'], trials: 3 })

  assert.equal(schedule.length, 12 * 2 * 3)

  // The defect being fixed: today every repetition of a case is adjacent. After this,
  // a trial completes before the next begins.
  const trialOrder = schedule.map(entry => entry.trial)
  assert.deepEqual(trialOrder, [...trialOrder].sort((a, b) => a - b), 'trials must not interleave')

  const firstTrial = schedule.filter(entry => entry.trial === 1)
  assert.equal(new Set(firstTrial.map(entry => entry.caseId)).size, 12, 'a trial covers every case once')
})

test('scheduleSweep reports the ORIGINAL case index, not the permuted position', () => {
  // The condition rotation keys on this. Keying on the permuted position cancels the
  // trial term algebraically and reinstates the confound.
  const schedule = scheduleSweep({ cases, conditions: ['baseline', 'bluf'], trials: 2 })

  for (const entry of schedule) {
    assert.equal(entry.caseId, cases[entry.caseIndex].id)
  }
})

test('scheduleSweep flips which condition leads, for every case, between trials', () => {
  const schedule = scheduleSweep({ cases, conditions: ['baseline', 'bluf'], trials: 2 })
  const leaderFor = (trial, caseId) =>
    schedule.find(entry => entry.trial === trial && entry.caseId === caseId).condition

  const flipped = cases.filter(c => leaderFor(1, c.id) !== leaderFor(2, c.id))
  assert.equal(flipped.length, 12, 'with two conditions every case should alternate its leader')
})

test('scheduleSweep keeps a case contiguous within a trial', () => {
  // Conditions for one case still run back to back, so drift over the sweep hits them
  // equally. That property is why the existing sweep interleaves; it must survive.
  // Valid only because there are exactly two conditions — do not generalise it.
  const schedule = scheduleSweep({ cases, conditions: ['baseline', 'bluf'], trials: 2 })
  for (let i = 0; i < schedule.length; i += 2) {
    assert.equal(schedule[i].caseId, schedule[i + 1].caseId)
    assert.notEqual(schedule[i].condition, schedule[i + 1].condition)
  }
})
