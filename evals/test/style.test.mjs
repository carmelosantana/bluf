import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { extractSharedBody, START, END } from '../lib/drift.mjs'
import { CONDITIONS } from '../lib/runner.mjs'

const MAIN = new URL('../../output-styles/bluf.md', import.meta.url)

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
  assert.equal(fields.name, 'BLUF')
  assert.equal(fields['keep-coding-instructions'], 'true')
  assert.ok(fields.description.length > 0, 'description is shown in the /config picker')
})

test('main style fences a shared body', async () => {
  const text = await readFile(MAIN, 'utf8')
  const start = text.indexOf(START)
  const end = text.indexOf(END)
  assert.notEqual(start, -1, 'missing START marker')
  assert.notEqual(end, -1, 'missing END marker')
  assert.ok(start < end, 'START must precede END')
})

test('main style blocks appear in the required order inside the shared body', async () => {
  // Scans the shared body rather than the whole file: a heading that drifted outside
  // the markers would not be shared with the terse variant, and scanning the file
  // would still report it as present and correctly ordered.
  const body = extractSharedBody(await readFile(MAIN, 'utf8'))
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
    const at = body.indexOf(heading)
    assert.notEqual(at, -1, `missing block, or it sits outside the shared body: ${heading}`)
    assert.ok(at > cursor, `${heading} is out of order`)
    cursor = at
  }
})

const TERSE = new URL('../../output-styles/bluf-terse.md', import.meta.url)

test('terse style declares the required frontmatter', async () => {
  const text = await readFile(TERSE, 'utf8')
  const fields = frontmatter(text)
  assert.equal(fields.name, 'BLUF (terse)')
  assert.equal(fields['keep-coding-instructions'], 'true')
})

test('terse style appends compression after the shared body', async () => {
  const text = await readFile(TERSE, 'utf8')
  assert.ok(
    text.indexOf(END) < text.indexOf('## Compression'),
    'compression must sit outside the shared body'
  )
})

// The eval selects a style by passing CONDITIONS[condition] as `outputStyle`. If a
// value stops matching a `name:` field, claude silently falls back to the default
// style and the whole sweep measures Default against Default while reporting success.
// Nothing else in the suite catches that, and it costs a full paid sweep to discover.
test('CONDITIONS values match the style name fields exactly', async () => {
  const mainName = frontmatter(await readFile(MAIN, 'utf8')).name
  const terseName = frontmatter(await readFile(TERSE, 'utf8')).name

  assert.equal(CONDITIONS.bluf, mainName)
  assert.equal(CONDITIONS['bluf-terse'], terseName)
  assert.equal(CONDITIONS.baseline, 'Default')
})
