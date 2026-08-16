export const START = '<!-- LESS-CHATTY:SHARED-BODY:START -->'
export const END = '<!-- LESS-CHATTY:SHARED-BODY:END -->'

export function extractSharedBody (text) {
  const start = text.indexOf(START)
  if (start === -1) throw new Error(`missing ${START} marker`)
  const end = text.indexOf(END)
  if (end === -1) throw new Error(`missing ${END} marker`)
  if (end < start) throw new Error('markers are in the wrong order')
  return text.slice(start + START.length, end)
}

export function checkDrift (mainText, terseText) {
  const main = extractSharedBody(mainText)
  const terse = extractSharedBody(terseText)
  if (main === terse) return { ok: true, message: 'shared bodies match' }

  const mainLines = main.split('\n')
  const terseLines = terse.split('\n')
  const limit = Math.max(mainLines.length, terseLines.length)
  for (let i = 0; i < limit; i += 1) {
    if (mainLines[i] === terseLines[i]) continue
    return {
      ok: false,
      message: [
        `shared bodies diverge at line ${i + 1}`,
        `  less-chatty.md:       ${JSON.stringify(mainLines[i] ?? null)}`,
        `  less-chatty-terse.md: ${JSON.stringify(terseLines[i] ?? null)}`
      ].join('\n')
    }
  }
  return { ok: false, message: 'shared bodies diverge' }
}
