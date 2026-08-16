# How these samples were captured

The `.jsonl` result files record token counts but not response text. These `.txt` files
record response text but not token counts. This file joins the two.

Every sample was captured with a single `claude -p` invocation in an empty temporary
directory, with tools disabled. The `output_tokens` figure below is the
`usage.output_tokens` field of that invocation's JSON response.

## Illustrative before/after pair

These two are a separate capture, taken after the measured sweep. **They are not rows in
`report.md`.** The sweep's own `git-no-ff` row on `claude-opus-5` measured 495 → 162
output tokens. The pair below shows the same prompt on the same model in a later run,
where run-to-run variation put it at 586 → 183.

Prompt: `In git, what does --no-ff do on a merge?`

| File | `outputStyle` | `output_tokens` |
| --- | --- | ---: |
| `git-no-ff.claude-opus-5.baseline.txt` | `Default` | 586 |
| `git-no-ff.claude-opus-5.v2.txt` | `Less Chatty` | 183 |

Command used for each, differing only in the `outputStyle` value:

```bash
cd "$(mktemp -d)" && claude -p "In git, what does --no-ff do on a merge?" \
  --output-format json --model claude-opus-5 --tools "" \
  --settings '{"outputStyle":"Default"}'
```

## Regression-gate samples

These record the four hand-inspected regression cases, so the gate results in the README
can be checked rather than taken on trust. `.v1` files were captured against the original
rule set, `.v2` against the shipped one. All are `claude-opus-5` unless the filename says
`claude-fable-5`, and all used `--settings '{"outputStyle":"Less Chatty"}'`.

| Case | What the gate checks | Corrects |
| --- | --- | --- |
| `401-no-evidence` | The response must not assert a cause the evidence does not support | [i-have-adhd#99](https://github.com/ayghri/i-have-adhd/issues/99) |
| `docker-cache-miss` | A long list must be grouped and ranked, never truncated | [i-have-adhd#96](https://github.com/ayghri/i-have-adhd/issues/96) |
| `scheduled-jobs` | An options question must still return ranked options | precedence clause |
| `port-default` | A short answer must stay short, with no bullet block | three-line threshold |

Token counts for these were not recorded at capture time; they are illustrative of shape,
not of size. For sizes, use `report.md`.
