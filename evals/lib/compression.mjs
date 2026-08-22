// The over-compression detector.
//
// Inspired by the `lazy_comments` check in Aider's benchmark harness; attribution to
// Exercism, whose exercises are MIT-licensed. Nothing here is taken from
// Aider-AI/polyglot-benchmark, which carries no licence — every pattern below was written
// from scratch for this project, against this project's own positive and negative controls
// (evals/test/compression.test.mjs).
//
// Why this exists: Component 3 measured the BLUF style cutting prose characters 31.5%
// while tool-call characters stayed flat. A style that compresses prose that hard can
// start standing content off behind placeholders instead of writing it, and a token count
// cannot tell a short-and-complete answer from a short-because-elided one. This can — but
// only if it is trustworthy. A false positive here poisons the adequacy number, so every
// pattern is deliberately narrow and carries a negative control in the test file. A zero
// count from this detector is weak evidence (it finds only the elisions it has patterns
// for); a nonzero count is checkable by hand, because every hit carries the line number
// and the offending excerpt.

// Comment leaders we treat as opening a comment: //, /*, #, <!--, or a line-leading `*`
// (block-comment continuation). Each must be preceded by whitespace or start-of-line so
// that `https://...` and `[...spread]` never read as comments.
const LEADER = String.raw`(?:(?:^|\s)(?:\/\/|\/\*|#|<!--)|^\s*\*)`

export const ELISION_PATTERNS = [
  {
    name: 'comment-ellipsis',
    // Catches: a comment that opens with "..." standing in for code the response never wrote.
    catches:
      'a comment opening with an ellipsis in place of code the response never wrote — "// ... rest of the implementation", "# ... remaining cases omitted"',
    regex: new RegExp(String.raw`${LEADER}\s*(?:\.{3}|…)`)
  },
  {
    name: 'truncation-marker',
    // Catches: an explicit admission that content was cut.
    catches:
      'an explicit admission that content was cut — "... (truncated for brevity)", "omitted for brevity" — the response telling you it is incomplete',
    regex: /(?:\.{3}|…)\s*\(?[^)\n]*\b(?:truncated|omitted|snipped|elided|skipped)\b|\b(?:truncated|omitted|snipped|elided|skipped)\b[^.,\n]{0,60}\bfor\s+(?:brevity|space)\b|\bfor\s+brevity\b/i
  },
  {
    name: 'unchanged-placeholder',
    // Catches: a comment or bare parenthetical standing in for the content it calls unchanged.
    catches:
      'a comment or bare parenthetical whose entire body is "unchanged" / "same as before" / "no changes", replacing the content it claims is unchanged',
    regex: new RegExp(
      String.raw`${LEADER}\s*(?:\.{3}\s*)?(?:unchanged|same\s+as\s+(?:above|before)|no\s+changes?)[\s.…]*(?:\*\/|-->)?\s*$` +
        '|' +
        String.raw`^\s*\((?:unchanged|same\s+as\s+(?:above|before)|no\s+changes?)\)\s*$`,
      'i'
    )
  },
  {
    name: 'lazy-todo',
    // Catches: a TODO/FIXME deferring the very work the response claims to deliver.
    catches:
      'a TODO/FIXME that defers the very work the response claims to deliver — "TODO: handle the other cases", "TODO: ..." — as opposed to a concrete named follow-up, which is legitimate',
    regex: new RegExp(
      String.raw`${LEADER}\s*(?:TODO|FIXME)\b` +
        String.raw`(?:[^\n]*\b(?:handle|implement|add|finish|complete|do|fill\s+in)\s+(?:the\s+)?(?:rest\b|remaining\b|others?\b|other\s+cases?\b|everything\s+else\b)` +
        String.raw`|\s*[:\-]?\s*(?:\.{3}|…)\s*$)`,
      'i'
    )
  }
]

const EXCERPT_LENGTH = 160

// Scan a text for elision placeholders. Returns one entry per (line, pattern) hit —
// { pattern, line, excerpt } — with `line` 1-indexed, so every flag can be checked by hand
// against the source. A bare count would be unfalsifiable, and this project does not
// publish unfalsifiable numbers. Empty or non-string input returns [].
export const detectElisions = text => {
  if (typeof text !== 'string' || text.length === 0) return []
  const hits = []
  const lines = text.split('\n')
  for (const [index, rawLine] of lines.entries()) {
    for (const { name, regex } of ELISION_PATTERNS) {
      if (regex.test(rawLine)) {
        hits.push({
          pattern: name,
          line: index + 1,
          excerpt: rawLine.trim().slice(0, EXCERPT_LENGTH)
        })
      }
    }
  }
  return hits
}

// Run detectElisions over the assistant TEXT blocks of a parsed stream-json event array —
// the shape committed at evals/results/agentic-transcripts/*.jsonl:
//   { type: 'assistant', message: { role, content: [ {type:'text',text}, {type:'tool_use',...} ] } }
// Thinking blocks, tool_use inputs, tool results, and the final result payload are all
// skipped on purpose: the detector judges what the model SAID to the user, and file content
// written through tools is scored by the fixture's own tests, not by pattern-matching.
// Each hit gains `eventIndex` (position in the event array) so it can be found by hand;
// `line` stays 1-indexed within the text block that contains it.
export const scanTranscript = events => {
  if (!Array.isArray(events)) return []
  const hits = []
  for (const [eventIndex, event] of events.entries()) {
    if (event?.type !== 'assistant') continue
    const content = event.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue
      for (const hit of detectElisions(block.text)) {
        hits.push({ ...hit, eventIndex })
      }
    }
  }
  return hits
}
