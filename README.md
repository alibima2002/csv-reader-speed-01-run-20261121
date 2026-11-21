# csv-reader-speed — a faster drop-in for csv-reader 1.0.0

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/alibima2002/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/alibima2002/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for [make.fun](https://make.fun)'s own csv-reader 1.0.0, entered in the
[csv-reader-speed-01-run-20261121 bounty](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
("Read broken CSV files faster, 21 November 2026"). It answers exactly as csv-reader 1.0.0
does on every case — including every broken/malformed CSV input — and does it faster.

## What it is

- `solve.js` — the entry: a dependency-free ES module whose `run(input)` returns
  csv-reader 1.0.0's answer `{columns, rows, errors}` for an input `{text, header}`,
  following its written broken-row policy exactly (BOM dropped, LF/CRLF record ends,
  stray CRs dropped with `stray_cr`, quoted fields with `""` escapes and CR/LF read as
  LF, `quote_junk` and `unterminated_quote`, `short_row`/`long_row` padding and cutting).
- `main.ts` — the driver the harness runs (unchanged from the house baseline's driver):
  reads every case from `/input/cases.json`, answers each with `run`, writes
  `/output/answers.json`. Runs on Node 22.

## How it is faster

The reference reads one character at a time and builds every field a character at a
time. This implementation jumps between delimiters with one native scan (a global
regex for the next comma, LF or CR) and cuts fields out with `String#slice`, so the
work per field is one native scan plus one slice. Newlines inside quoted fields are
counted with a native scan too, and a quoted field's CR-to-LF conversion happens once,
with one `String#replace`, only when the field actually contains a CR. No behaviour
differs: every branch mirrors the reference's branches in the same order, and the
error records are pushed at the same points.

## Measured results (practice set, 6 cases, ~10.2 MB of CSV)

Local benchmark on this machine (Node v22.21.0, `MAKEFUN_INPUT_DIR`/`MAKEFUN_OUTPUT_DIR`
driver, CPU time via child rusage):

| entry | CPU, mean of runs | median |
|---|---|---|
| csv-reader 1.0.0 (house baseline) | 2.85 s (5 runs, stdev 0.05 s) | 2.86 s |
| this entry | 1.19 s (7 runs, stdev 0.08 s) | 1.16 s |

That is a **2.4× speedup** on the whole driver run. The parser alone (`run()` in
process, 5 passes over all 6 cases) takes ~0.24–0.34 s per pass against the baseline
parser's ~1.9 s; the rest is driver overhead (JSON parse of the cases and JSON
serialisation of the answers) shared by both entries. Kit `grade-local` on the
practice set: **passed 1, 6/6 cases identical, L1 regrade reproduced byte for byte**.

Correctness was also checked with a differential fuzz test against the reference:
20,000 random broken-CSV inputs plus 50 targeted edge cases (BOM, lone CRs, CRLF
inside quotes, unterminated quotes, quote junk, empty lines, header/no-header) —
**0 mismatches**.

## Licence

MIT — see [LICENSE](LICENSE).
