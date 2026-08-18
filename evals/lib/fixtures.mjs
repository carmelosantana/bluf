import { readFile, readdir, cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { join, basename, sep } from 'node:path'

const run = promisify(execFile)

export const FIXTURE_ROOT = new URL('../fixtures/', import.meta.url)

// The root parameter exists ONLY so the test suite can point the loader at a
// synthetic fixture tree and prove its rejections fire; every production caller
// uses the committed FIXTURE_ROOT default.
export async function loadFixtures (root = FIXTURE_ROOT) {
  const names = (await readdir(root, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()

  const fixtures = []
  for (const name of names) {
    const dir = fileURLToPath(new URL(`${name}/`, root))
    const manifest = JSON.parse(await readFile(join(dir, 'fixture.json'), 'utf8'))
    for (const field of ['shape', 'prompt', 'testCommand', 'testArgs', 'allowedTools']) {
      if (manifest[field] === undefined) {
        throw new Error(`fixture ${name} is missing required field ${field}`)
      }
    }
    // The loader owns name/dir/id. A manifest declaring any of them would silently
    // shadow the real value, so it is rejected outright — and the spread order below
    // makes the loader's values win regardless.
    for (const reserved of ['name', 'dir', 'id']) {
      if (manifest[reserved] !== undefined) {
        throw new Error(`fixture ${name} declares reserved field ${reserved} in fixture.json; the loader sets it`)
      }
    }
    // hiddenCommand/hiddenArgs are optional — only the hidden-edges shape ships a
    // hidden suite — but they travel as a pair: one without the other would make
    // runHiddenTest throw only at scoring time, after money was spent on the run.
    if ((manifest.hiddenCommand === undefined) !== (manifest.hiddenArgs === undefined)) {
      throw new Error(`fixture ${name} declares only one of hiddenCommand/hiddenArgs; they travel as a pair`)
    }
    // And the shape that exists to run a hidden suite cannot omit it: a hidden-edges
    // fixture without a hidden command would score its whole reason for existing as
    // silently absent.
    if (manifest.shape === 'hidden-edges' && manifest.hiddenCommand === undefined) {
      throw new Error(`fixture ${name} has shape hidden-edges but declares no hiddenCommand/hiddenArgs; the hidden suite is the point of that shape`)
    }
    // The hidden suite's on-disk assets travel with the command pair. hiddenPaths names
    // the subtrees copyFixture must WITHHOLD from the model's copy and runHiddenTest
    // must inject back at scoring time; hiddenScripts carries the package.json scripts
    // the hidden command needs, injected alongside the files so the committed
    // package.json — which the model reads — never advertises them. A hidden command
    // without declared paths would leak the hidden suite straight into the copy, where
    // a model with Read/Glob/Grep/Bash could find the edge cases and fix for them
    // directly — the exact confound this declaration exists to close. So the
    // declaration is mandatory, and hidden assets without a hidden command are
    // rejected too: orphaned assets would be withheld from the copy but never run.
    if ((manifest.hiddenPaths !== undefined || manifest.hiddenScripts !== undefined) && manifest.hiddenCommand === undefined) {
      throw new Error(`fixture ${name} declares hiddenPaths/hiddenScripts without hiddenCommand; hidden assets belong to a hidden suite`)
    }
    if (manifest.hiddenCommand !== undefined) {
      if (!Array.isArray(manifest.hiddenPaths) || manifest.hiddenPaths.length === 0) {
        throw new Error(
          `fixture ${name} declares a hidden suite but no hiddenPaths; without the declaration ` +
          'copyFixture would copy the hidden suite straight into the model\'s working tree'
        )
      }
      for (const path of manifest.hiddenPaths) {
        if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') || path.split('/').includes('..')) {
          throw new Error(`fixture ${name} declares an unsafe hiddenPaths entry ${JSON.stringify(path)}; entries must be relative paths inside the fixture`)
        }
      }
      if (manifest.hiddenScripts !== undefined) {
        if (manifest.hiddenScripts === null || typeof manifest.hiddenScripts !== 'object' ||
            Array.isArray(manifest.hiddenScripts) ||
            Object.values(manifest.hiddenScripts).some(script => typeof script !== 'string')) {
          throw new Error(`fixture ${name} declares hiddenScripts that is not an object of script strings`)
        }
      }
    }
    // `id` is a deliberate alias of `name`: scheduleSweep keys its cases on `.id`, and
    // without the alias every schedule entry would carry caseId: undefined — the
    // rotation would still "work" while keying every case to the same undefined slot.
    fixtures.push({ ...manifest, name, id: name, dir })
  }
  return fixtures
}

// Files that must never reach the model's copy: every committed patch is an answer key
// (oracle.patch and partial-oracle.patch are the fix; naive.patch is the exact wrong
// answer the contract tests measure against, which is just as disqualifying to leak),
// and fixture.json names the success oracle AND the hidden suite's command. Leaking any
// of them would let the model transplant the fix or discover what the hidden suite runs
// — and the two measured arms would read it at different rates, turning the success-rate
// difference into an artefact of the leak. The filter is deliberately every `*.patch`,
// not a basename list: a future patch variant must be excluded by default, not leaked by
// default. applyOracle/applyNaive read their patches from the committed FIXTURE_ROOT,
// never from the copy, so excluding these is safe. The hidden TEST FILES are answer key
// too — a model with Read/Glob/Grep/Bash in the copy could otherwise discover them and
// fix for the edge cases directly, turning adequacy into a measure of who went poking
// around — but they live in whole subtrees, not recognisable basenames, so copyFixture
// withholds them from the manifest's hiddenPaths declaration rather than from here.
function isAnswerKey (path) {
  const file = basename(path)
  return file === 'fixture.json' || file.endsWith('.patch')
}

// A fresh copy per call. The model may mutate anything inside it; nothing it does can reach
// the committed fixture, because the copy is the only thing on its path. The copy contains
// NO trace of the hidden suite: not the hiddenPaths subtrees (withheld here) and not the
// hiddenScripts entries (never present in the committed package.json in the first place —
// the loader's contract, enforced by test on every copied byte). runHiddenTest injects
// both back at scoring time, after taskPassed has been scored.
export async function copyFixture (name, cwd) {
  const source = fileURLToPath(new URL(`${name}/`, FIXTURE_ROOT))
  // The manifest is read from the committed fixture, never the copy — it IS the file
  // the filter below excludes.
  const manifest = JSON.parse(await readFile(join(source, 'fixture.json'), 'utf8'))
  const withheld = (manifest.hiddenPaths ?? []).map(path => join(source, path))
  const target = join(cwd, name)
  await mkdir(target, { recursive: true })
  await cp(source, target, {
    recursive: true,
    filter: entry => !isAnswerKey(entry) &&
      !withheld.some(path => entry === path || entry.startsWith(path + sep))
  })
  return target
}

// Ground truth for task success. Never interpreted, only exit-code checked.
// The limits are parameters only so tests can exercise them cheaply; measured runs use
// the defaults (maxBuffer matches the 32 MB used for `claude` calls in runner.mjs).
// A timeout or output-buffer blowout is deliberately scored as a FAILURE, not an error:
// a "fix" that leaves the suite hanging or flooding output is not a pass.
export async function runFixtureTest (dir, { timeout = 120_000, maxBuffer = 32 * 1024 * 1024 } = {}) {
  const fixture = await fixtureForDir(dir)
  return runScoredCommand(fixture.testCommand, fixture.testArgs, dir, { timeout, maxBuffer })
}

// Ground truth for ADEQUACY: the hidden suite, run after a measured run and never shown
// to the model — the copy never contained it; injectHiddenSuite puts it there right here,
// at scoring time. Same contract as runFixtureTest — exit-code checked, never interpreted,
// same explicit limits, same NODE_TEST_CONTEXT strip. A fixture without a hidden suite
// throws rather than returning anything: the caller must score it null, and neither a
// silent pass nor a silent fail is an acceptable stand-in for "there is no hidden suite".
export async function runHiddenTest (dir, { timeout = 120_000, maxBuffer = 32 * 1024 * 1024 } = {}) {
  const fixture = await fixtureForDir(dir)
  if (fixture.hiddenCommand === undefined) {
    throw new Error(`fixture ${fixture.name} has no hidden suite; score hiddenPassed as null, never run this`)
  }
  try {
    await injectHiddenSuite(fixture, dir)
  } catch (error) {
    // The copy is whatever the model left behind. A copy whose package.json the model
    // mangled beyond JSON.parse cannot receive the hidden script — and a "fix" that
    // leaves the project unrunnable is a FAILURE, same as a hang or a flood, never an
    // error that loses the paid row. An injection broken on OUR side (a missing
    // committed hiddenPaths directory, say) surfaces the same way, and the free suite
    // plus the pre-spend oracle gate both require an injected hidden PASS, so that
    // defect cannot reach a paid run silently.
    return {
      passed: false,
      exitCode: null,
      stdout: '',
      stderr: `hidden-suite injection failed: ${error?.message ?? error}`
    }
  }
  return runScoredCommand(fixture.hiddenCommand, fixture.hiddenArgs, dir, { timeout, maxBuffer })
}

// Puts the hidden suite into a copy at SCORING time — copyFixture withheld it, so until
// this runs the model's working tree carried no trace of it. The hiddenPaths subtrees
// are replaced WHOLESALE (rm, then cp from the committed fixture): a file the model
// happened to create under a hidden path must not ride along in the adequacy run, and
// the hidden run must execute exactly the committed suite, nothing else. hiddenScripts
// are merged into the copy's package.json last, so the hidden command has its script.
async function injectHiddenSuite (fixture, dir) {
  const source = fileURLToPath(new URL(`${fixture.name}/`, FIXTURE_ROOT))
  for (const path of fixture.hiddenPaths) {
    const dest = join(dir, path)
    await rm(dest, { recursive: true, force: true })
    await cp(join(source, path), dest, { recursive: true })
  }
  if (fixture.hiddenScripts !== undefined) {
    const pkgPath = join(dir, 'package.json')
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    pkg.scripts = { ...pkg.scripts, ...fixture.hiddenScripts }
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  }
}

async function fixtureForDir (dir) {
  const fixtures = await loadFixtures()
  const name = dir.split('/').filter(Boolean).at(-1)
  const fixture = fixtures.find(f => f.name === name)
  if (!fixture) throw new Error(`no fixture manifest for directory ${dir}`)
  return fixture
}

async function runScoredCommand (command, args, dir, { timeout, maxBuffer }) {
  // When this process is itself a `node --test` child, it carries NODE_TEST_CONTEXT
  // (e.g. "child-v8"). A fixture's inner `node --test` inheriting it thinks it is a
  // test-runner child and exits 0 even when its tests fail — which would make the
  // exit code here meaningless. Strip it so the fixture runs as it would in a shell.
  // This strip is load-bearing for BOTH suites: a runHiddenTest that inherited it
  // would score every hidden suite as passing and turn adequacy into a fiction.
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT

  try {
    const { stdout, stderr } = await run(command, args, { cwd: dir, env, timeout, maxBuffer })
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

// Applies a committed, deliberately NAIVE fix: one that makes the visible suite pass
// while missing the documented edge cases the hidden suite covers. Used only by the
// contract tests to prove the visible/hidden split is real — if the naive fix passed
// the hidden suite too, the fixture would measure nothing. Never shown to the model,
// never applied in a measured run.
export async function applyNaive (name, dir) {
  const patch = fileURLToPath(new URL(`${name}/naive.patch`, FIXTURE_ROOT))
  await run('git', ['apply', '--unsafe-paths', `--directory=${dir}`, patch], { cwd: dir })
}
