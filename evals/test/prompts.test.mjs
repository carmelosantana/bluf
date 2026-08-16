import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

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
