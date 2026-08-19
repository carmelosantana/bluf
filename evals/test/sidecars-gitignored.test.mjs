// Repo invariant (Sol P2): the diagnostic sidecars must never be committed. `.gitignore` alone does
// not guarantee this — `git add -f` can force-track an ignored file — so this asserts, against the
// actual index, that no transcript or quarantine sidecar is tracked. It also confirms the ignore
// patterns still catch a would-be sidecar while NOT catching the committable count-row files.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('no transcript or quarantine sidecar is git-tracked', async () => {
  const { stdout } = await run('git', ['ls-files', 'evals/results/padded-*-text.jsonl', 'evals/results/padded-*-quarantine.jsonl'], { cwd: ROOT })
  assert.equal(stdout.trim(), '', `these sidecars must never be committed, found:\n${stdout}`)
})

test('the ignore patterns catch sidecars but not the committable count rows', async () => {
  const ignored = async p => {
    try { await run('git', ['check-ignore', '-q', p], { cwd: ROOT }); return true } catch { return false }
  }
  assert.equal(await ignored('evals/results/padded-claude-opus-5-baseline-text.jsonl'), true, 'transcript sidecar must be ignored')
  assert.equal(await ignored('evals/results/padded-claude-opus-5-baseline-quarantine.jsonl'), true, 'quarantine sidecar must be ignored')
  assert.equal(await ignored('evals/results/padded-claude-opus-5-baseline.jsonl'), false, 'the count-row file must NOT be ignored (it is committable evidence)')
})
