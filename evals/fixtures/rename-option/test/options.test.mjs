import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaults, resolveOptions } from '../src/config.mjs'
import { requestWithRetry } from '../src/http-client.mjs'

test('the option is named maxRetries and keeps its default of 3', () => {
  assert.equal(defaults.maxRetries, 3)
  assert.equal('retryLimit' in defaults, false, 'the old name must be gone from the defaults')
})

test('resolveOptions accepts maxRetries and rejects the old name', () => {
  assert.equal(resolveOptions({ maxRetries: 5 }).maxRetries, 5)
  assert.throws(() => resolveOptions({ retryLimit: 5 }), /unknown option/)
})

test('the client honours maxRetries', async () => {
  let calls = 0
  await assert.rejects(
    requestWithRetry(() => { calls++; throw new Error('down') }, { maxRetries: 2 }),
    /down/
  )
  assert.equal(calls, 3, 'one initial attempt plus maxRetries extra tries')

  const value = await requestWithRetry(
    attempt => attempt < 1 ? Promise.reject(new Error('flaky')) : 'ok',
    { maxRetries: 2 }
  )
  assert.equal(value, 'ok')
})

test('no file under src/ or docs/ still uses the old option name', async () => {
  // This is the clause that makes the task multi-file: renaming the definition alone
  // cannot pass while a consumer or the documentation still says retryLimit.
  for (const dirName of ['src', 'docs']) {
    const dir = fileURLToPath(new URL(`../${dirName}/`, import.meta.url))
    for (const file of await readdir(dir)) {
      const text = await readFile(join(dir, file), 'utf8')
      assert.ok(!text.includes('retryLimit'), `${dirName}/${file} still mentions the old option name`)
    }
  }
})
