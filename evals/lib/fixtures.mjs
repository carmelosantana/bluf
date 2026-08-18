import { readFile, readdir, cp, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { join, basename } from 'node:path'

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
    // The loader owns name/dir. A manifest declaring either would silently shadow the
    // real path, so it is rejected outright — and the spread order below makes the
    // loader's values win regardless.
    for (const reserved of ['name', 'dir']) {
      if (manifest[reserved] !== undefined) {
        throw new Error(`fixture ${name} declares reserved field ${reserved} in fixture.json; the loader sets it`)
      }
    }
    fixtures.push({ ...manifest, name, dir })
  }
  return fixtures
}

// Files that must never reach the model's copy: the oracle patches ARE the answer key,
// and fixture.json names the success oracle. Leaking them would let the model transplant
// the exact fix — and the two measured arms would read it at different rates, turning the
// success-rate difference into an artefact of the leak. applyOracle reads its patch from
// the committed FIXTURE_ROOT, never from the copy, so excluding these is safe.
function isAnswerKey (path) {
  const file = basename(path)
  return file === 'fixture.json' || file.endsWith('oracle.patch')
}

// A fresh copy per call. The model may mutate anything inside it; nothing it does can reach
// the committed fixture, because the copy is the only thing on its path.
export async function copyFixture (name, cwd) {
  const target = join(cwd, name)
  await mkdir(target, { recursive: true })
  await cp(fileURLToPath(new URL(`${name}/`, FIXTURE_ROOT)), target, {
    recursive: true,
    filter: source => !isAnswerKey(source)
  })
  return target
}

// Ground truth for task success. Never interpreted, only exit-code checked.
// The limits are parameters only so tests can exercise them cheaply; measured runs use
// the defaults (maxBuffer matches the 32 MB used for `claude` calls in runner.mjs).
// A timeout or output-buffer blowout is deliberately scored as a FAILURE, not an error:
// a "fix" that leaves the suite hanging or flooding output is not a pass.
export async function runFixtureTest (dir, { timeout = 120_000, maxBuffer = 32 * 1024 * 1024 } = {}) {
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
    const { stdout, stderr } = await run(fixture.testCommand, fixture.testArgs, { cwd: dir, env, timeout, maxBuffer })
    return { passed: true, exitCode: 0, stdout, stderr }
  } catch (error) {
    // exitCode is a number or null, never a string. execFile also reports non-exit
    // failures through error.code (e.g. 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') and a
    // timeout as a signal kill with code null — those reasons go in stderr instead.
    const reasons = []
    if (error.code !== undefined && typeof error.code !== 'number' && error.code !== null) {
      reasons.push(String(error.code))
    }
    if (error.killed) reasons.push(`killed by ${error.signal ?? 'signal'} (timeout ${timeout} ms)`)
    const stderr = [error.stderr, reasons.join('; ')].filter(Boolean).join('\n')
    return {
      passed: false,
      exitCode: typeof error.code === 'number' ? error.code : null,
      stdout: error.stdout ?? '',
      stderr: stderr || String(error)
    }
  }
}

// Applies the committed minimal correct fix. Used ONLY to prove the fixture can go green.
// It is never shown to the model and never applied during a measured run.
export async function applyOracle (name, dir) {
  const patch = fileURLToPath(new URL(`${name}/oracle.patch`, FIXTURE_ROOT))
  await run('git', ['apply', '--unsafe-paths', `--directory=${dir}`, patch], { cwd: dir })
}

// Applies a committed, deliberately INCOMPLETE fix. Used only by the contract tests to
// prove a multi-file fixture fails when any rename site is missed — the property that
// makes it a multi-file task. Never shown to the model, never applied in a measured run.
export async function applyPartialOracle (name, dir) {
  const patch = fileURLToPath(new URL(`${name}/partial-oracle.patch`, FIXTURE_ROOT))
  await run('git', ['apply', '--unsafe-paths', `--directory=${dir}`, patch], { cwd: dir })
}
