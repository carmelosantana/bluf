# What is in this directory

Two things, kept apart on purpose.

## The current measurement

`report.md` and the `bluf`-named `.jsonl` files are the 0.2.0 rules, measured at three
trials per case with conditions interleaved. Every figure quoted in the project README
traces to these files.

## The 0.1.0 archive

`report-0.1.0.md` and the `-v1.jsonl` files record the **retracted** first rule set — the
one that cut Fable-5 output 22.7% while inflating Opus-5 output 32.2%. They are kept
because that regression is a claim the README still makes, and evidence for a live claim
should not be deleted.

Two things about them:

- **The filenames and the `condition` field inside them say `less-chatty`.** That was the
  project's working name when the run happened. The files are preserved byte for byte
  rather than relabelled, because rewriting stored measurement records to match a name
  chosen afterwards is the kind of tidying that quietly destroys provenance.
- **They are not methodologically comparable to `report.md`.** The 0.1.0 run was a single
  trial per case with each condition run as a contiguous block, which confounds the
  condition with elapsed time. The 0.2.0 run is three trials with conditions interleaved
  and rotated. The +32.2% regression is far enough outside the measured drift band to
  survive that difference, but the two reports should not be diffed row by row.

## Samples

`samples/` holds verbatim response text, which the `.jsonl` files do not record. See
`samples/CAPTURE.md` for how each was captured and which prompt produced it.
