// The over-compression detector's contract, pinned before the detector existed.
//
// Component 3 measured the style cutting prose characters 31.5% while leaving tool-call
// characters flat. A style that compresses prose that hard can start standing content off
// behind placeholders instead of writing it — "// ... rest of the implementation",
// "/* unchanged */" — and a token count cannot see that. This detector can, but only if it
// is trustworthy: a detector with false positives produces an adequacy number nobody can
// trust, which is worse than no number. So the structure of this file is the deliverable:
//
//   - CONTROLS below carries, for every pattern, a positive example that must fire and a
//     negative example that must fire NOTHING (not merely "not this pattern").
//   - A set-equality test forces CONTROLS to cover ELISION_PATTERNS exactly, so a future
//     pattern cannot be added without bringing its own negative control.
//
// These tests make no API call and read nothing outside the repo.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { ELISION_PATTERNS, detectElisions, scanTranscript } from '../lib/compression.mjs'

// --- The control table: one positive and one negative per pattern, no exceptions ---------
//
// The negative is asserted to produce ZERO detections across ALL patterns, not just its own.
// A negative that trips a sibling pattern is still a false positive in production.

const CONTROLS = {
  // A comment that opens with an ellipsis is standing in for code that was never written.
  'comment-ellipsis': {
    positives: [
      '// ... rest of the implementation',
      '# ... remaining cases omitted',
      '/* ... */',
      '<!-- ... existing markup ... -->'
    ],
    negatives: [
      "console.log('...')", // an ellipsis as data, not as elision
      'see https://example.com/... for details', // a URL's // is not a comment leader
      'const spread = [...items]' // spread syntax is code, not a placeholder
    ]
  },
  // An explicit admission that content was cut: "truncated for brevity", "... omitted".
  'truncation-marker': {
    positives: [
      '... (truncated for brevity)',
      'I have omitted the error handling for brevity.',
      '… (remaining output snipped)'
    ],
    negatives: [
      'The kernel truncated the log file at 4 KB.', // a fact about the system, not an elision
      'No fields were omitted from the serialized row.' // "omitted" without ellipsis or brevity claim
    ]
  },
  // A comment whose entire body is "unchanged" (or a bare "(unchanged)" line) replaces the
  // content it claims is unchanged.
  'unchanged-placeholder': {
    positives: ['/* unchanged */', '// unchanged', '# ... unchanged ...', '(unchanged)'],
    negatives: [
      '// unchanged behavior here is covered by the existing test', // describes, does not elide
      'The public API is unchanged.' // prose statement of fact
    ]
  },
  // A TODO that defers the very work the response claims to deliver ("handle the rest"),
  // as opposed to naming a concrete future follow-up.
  'lazy-todo': {
    positives: [
      '// TODO: handle the other cases',
      '# TODO: implement the rest',
      '// TODO: ...'
    ],
    negatives: [
      '// TODO: add IPv6 support once the upstream lands', // concrete follow-up, not elision
      '// TODO: bump the fixture to Node 24 when CI images update'
    ]
  }
}

test('every pattern has a control entry, and every control entry has a pattern', () => {
  const patternNames = ELISION_PATTERNS.map(pattern => pattern.name).sort()
  const controlNames = Object.keys(CONTROLS).sort()
  assert.deepEqual(
    patternNames,
    controlNames,
    'a pattern was added or renamed without a matching positive/negative control pair'
  )
  // No duplicate names hiding behind the sort.
  assert.equal(new Set(patternNames).size, patternNames.length)
})

test('every pattern carries a name, a regex, and a stated failure it catches', () => {
  for (const pattern of ELISION_PATTERNS) {
    assert.equal(typeof pattern.name, 'string')
    assert.ok(pattern.regex instanceof RegExp, `${pattern.name}: regex must be a RegExp`)
    assert.equal(typeof pattern.catches, 'string')
    assert.ok(pattern.catches.length > 0, `${pattern.name}: must state what failure it catches`)
  }
})

test('each positive control fires its own pattern', () => {
  for (const [name, { positives }] of Object.entries(CONTROLS)) {
    for (const positive of positives) {
      const hits = detectElisions(positive)
      assert.ok(
        hits.some(hit => hit.pattern === name),
        `${name}: expected to fire on ${JSON.stringify(positive)}, got ${JSON.stringify(hits)}`
      )
    }
  }
})

test('each negative control fires nothing at all', () => {
  for (const [name, { negatives }] of Object.entries(CONTROLS)) {
    for (const negative of negatives) {
      const hits = detectElisions(negative)
      assert.deepEqual(
        hits,
        [],
        `${name}: negative control ${JSON.stringify(negative)} produced ${JSON.stringify(hits)}`
      )
    }
  }
})

// --- The specific strings the plan says MUST be flagged ----------------------------------

const MUST_FLAG = [
  '// ... rest of the implementation',
  '# ... remaining cases omitted',
  '/* unchanged */',
  '// TODO: handle the other cases',
  '... (truncated for brevity)'
]

test('the five required strings are all flagged', () => {
  for (const text of MUST_FLAG) {
    const hits = detectElisions(text)
    assert.ok(hits.length >= 1, `expected a flag on ${JSON.stringify(text)}`)
  }
})

