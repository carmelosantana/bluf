import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CONDITIONS } from '../lib/runner.mjs'

const MAIN = new URL('../../output-styles/bluf.md', import.meta.url)

// Vestigial markers from the retired terse variant (see archive/README.md). They
// fenced the body the two style files shared, and a drift check kept those bodies
// byte-identical. The variant is retired and the check is gone, but the markers MUST
// stay: every published figure measures bluf.md exactly as committed, so editing the
// file — even to delete a dead comment — would make every number describe a file that
// no longer exists.
const START = '<!-- BLUF:SHARED-BODY:START -->'
const END = '<!-- BLUF:SHARED-BODY:END -->'

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

test('main style keeps its vestigial shared-body markers', async () => {
  // The measured file must not change: deleting these now-dead comments would
  // invalidate every published figure without touching a single rule. A missing
  // marker here means bluf.md was edited, and the README's numbers no longer
  // describe the shipped file.
  const text = await readFile(MAIN, 'utf8')
  const start = text.indexOf(START)
  const end = text.indexOf(END)
  assert.notEqual(start, -1, 'missing START marker — bluf.md was edited; the published figures no longer describe this file')
  assert.notEqual(end, -1, 'missing END marker — bluf.md was edited; the published figures no longer describe this file')
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

// The eval selects a style by passing CONDITIONS[condition] as `outputStyle`. If a
// value stops matching a `name:` field, claude silently falls back to the default
// style and the whole sweep measures Default against Default while reporting success.
// Nothing else in the suite catches that, and it costs a full paid sweep to discover.
test('CONDITIONS values match the style name fields exactly', async () => {
  const mainName = frontmatter(await readFile(MAIN, 'utf8')).name

  assert.equal(CONDITIONS.bluf, mainName)
  assert.equal(CONDITIONS.baseline, 'Default')
})

test('CONDITIONS carries exactly the launch conditions: baseline and bluf', () => {
  // The terse variant was retired before launch (see archive/). Its committed result
  // rows still carry condition "bluf-terse"; that is stored evidence, not a live
  // condition, and it must not reappear here without a deliberate re-measure.
  assert.deepEqual(Object.keys(CONDITIONS).sort(), ['baseline', 'bluf'])
})
