import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const MAIN = new URL('../../output-styles/less-chatty.md', import.meta.url)

function frontmatter (text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(match, 'file must open with YAML frontmatter')
  const fields = {}
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return fields
}

test('main style declares the required frontmatter', async () => {
  const text = await readFile(MAIN, 'utf8')
  const fields = frontmatter(text)
  assert.equal(fields.name, 'Less Chatty')
  assert.equal(fields['keep-coding-instructions'], 'true')
  assert.ok(fields.description.length > 0, 'description is shown in the /config picker')
})

test('main style fences a shared body', async () => {
  const text = await readFile(MAIN, 'utf8')
  const start = text.indexOf('<!-- LESS-CHATTY:SHARED-BODY:START -->')
  const end = text.indexOf('<!-- LESS-CHATTY:SHARED-BODY:END -->')
  assert.notEqual(start, -1, 'missing START marker')
  assert.notEqual(end, -1, 'missing END marker')
  assert.ok(start < end, 'START must precede END')
})

test('main style blocks appear in the required order', async () => {
  const text = await readFile(MAIN, 'utf8')
  const headings = [
    '## Precedence',
    '## Never apply these rules to',
    '## Response contract',
    '## Sentence rules',
    '## Pre-send check',
    '## Length is not terseness'
  ]
  let cursor = -1
  for (const heading of headings) {
    const at = text.indexOf(heading)
    assert.notEqual(at, -1, `missing block: ${heading}`)
    assert.ok(at > cursor, `${heading} is out of order`)
    cursor = at
  }
})

test('precedence is the first block, before any rule', async () => {
  const text = await readFile(MAIN, 'utf8')
  assert.ok(
    text.indexOf('## Precedence') < text.indexOf('## Response contract'),
    'precedence must outrank the rules it governs, and must be read first'
  )
})

const TERSE = new URL('../../output-styles/less-chatty-terse.md', import.meta.url)

test('terse style declares the required frontmatter', async () => {
  const text = await readFile(TERSE, 'utf8')
  const fields = frontmatter(text)
  assert.equal(fields.name, 'Less Chatty (terse)')
  assert.equal(fields['keep-coding-instructions'], 'true')
})

test('terse style appends compression after the shared body', async () => {
  const text = await readFile(TERSE, 'utf8')
  assert.ok(
    text.indexOf('<!-- LESS-CHATTY:SHARED-BODY:END -->') < text.indexOf('## Compression'),
    'compression must sit outside the shared body'
  )
})
