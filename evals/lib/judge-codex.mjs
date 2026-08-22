// Codex judge driver (primary, independent GPT family, free / not billed to the opus budget).
// gpt-5.6-sol with model_reasoning_effort=high, run non-interactively via `codex exec`. Structured
// output via --output-schema; the final message is written to --output-last-message and read back
// (avoids parsing agent chatter from stdout). Read-only sandbox — the grading task needs no file access.
// NOTE: this is the same engine the methodology reviewer ("Sol") runs on; the judging task is distinct,
// stateless, and uses only the frozen template + blinded packet — no reviewer context. Disclosed.

import { spawn } from 'node:child_process'
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JUDGE_JSON_SCHEMA } from './judge-schema.mjs'

export const CODEX_MODEL = 'gpt-5.6-sol'

// `codex exec` reads instructions from stdin even when a prompt arg is given, and BLOCKS until stdin
// hits EOF — so it must be spawned with stdin CLOSED (`ignore`), or it hangs forever. The result is read
// from --output-last-message, so stdout is drained and discarded.
function runCodexExec (args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn('codex', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    p.stdout.on('data', () => {})
    p.stderr.on('data', d => { err += d })
    p.on('error', reject)
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`codex exec exit ${code}: ${err.slice(-400)}`)))
  })
}

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
    await runCodexExec(codexArgs({ model, schemaFile, outFile, packet }), dir)
    return (await readFile(outFile, 'utf8')).trim()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export function codexDriver ({ model } = {}) {
  return async (packet) => callCodexJudge({ packet, model })
}
