// The FROZEN judge output contract (phase2b-judge-protocol.md, Sol round-6 P1#2). A judge must return
// EXACTLY: { responses: {R1..R10: {correctness:int 1-5, completeness:int 1-5, omission:bool}},
// preferences: {P1..P5: {preference: "A"|"tie"|"B"}} } with additionalProperties:false everywhere.
// Two guarantees the protocol pins:
//   1. a STRICT parse that REJECTS duplicate object keys (not last-wins) — JSON.parse silently keeps the
//      last, which could hide a judge emitting two scores for one response; and
//   2. exact structural validation (required keys, integer/enum ranges, no extra keys).
// First schema-valid output wins; a schema-invalid output triggers exactly ONE retry, then ABORT.

// Minimal dependency-free recursive-descent JSON parser that throws on a duplicate object key. Supports
// the JSON grammar (objects, arrays, strings with escapes, numbers, true/false/null). Used only for the
// small judge packets, so clarity beats micro-optimization.
export function parseStrictJSON (text) {
  const s = String(text)
  let i = 0
  const err = msg => { throw new Error(`strict JSON parse error at ${i}: ${msg}`) }
  const ws = () => { while (i < s.length && ' \t\n\r'.includes(s[i])) i++ }
  const lit = (word, val) => { if (s.startsWith(word, i)) { i += word.length; return val } err(`expected ${word}`) }

  function parseString () {
    if (s[i] !== '"') err('expected string')
    i++
    let out = ''
    while (i < s.length) {
      const c = s[i++]
      if (c === '"') return out
      if (c === '\\') {
        const e = s[i++]
        if (e === 'u') { out += String.fromCharCode(parseInt(s.slice(i, i + 4), 16)); i += 4 }
        else out += { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[e] ?? err(`bad escape \\${e}`)
      } else out += c
    }
    err('unterminated string')
  }

  function parseNumber () {
    const start = i
    if (s[i] === '-') i++
    while (i < s.length && /[0-9]/.test(s[i])) i++
    if (s[i] === '.') { i++; while (i < s.length && /[0-9]/.test(s[i])) i++ }
    if (s[i] === 'e' || s[i] === 'E') { i++; if (s[i] === '+' || s[i] === '-') i++; while (i < s.length && /[0-9]/.test(s[i])) i++ }
    const n = Number(s.slice(start, i))
    if (Number.isNaN(n)) err('bad number')
    return n
  }

  function parseValue () {
    ws()
    const c = s[i]
    if (c === '{') return parseObject()
    if (c === '[') return parseArray()
    if (c === '"') return parseString()
    if (c === 't') return lit('true', true)
    if (c === 'f') return lit('false', false)
    if (c === 'n') return lit('null', null)
    if (c === '-' || /[0-9]/.test(c)) return parseNumber()
    err(`unexpected character ${JSON.stringify(c)}`)
  }

  function parseObject () {
    i++ // {
    const obj = {}
    const seen = new Set()
    ws()
    if (s[i] === '}') { i++; return obj }
    for (;;) {
      ws()
      const key = parseString()
      if (seen.has(key)) err(`duplicate key ${JSON.stringify(key)}`)
      seen.add(key)
      ws()
      if (s[i] !== ':') err('expected ":"'); i++
      obj[key] = parseValue()
      ws()
      if (s[i] === ',') { i++; continue }
      if (s[i] === '}') { i++; return obj }
      err('expected "," or "}"')
    }
  }

  function parseArray () {
    i++ // [
    const arr = []
    ws()
    if (s[i] === ']') { i++; return arr }
    for (;;) {
      arr.push(parseValue())
      ws()
      if (s[i] === ',') { i++; continue }
      if (s[i] === ']') { i++; return arr }
      err('expected "," or "]"')
    }
  }

  const v = parseValue()
  ws()
  if (i !== s.length) err('trailing characters after JSON value')
  return v
}

const R_LABELS = Array.from({ length: 10 }, (_, i) => `R${i + 1}`)
const P_LABELS = Array.from({ length: 5 }, (_, i) => `P${i + 1}`)
const isInt15 = v => Number.isInteger(v) && v >= 1 && v <= 5

// Validate the parsed object against the exact frozen schema. Returns an array of human-readable errors
// (empty = valid). additionalProperties:false is enforced by checking the key set exactly.
export function validateJudgeResult (obj) {
  const errs = []
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v)
  if (!isObj(obj)) return ['root is not an object']
  const topKeys = Object.keys(obj).sort()
  if (topKeys.join(',') !== 'preferences,responses') errs.push(`top keys must be exactly [responses, preferences], got [${topKeys}]`)

  const responses = obj.responses
  if (!isObj(responses)) errs.push('responses is not an object')
  else {
    const keys = Object.keys(responses).sort()
    if (keys.length !== 10 || !R_LABELS.every(l => l in responses)) errs.push(`responses keys must be exactly R1..R10, got [${keys}]`)
    for (const l of R_LABELS) {
      const r = responses[l]
      if (!isObj(r)) { errs.push(`${l} is not an object`); continue }
      const rk = Object.keys(r).sort().join(',')
      if (rk !== 'completeness,correctness,omission') errs.push(`${l} keys must be exactly [correctness, completeness, omission], got [${rk}]`)
      if (!isInt15(r.correctness)) errs.push(`${l}.correctness must be int 1-5, got ${JSON.stringify(r.correctness)}`)
      if (!isInt15(r.completeness)) errs.push(`${l}.completeness must be int 1-5, got ${JSON.stringify(r.completeness)}`)
      if (typeof r.omission !== 'boolean') errs.push(`${l}.omission must be boolean, got ${JSON.stringify(r.omission)}`)
    }
  }

  const prefs = obj.preferences
  if (!isObj(prefs)) errs.push('preferences is not an object')
  else {
    const keys = Object.keys(prefs).sort()
    if (keys.length !== 5 || !P_LABELS.every(l => l in prefs)) errs.push(`preferences keys must be exactly P1..P5, got [${keys}]`)
    for (const l of P_LABELS) {
      const p = prefs[l]
      if (!isObj(p)) { errs.push(`${l} is not an object`); continue }
      const pk = Object.keys(p).sort().join(',')
      if (pk !== 'preference') errs.push(`${l} keys must be exactly [preference], got [${pk}]`)
      if (!['A', 'tie', 'B'].includes(p.preference)) errs.push(`${l}.preference must be "A"|"tie"|"B", got ${JSON.stringify(p.preference)}`)
    }
  }
  return errs
}

// Parse (strict, duplicate-key-rejecting) + validate. Returns { ok, value, errors }. Never throws on a
// bad JUDGE output — a parse failure is reported as ok:false so the caller can apply the one-retry rule.
export function parseAndValidateJudgeResult (text) {
  let value
  try {
    value = parseStrictJSON(text)
  } catch (e) {
    return { ok: false, value: null, errors: [e.message] }
  }
  const errors = validateJudgeResult(value)
  return { ok: errors.length === 0, value: errors.length === 0 ? value : null, errors }
}
