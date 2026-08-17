import { readFile } from 'node:fs/promises'
import { checkDrift } from './lib/drift.mjs'

const main = await readFile(new URL('../output-styles/bluf.md', import.meta.url), 'utf8')
const terse = await readFile(new URL('../output-styles/bluf-terse.md', import.meta.url), 'utf8')

let result
try {
  result = checkDrift(main, terse)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

console.log(result.message)
if (!result.ok) process.exit(1)
