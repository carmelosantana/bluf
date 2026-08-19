// The frozen judge packet serialization + numeric context preflight (Sol round-7 P1#2). Deterministic
// bytes, exactly 10 responses / 5 pairs, and a tokenizer-agnostic char-budget that guarantees fit. No spend.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildJudgePacket, packetFitsContext, PACKET_CHAR_BUDGET, CONTEXT_TOKEN_BUDGET, RESERVED_OUTPUT_TOKENS
} from '../lib/judge-packet.mjs'

const args = {
  template: 'TEMPLATE',
  question: 'Q?',
  checklist: 'CHECK',
  responses: Array.from({ length: 10 }, (_, i) => `answer ${i + 1}`),
  pairs: Array.from({ length: 5 }, (_, i) => ({ a: `R${i + 1}`, b: `R${i + 6}` }))
}

test('the char budget is the pinned context minus reserved output', () => {
  assert.equal(PACKET_CHAR_BUDGET, CONTEXT_TOKEN_BUDGET - RESERVED_OUTPUT_TOKENS)
  assert.equal(PACKET_CHAR_BUDGET, 122880)
})

test('buildJudgePacket is deterministic and labels R1..R10 and P1..P5', () => {
  const a = buildJudgePacket(args)
  assert.equal(a, buildJudgePacket(args), 'same inputs → identical bytes')
  for (let i = 1; i <= 10; i++) assert.match(a, new RegExp(`### R${i}\\b`))
  for (let j = 1; j <= 5; j++) assert.match(a, new RegExp(`\\nP${j}: A=`))
})

test('buildJudgePacket requires exactly 10 responses and 5 pairs', () => {
  assert.throws(() => buildJudgePacket({ ...args, responses: args.responses.slice(0, 9) }), /exactly 10 responses/)
  assert.throws(() => buildJudgePacket({ ...args, pairs: args.pairs.slice(0, 4) }), /exactly 5 pairs/)
})

test('packetFitsContext is a pure char-count guarantee (chars <= budget)', () => {
  assert.equal(packetFitsContext(buildJudgePacket(args)), true, 'a small packet fits')
  assert.equal(packetFitsContext('x'.repeat(PACKET_CHAR_BUDGET)), true, 'exactly at the budget fits')
  assert.equal(packetFitsContext('x'.repeat(PACKET_CHAR_BUDGET + 1)), false, 'one over the budget aborts')
})
