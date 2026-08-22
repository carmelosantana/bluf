// Judge retry/abort orchestration with a MOCK driver — first-valid-wins, exactly-one-retry, abort on a
// second invalid, every raw attempt retained. No spend, no network.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judgeOnePacket, runJudgeOverPackets, MAX_JUDGE_ATTEMPTS } from '../lib/judge-run.mjs'

const valid = JSON.stringify({
  responses: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`R${i + 1}`, { correctness: 3, completeness: 3, omission: false }])),
  preferences: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`P${i + 1}`, { preference: 'A' }]))
})

// a driver whose successive outputs are scripted
const scripted = outs => { let n = 0; return async () => outs[n++] }

test('one retry: exactly two attempts allowed', () => {
  assert.equal(MAX_JUDGE_ATTEMPTS, 2)
})

test('judgeOnePacket: first-valid-wins on attempt 1 (no retry)', async () => {
  let calls = 0
  const one = await judgeOnePacket({ caseId: 'a', packet: 'P', call: async () => { calls++; return valid } })
  assert.equal(one.ok, true)
  assert.equal(calls, 1, 'a valid first output must not trigger a retry')
  assert.equal(one.attempts.length, 1)
})

test('judgeOnePacket: invalid then valid → ok after one retry, both attempts retained', async () => {
  const one = await judgeOnePacket({ caseId: 'a', packet: 'P', call: scripted(['{bad', valid]) })
  assert.equal(one.ok, true)
  assert.equal(one.attempts.length, 2)
  assert.ok(one.attempts[0].errors.length, 'the bad attempt keeps its errors')
  assert.equal(one.attempts[0].raw, '{bad', 'raw of every attempt is retained')
})

test('judgeOnePacket: two invalids → not ok, both raws retained', async () => {
  const one = await judgeOnePacket({ caseId: 'a', packet: 'P', call: scripted(['{bad', '{"responses":{}}']) })
  assert.equal(one.ok, false)
  assert.equal(one.attempts.length, MAX_JUDGE_ATTEMPTS)
})

test('runJudgeOverPackets: a second-invalid on a packet ABORTS the judge and stops early', async () => {
  // each packet string is its caseId, so the mock can script per-packet; p2 fails twice.
  const packets = ['p1', 'p2', 'p3'].map(id => ({ caseId: id, packet: id }))
  const scripts = { p1: [valid], p2: ['{bad', '{bad again'], p3: [valid] }
  const call = async (packet, { attempt }) => scripts[packet][attempt - 1]
  const seen = []
  const run = await runJudgeOverPackets({ judge: 'mock', packets, call, onProgress: r => seen.push(r.caseId) })
  assert.equal(run.aborted, true)
  assert.equal(run.abortedOn, 'p2')
  assert.equal(run.results.length, 2, 'stops at p2, never reaches p3')
  assert.equal(run.results[0].ok, true)
  assert.equal(run.results[1].ok, false)
  assert.deepEqual(seen, ['p1', 'p2'])
})

test('runJudgeOverPackets: all valid → not aborted, one result per packet', async () => {
  const packets = ['p1', 'p2', 'p3'].map(id => ({ caseId: id, packet: id }))
  const call = async () => valid
  const run = await runJudgeOverPackets({ judge: 'mock', packets, call })
  assert.equal(run.aborted, false)
  assert.equal(run.abortedOn, null)
  assert.equal(run.results.length, 3)
  assert.ok(run.results.every(r => r.ok))
})
