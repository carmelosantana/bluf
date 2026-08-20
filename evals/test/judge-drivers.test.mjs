// Pure parts of the Codex and Claude judge drivers (no network/CLI): prompt framing, fence stripping,
// and codex argv construction.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripFences, claudeJudgePrompt, CLAUDE_JUDGE_MODEL } from '../lib/judge-claude.mjs'
import { codexArgs, CODEX_MODEL } from '../lib/judge-codex.mjs'

test('stripFences unwraps a single json fence, leaves plain JSON untouched', () => {
  assert.equal(stripFences('```json\n{"a":1}\n```'), '{"a":1}')
  assert.equal(stripFences('```\n{"a":1}\n```'), '{"a":1}')
  assert.equal(stripFences('{"a":1}'), '{"a":1}')
  assert.equal(stripFences('  {"a":1}  '), '{"a":1}')
})

test('claudeJudgePrompt appends the schema as framing without altering the packet', () => {
  const p = claudeJudgePrompt('PACKET-BODY')
  assert.match(p, /^PACKET-BODY/)
  assert.match(p, /OUTPUT FORMAT/)
  assert.match(p, /"responses"/) // the schema JSON is embedded
  assert.equal(CLAUDE_JUDGE_MODEL, 'claude-sonnet-5')
})

test('codexArgs builds the frozen invocation (model, effort high, read-only, schema, last-message)', () => {
  const a = codexArgs({ model: CODEX_MODEL, schemaFile: '/t/s.json', outFile: '/t/o.txt', packet: 'PKT' })
  assert.deepEqual(a.slice(0, 2), ['exec', '-m'])
  assert.ok(a.includes('gpt-5.6-sol'))
  assert.ok(a.includes('model_reasoning_effort=high'))
  assert.equal(a[a.indexOf('-s') + 1], 'read-only')
  assert.equal(a[a.indexOf('--output-schema') + 1], '/t/s.json')
  assert.equal(a[a.indexOf('--output-last-message') + 1], '/t/o.txt')
  assert.equal(a[a.length - 1], 'PKT') // the packet is the final positional prompt
})
