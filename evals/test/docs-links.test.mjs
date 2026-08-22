import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// GitHub heading -> anchor slug: strip inline code/emphasis markers, lowercase,
// drop punctuation except word chars/space/hyphen, spaces -> hyphens, trim hyphens.
function slugify(heading) {
  return heading
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__|\*|_/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s/g, '-')
    .replace(/^-+|-+$/g, '')
}

function headingSlugs(md) {
  const slugs = new Set()
  for (const line of md.split('\n')) {
    const m = /^#{1,6}\s+(.*)$/.exec(line)
    if (m) slugs.add(slugify(m[1].trim()))
  }
  return slugs
}

// Every local link/image reference, split into path + optional #fragment.
function references(md) {
  const refs = []
  const linkRe = /\]\(([^)]+)\)/g
  const imgRe = /<img[^>]+src="([^"]+)"/g
  for (const re of [linkRe, imgRe]) {
    let m
    while ((m = re.exec(md))) {
      const target = m[1].trim()
      if (/^(https?:|mailto:)/.test(target)) continue
      const [path, frag] = target.includes('#') ? [target.slice(0, target.indexOf('#')), target.slice(target.indexOf('#') + 1)] : [target, '']
      refs.push({ raw: target, path, frag })
    }
  }
  return refs
}

for (const doc of ['README.md', 'STORY.md']) {
  test(`${doc}: every local link and image path resolves`, () => {
    const md = readFileSync(resolve(root, doc), 'utf8')
    const missing = references(md).filter(r => r.path && !existsSync(resolve(root, r.path))).map(r => r.raw)
    assert.deepEqual(missing, [], `missing targets in ${doc}: ${missing.join(', ')}`)
  })

  test(`${doc}: every #anchor resolves to a heading in the target markdown`, () => {
    const md = readFileSync(resolve(root, doc), 'utf8')
    const broken = []
    for (const { raw, path, frag } of references(md)) {
      if (!frag) continue
      const targetPath = path === '' ? doc : path
      if (!targetPath.endsWith('.md')) continue // only markdown files have heading anchors
      const abs = resolve(root, targetPath)
      if (!existsSync(abs)) continue // path failure already caught by the test above
      if (!headingSlugs(readFileSync(abs, 'utf8')).has(frag)) broken.push(raw)
    }
    assert.deepEqual(broken, [], `broken anchors in ${doc}: ${broken.join(', ')}`)
  })
}
