import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { PROMPTS_SHA256 } from '../lib/runner.mjs'

const FILE = new URL('../prompts.jsonl', import.meta.url)

const EXPECTED_COUNTS = {
  'short-lookup': 3,
  'multi-step': 3,
  'debug-partial-evidence': 2,
  options: 2,
  'long-list': 2
}

async function load () {
  const text = await readFile(FILE, 'utf8')
  return text.trim().split('\n').map((line, i) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`line ${i + 1} is not valid JSON: ${error.message}`)
    }
  })
}

test('every case has exactly the required keys', async () => {
  for (const row of await load()) {
    assert.deepEqual(Object.keys(row).sort(), ['category', 'id', 'prompt'])
    assert.ok(row.id.length > 0)
    assert.ok(row.prompt.length > 0)
  }
})

test('case ids are unique', async () => {
  const ids = (await load()).map(row => row.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('categories match the planned distribution', async () => {
  const counts = {}
  for (const row of await load()) {
    counts[row.category] = (counts[row.category] ?? 0) + 1
  }
  assert.deepEqual(counts, EXPECTED_COUNTS)
})

test('there are 12 cases', async () => {
  assert.equal((await load()).length, 12)
})

test('prompts.jsonl matches the committed hash pin', async () => {
  // Every published figure rests on this exact case set. An edit that slips through
  // silently invalidates the committed results while leaving them looking comparable,
  // so changing the prompts has to be a deliberate act that updates PROMPTS_SHA256
  // and re-runs the sweep. If this fails, that is the decision to make — not a
  // constant to quietly refresh.
  const digest = createHash('sha256')
    .update(await readFile(new URL('../prompts.jsonl', import.meta.url)))
    .digest('hex')
  assert.equal(digest, PROMPTS_SHA256)
})