// --- The specific things the plan says MUST NOT be flagged -------------------------------

test('an ellipsis as string data is not flagged', () => {
  assert.deepEqual(detectElisions("console.log('...')"), [])
})

test('quoted command output ending in an ellipsis, inside a fenced block, is not flagged', () => {
  const text = [
    'Here is the build output:',
    '',
    '```',
    '$ cargo build',
    '   Compiling less-chatty v0.1.0 …',
    '    Finished dev profile in 2.41s',
    '```'
  ].join('\n')
  assert.deepEqual(detectElisions(text), [])
})

test('a TODO naming a concrete follow-up is not flagged', () => {
  assert.deepEqual(detectElisions('// TODO: add IPv6 support once the upstream lands'), [])
})

test('a unified-diff hunk header is not flagged', () => {
  assert.deepEqual(detectElisions('@@ -1,4 +1,6 @@'), [])
})

// --- Falsifiability: line numbers and excerpts, not counts -------------------------------

test('a hit carries the 1-indexed line number and an excerpt a human can check', () => {
  const text = [
    'The fix is one guard clause.',
    '',
    'function handle(request) {',
    '  // ... rest of the implementation',
    '}'
  ].join('\n')
  const hits = detectElisions(text)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].pattern, 'comment-ellipsis')
  assert.equal(hits[0].line, 4)
  assert.ok(hits[0].excerpt.includes('rest of the implementation'))
})

test('two elisions on different lines are reported separately', () => {
  const text = '/* unchanged */\nreal code here\n// TODO: handle the other cases'
  const hits = detectElisions(text)
  assert.deepEqual(
    hits.map(hit => [hit.pattern, hit.line]),
    [
      ['unchanged-placeholder', 1],
      ['lazy-todo', 3]
    ]
  )
})

// --- Empty and degenerate input -----------------------------------------------------------

test('empty input returns an empty array and does not throw', () => {
  assert.deepEqual(detectElisions(''), [])
  assert.deepEqual(detectElisions(), [])
  assert.deepEqual(detectElisions(null), [])
  assert.deepEqual(scanTranscript([]), [])
  assert.deepEqual(scanTranscript(), [])
  assert.deepEqual(scanTranscript(null), [])
})

// --- scanTranscript: assistant text blocks only -------------------------------------------
//
// Events mirror the committed stream-json shape (evals/results/agentic-transcripts/*.jsonl):
// one object per line, assistant events shaped
//   { type: 'assistant', message: { role, content: [ {type:'text',text}, {type:'tool_use',...} ] } }

const EVENTS = [
  { type: 'system', subtype: 'init', cwd: '/tmp/x' },
  {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '// ... rest of the implementation', signature: 'x' },
        {
          type: 'tool_use',
          id: 'toolu_01',
          name: 'Write',
          input: { file_path: '/tmp/x/a.mjs', content: '// ... rest of the implementation' }
        }
      ]
    }
  },
  {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', content: '/* unchanged */' }] }
  },
  {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Fixed. The guard clause rejects empty ids.' },
        { type: 'text', text: 'Patch applied:\n// ... rest of the implementation' }
      ]
    }
  },
  { type: 'result', subtype: 'success', result: '// TODO: handle the other cases' }
]

test('scanTranscript flags assistant text blocks only', () => {
  const hits = scanTranscript(EVENTS)
  // The tool_use content, thinking block, tool_result, and result payload all contain
  // flaggable strings; only the assistant text block's elision may be reported.
  assert.equal(hits.length, 1)
  assert.equal(hits[0].pattern, 'comment-ellipsis')
  assert.equal(hits[0].line, 2, 'line is 1-indexed within the text block that contains it')
  assert.ok(hits[0].excerpt.includes('rest of the implementation'))
})

test('scanTranscript on a clean transcript returns an empty array', () => {
  const clean = [
    { type: 'system', subtype: 'init' },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done. All 12 tests pass.' }] } }
  ]
  assert.deepEqual(scanTranscript(clean), [])
})

test('scanTranscript tolerates events with no message or malformed content', () => {
  const ragged = [
    { type: 'assistant' },
    { type: 'assistant', message: {} },
    { type: 'assistant', message: { content: 'not-an-array' } },
    { type: 'assistant', message: { content: [{ type: 'text' }] } },
    { type: 'rate_limit_event', rate_limit_info: {} }
  ]
  assert.deepEqual(scanTranscript(ragged), [])
})

// --- Shape check against a committed transcript --------------------------------------------
//
// The committed reference transcript proves the event shape scanTranscript assumes is the
// shape the harness actually writes. Read-only; no API call; scanning it must not throw.

test('scanTranscript accepts the committed reference transcript', async () => {
  const raw = await readFile(
    new URL('../results/probes/result-shape-stream.jsonl', import.meta.url),
    'utf8'
  )
  const events = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  assert.ok(events.some(event => event.type === 'assistant'), 'reference transcript has assistant events')
  const hits = scanTranscript(events)
  assert.ok(Array.isArray(hits))
  for (const hit of hits) {
    assert.equal(typeof hit.pattern, 'string')
    assert.equal(typeof hit.line, 'number')
    assert.equal(typeof hit.excerpt, 'string')
  }
})
