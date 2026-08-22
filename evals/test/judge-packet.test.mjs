// The frozen judge packet serialization + numeric context preflight (Sol round-7 P1#2). Deterministic
// bytes, exactly 10 responses / 5 pairs, and a tokenizer-agnostic char-budget that guarantees fit. No spend.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildJudgePacket, packetFitsContext, PACKET_BYTE_BUDGET, CONTEXT_TOKEN_BUDGET, RESERVED_OUTPUT_TOKENS
} from '../lib/judge-packet.mjs'

const args = {
  template: 'TEMPLATE',
  question: 'Q?',
  checklist: 'CHECK',
  responses: Array.from({ length: 10 }, (_, i) => `answer ${i + 1}`),
  pairs: Array.from({ length: 5 }, (_, i) => ({ a: `R${i + 1}`, b: `R${i + 6}` }))
}

test('the byte budget is the pinned context minus reserved output', () => {
  assert.equal(PACKET_BYTE_BUDGET, CONTEXT_TOKEN_BUDGET - RESERVED_OUTPUT_TOKENS)
  assert.equal(PACKET_BYTE_BUDGET, 122880)
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

test('packetFitsContext is a UTF-8 BYTE guarantee, not UTF-16 length (Sol round-8)', () => {
  assert.equal(packetFitsContext(buildJudgePacket(args)), true, 'a small packet fits')
  assert.equal(packetFitsContext('x'.repeat(PACKET_BYTE_BUDGET)), true, 'ASCII exactly at the budget fits (1 byte each)')
  assert.equal(packetFitsContext('x'.repeat(PACKET_BYTE_BUDGET + 1)), false, 'one byte over aborts')
  // Sol's exact probe: an arrow is 3 UTF-8 bytes, so this is 368,640 bytes — a naive .length check
  // (122,880) would wrongly accept it; the byte check must reject it.
  const arrows = '→'.repeat(PACKET_BYTE_BUDGET)
  assert.equal(arrows.length, PACKET_BYTE_BUDGET, 'UTF-16 length is only 122,880…')
  assert.equal(Buffer.byteLength(arrows, 'utf8'), PACKET_BYTE_BUDGET * 3, '…but 368,640 UTF-8 bytes')
  assert.equal(packetFitsContext(arrows), false, 'multibyte content over the BYTE budget aborts')
  // Just-fitting multibyte: budget/3 arrows = exactly the byte budget.
  assert.equal(packetFitsContext('→'.repeat(PACKET_BYTE_BUDGET / 3)), true)
})
