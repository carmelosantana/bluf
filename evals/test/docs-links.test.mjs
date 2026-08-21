import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function localTargets(md) {
  const targets = []
  const linkRe = /\]\(([^)]+)\)/g
  const imgRe = /<img[^>]+src="([^"]+)"/g
  for (const re of [linkRe, imgRe]) {
    let m
    while ((m = re.exec(md))) {
      const raw = m[1].trim().split('#')[0]
      if (!raw || /^(https?:|mailto:)/.test(raw)) continue
      targets.push(raw)
    }
  }
  return targets
}

for (const doc of ['README.md', 'STORY.md']) {
  test(`${doc}: every local link and image resolves`, () => {
    const md = readFileSync(resolve(root, doc), 'utf8')
    const missing = localTargets(md).filter(t => !existsSync(resolve(root, t)))
    assert.deepEqual(missing, [], `missing targets in ${doc}: ${missing.join(', ')}`)
  })
}
