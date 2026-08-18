import { readFile, readdir, cp, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const run = promisify(execFile)

export const FIXTURE_ROOT = new URL('../fixtures/', import.meta.url)

export async function loadFixtures () {
  const names = (await readdir(FIXTURE_ROOT, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()

  const fixtures = []
  for (const name of names) {
    const dir = fileURLToPath(new URL(`${name}/`, FIXTURE_ROOT))
    const manifest = JSON.parse(await readFile(join(dir, 'fixture.json'), 'utf8'))
    for (const field of ['shape', 'prompt', 'testCommand', 'testArgs', 'allowedTools']) {
      if (manifest[field] === undefined) {
        throw new Error(`fixture ${name} is missing required field ${field}`)
      }
    }
    fixtures.push({ name, dir, ...manifest })
  }
  return fixtures
}

// A fresh copy per call. The model may mutate anything inside it; nothing it does can reach
// the committed fixture, because the copy is the only thing on its path.
export async function copyFixture (name, cwd) {
  const target = join(cwd, name)
  await mkdir(target, { recursive: true })
  await cp(fileURLToPath(new URL(`${name}/`, FIXTURE_ROOT)), target, { recursive: true })
  return target
}

// Ground truth for task success. Never interpreted, only exit-code checked.
export async function runFixtureTest (dir) {
  const fixtures = await loadFixtures()
  const name = dir.split('/').filter(Boolean).at(-1)
  const fixture = fixtures.find(f => f.name === name)
  if (!fixture) throw new Error(`no fixture manifest for directory ${dir}`)

  // When this process is itself a `node --test` child, it carries NODE_TEST_CONTEXT
  // (e.g. "child-v8"). A fixture's inner `node --test` inheriting it thinks it is a
  // test-runner child and exits 0 even when its tests fail — which would make the
  // exit code here meaningless. Strip it so the fixture runs as it would in a shell.
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT

  try {
    const { stdout, stderr } = await run(fixture.testCommand, fixture.testArgs, { cwd: dir, env })
    return { passed: true, exitCode: 0, stdout, stderr }
  } catch (error) {
    return {
      passed: false,
      exitCode: error.code ?? null,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? String(error)
    }
  }
}

// Applies the committed minimal correct fix. Used ONLY to prove the fixture can go green.
// It is never shown to the model and never applied during a measured run.
export async function applyOracle (name, dir) {
  const patch = fileURLToPath(new URL(`${name}/oracle.patch`, FIXTURE_ROOT))
  await run('git', ['apply', '--unsafe-paths', `--directory=${dir}`, patch], { cwd: dir })
}
