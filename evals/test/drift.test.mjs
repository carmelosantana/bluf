import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { START, END, extractSharedBody, checkDrift } from '../lib/drift.mjs'

const MAIN = new URL('../../output-styles/bluf.md', import.meta.url)
const TERSE = new URL('../../output-styles/bluf-terse.md', import.meta.url)

test('extractSharedBody returns only the fenced body', () => {
  const text = `---\nname: X\n---\n${START}\nBODY\n${END}\ntail`
  assert.equal(extractSharedBody(text), '\nBODY\n')
})

test('extractSharedBody rejects a missing start marker', () => {
  assert.throws(() => extractSharedBody(`no markers here ${END}`), /START/)
})

test('extractSharedBody rejects a missing end marker', () => {
  assert.throws(() => extractSharedBody(`${START} no end`), /END/)
})

test('extractSharedBody rejects reversed markers', () => {
  assert.throws(() => extractSharedBody(`${END}\nBODY\n${START}`), /order/)
})

test('checkDrift passes on identical bodies', () => {
  const a = `${START}\nSAME\n${END}`
  const b = `${START}\nSAME\n${END}\n## Compression\nextra`
  assert.equal(checkDrift(a, b).ok, true)
})

test('checkDrift fails on divergent bodies and names the first difference', () => {
  const a = `${START}\nline one\nline two\n${END}`
  const b = `${START}\nline one\nline TWO\n${END}`
  const result = checkDrift(a, b)
  assert.equal(result.ok, false)
  assert.match(result.message, /line 3/)
})

test('the shipped style files share a byte-identical body', async () => {
  const [main, terse] = await Promise.all([
    readFile(MAIN, 'utf8'),
    readFile(TERSE, 'utf8')
  ])
  const result = checkDrift(main, terse)
  assert.equal(result.ok, true, result.message)
})
