// Codex judge driver (primary, independent GPT family, free / not billed to the opus budget).
// gpt-5.6-sol with model_reasoning_effort=high, run non-interactively via `codex exec`. Structured
// output via --output-schema; the final message is written to --output-last-message and read back
// (avoids parsing agent chatter from stdout). Read-only sandbox — the grading task needs no file access.
// NOTE: this is the same engine the methodology reviewer ("Sol") runs on; the judging task is distinct,
// stateless, and uses only the frozen template + blinded packet — no reviewer context. Disclosed.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JUDGE_JSON_SCHEMA } from './judge-schema.mjs'

const run = promisify(execFile)
export const CODEX_MODEL = 'gpt-5.6-sol'

export function codexArgs ({ model, schemaFile, outFile, packet }) {
  return ['exec', '-m', model, '-c', 'model_reasoning_effort=high', '-s', 'read-only',
    '--skip-git-repo-check', '--color', 'never', '--output-schema', schemaFile,
    '--output-last-message', outFile, packet]
}

export async function callCodexJudge ({ packet, model = CODEX_MODEL }) {
  const dir = await mkdtemp(join(tmpdir(), 'codex-judge-'))
  try {
    const schemaFile = join(dir, 'schema.json')
    const outFile = join(dir, 'final.txt')
    await writeFile(schemaFile, JSON.stringify(JUDGE_JSON_SCHEMA))
    await run('codex', codexArgs({ model, schemaFile, outFile, packet }), { cwd: dir, maxBuffer: 64 * 1024 * 1024 })
    return (await readFile(outFile, 'utf8')).trim()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export function codexDriver ({ model } = {}) {
  return async (packet) => callCodexJudge({ packet, model })
}
