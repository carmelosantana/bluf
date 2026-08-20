import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadUpheldSet } from '../lib/upheld.mjs'

test('throws when the record is absent and not provisional', async () => {
  await assert.rejects(() => loadUpheldSet({ path: '/no/such/file.json', provisional: false }), /adjudication/i)
})

test('provisional mode upholds everything when the record is absent', async () => {
  const { upheldSet, mode } = await loadUpheldSet({ path: '/no/such/file.json', provisional: true })
  assert.equal(mode, 'PROVISIONAL')
  assert.equal(upheldSet.has('anything|R1'), true)
})

test('reads the record when present', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'adj-'))
  const p = join(dir, 'omission-adjudication.json')
  await writeFile(p, JSON.stringify({ rulings: [{ caseId: 'p1', label: 'R1', upheld: true }, { caseId: 'p1', label: 'R2', upheld: false }] }))
  const { upheldSet, mode } = await loadUpheldSet({ path: p, provisional: false })
  assert.equal(mode, 'ADJUDICATED')
  assert.equal(upheldSet.has('p1|R1'), true)
  assert.equal(upheldSet.has('p1|R2'), false)
  await rm(dir, { recursive: true, force: true })
})
