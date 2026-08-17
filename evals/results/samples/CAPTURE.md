# How these samples were captured

The `.jsonl` result files record token counts but not response text. These `.txt` files
record response text but not token counts. This file joins the two.

Every sample was captured with a single `claude -p` invocation in an empty temporary
directory, with tools disabled. The `output_tokens` figure below is the
`usage.output_tokens` field of that invocation's JSON response.

**These captures predate the rename to BLUF.** They were taken while the style was named
`Less Chatty`, so that is the value that was passed to `outputStyle` at the time. The rule
text is byte-identical to what ships as BLUF 0.2.0 — only the `name:` field changed — and
the commands below give the value that works today.

## Illustrative before/after pair

These two are a separate capture, taken after a measured sweep. **They are not rows in
`report.md`.** Run-to-run variation puts the same prompt and model at different figures on
different days; this pair happened to land at 586 → 183.

Prompt: `In git, what does --no-ff do on a merge?`

| File | `outputStyle` | `output_tokens` |
| --- | --- | ---: |
| `git-no-ff.claude-opus-5.baseline.txt` | `Default` | 586 |
| `git-no-ff.claude-opus-5.0.2.0.txt` | `BLUF` | 183 |

Command used for each, differing only in the `outputStyle` value:

```bash
cd "$(mktemp -d)" && claude -p "In git, what does --no-ff do on a merge?" --output-format json --model claude-opus-5 --tools "" --settings '{"outputStyle":"Default"}'
```

## Regression-gate samples

These record the four hand-inspected regression cases, so the gate results in the README
can be checked rather than taken on trust. `.0.1.0` files were captured against the
retracted rule set, `.0.2.0` against the shipped one. All are `claude-opus-5` unless the
filename says `claude-fable-5`.

| Case | What the gate checks | Corrects |
| --- | --- | --- |
| `401-no-evidence` | The response must not assert a cause the evidence does not support | [i-have-adhd#99](https://github.com/ayghri/i-have-adhd/issues/99) |
| `docker-cache-miss` | A long list must be grouped and ranked, never truncated | [i-have-adhd#96](https://github.com/ayghri/i-have-adhd/issues/96) |
| `scheduled-jobs` | An options question must still return ranked options | precedence clause |
| `port-default` | A short answer must stay short, with no bullet block | three-line threshold |

Token counts for these were not recorded at capture time; they are illustrative of shape,
not of size. For sizes, use `report.md`.
