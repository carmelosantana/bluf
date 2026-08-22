// Exploratory clean-room replication. NOT part of the repo harness.
//
// Question: do the published output-reduction figures survive removing the operator's
// config from the measured environment? Every previous call loaded ~1,248 tokens of user
// settings (plugins, MCP) because the harness never passed --setting-sources.
//
// Method: a temp project directory carrying the style at PROJECT level, so
// --setting-sources project excludes the operator's machine while still letting the style
// load. Passing --setting-sources project WITHOUT a project-level style silently measures
// Default against Default — that mistake is the reason this script installs the file.

import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = promisify(execFile)
const REPO = '/home/carmelo/Projects/Claude/less-chatty'
const MODEL = 'claude-opus-5'
const OUT = process.argv[2]

const cases = (await readFile(join(REPO, 'evals/prompts.jsonl'), 'utf8'))
  .trim().split('\n').map(l => JSON.parse(l))

// One temp project reused across calls: the style install is identical for every call, and
// --tools "" means nothing can write into it. Rebuilding it per call would only add noise.
const proj = await mkdtemp(join(tmpdir(), 'bluf-cleanroom-'))
await mkdir(join(proj, '.claude/output-styles'), { recursive: true })
await copyFile(join(REPO, 'output-styles/bluf.md'), join(proj, '.claude/output-styles/bluf.md'))

async function call (prompt, style) {
  const args = [
    '-p', prompt,
    '--output-format', 'json',
    '--model', MODEL,
    '--tools', '',
    '--setting-sources', 'project',
    '--settings', JSON.stringify({ outputStyle: style })
  ]
  const { stdout } = await run('claude', args, { cwd: proj, maxBuffer: 32 * 1024 * 1024 })
  const p = JSON.parse(stdout)
  if (p.is_error) throw new Error(`errored: ${p.subtype ?? 'unknown'}`)
  const u = p.usage
  return {
    output: u.output_tokens,
    input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    chars: (p.result ?? '').length
  }
}

const rows = []
for (const [i, c] of cases.entries()) {
  // Alternate which condition leads, so cache-creation cost does not always land on one arm.
  const order = i % 2 === 0 ? ['Default', 'BLUF'] : ['BLUF', 'Default']
  const got = {}
  for (const style of order) {
    try {
      got[style] = await call(c.prompt, style)
      process.stderr.write(`${c.id} ${style}: out ${got[style].output} in ${got[style].input}\n`)
    } catch (e) {
      process.stderr.write(`${c.id} ${style}: FAILED ${e.message}\n`)
      got[style] = null
    }
  }
  rows.push({ id: c.id, category: c.category, base: got.Default, bluf: got.BLUF })
  await writeFile(OUT, JSON.stringify(rows, null, 1))
}

console.error(`\nwrote ${OUT}`)
