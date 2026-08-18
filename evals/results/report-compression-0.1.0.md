# Over-compression scan (0.1.0)

**Result: zero elisions found, in either arm, anywhere in the committed corpus.**

This scan costs nothing. It runs `evals/lib/compression.mjs` over evidence this repository
has already paid for, and it exists so the adequacy question gets whatever answer the
existing data can give before any further money is spent on it.

Every figure below is recomputed from the committed files by
`evals/test/compression-report.test.mjs`, which makes no API call.

## What was scanned

| corpus | files | what it is |
| --- | --- | --- |
| `samples/*.txt` | 12 | verbatim prose responses — 1 unstyled, 11 styled |
| `agentic-transcripts/*.jsonl` | 18 | the raw stream-json of all 18 agentic calls, 9 per arm |

The `.jsonl` result rows store no response text, so `samples/` is the only place committed
prose exists; `samples/CAPTURE.md` records how each was captured. For the transcripts only
assistant **text** blocks are scanned — never `thinking`, `tool_use`, or `tool_result`, so a
flaggable string inside a file the model happened to read cannot be attributed to the model.

## What it looks for

Four patterns, each with the failure it catches: `comment-ellipsis`, `truncation-marker`,
`unchanged-placeholder`, `lazy-todo`. The target is a response that *looks* complete and short
while having stood content off behind a placeholder — `// ... rest of the implementation`,
`/* unchanged */`, `# ... remaining cases omitted`.

Every pattern ships a positive example that must fire **and** a negative example that must not,
and the test asserts set equality between the control table and the pattern list, so a pattern
cannot be added without both. That structure matters more than the patterns: a detector with
false positives would produce an adequacy number nobody could trust.

The check is *inspired by* Aider's `lazy_comments` check, with attribution to Exercism, whose
exercises are MIT. Nothing was taken from `Aider-AI/polyglot-benchmark`, which carries no
licence. Every pattern here was written from scratch.

## Result

| corpus | condition | files | elisions |
| --- | --- | --- | --- |
| samples | baseline | 1 | 0 |
| samples | styled | 11 | 0 |
| transcripts | baseline | 9 | 0 |
| transcripts | bluf | 9 | 0 |

No excerpts are quoted below because there are none to quote.

## How much this is worth, stated plainly

**A zero is weak evidence, and it is weak in three separate ways.**

- **A pattern detector finds the elisions it has patterns for.** Four patterns is not a
  taxonomy of ways to omit something. A response that simply stopped short — no placeholder,
  no marker, just less — is invisible to this check, and that is the likelier failure mode for
  a style whose whole instruction is to be brief.
- **The corpus is small and uneven.** Twelve prose samples against one unstyled control, and
  eighteen agentic transcripts from three fixtures on one model. The styled prose samples also
  span two retired rule versions (0.1.0 and 0.2.0), not the shipped one.
- **A clean scan is not adequacy.** It says the style did not visibly announce that it left
  something out. It does not say the answers were complete. Only execution-verified evidence
  can say that, which is what the hidden-edge-case fixture exists for.

Two guards make this particular zero mean more than "the scanner did not look". The test pins
the corpus size, so a silently shrinking corpus fails rather than scoring clean; and it plants
a known elision into a real committed sample and a real committed transcript and requires the
scanner to fire on both. It also asserts all 18 transcripts contain assistant prose at all —
a corpus with nothing to flag would score zero forever.

**What this scan does support:** across 30 committed artefacts, the style produced no
placeholder-style elisions, and neither did the unstyled arm. It is a null result, reported
because a null result that was actually measured is worth more than an adequacy claim that
was not.
