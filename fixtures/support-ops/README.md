# Support operations fixture (synthetic)

**This is invented data.** It is not a workplace workbook, not derived from one,
and carries no claim of compatibility with any real report. Decisions D01 and
D02 call for exactly this: a clearly synthetic fixture in a generic
support-operations domain, used for acceptance only while the authorised
reference artifacts remain unavailable.

It exists so tasks T02 and T05 have something concrete to bind, and so the
numbers in the acceptance scenarios are checkable rather than described.

## The golden numbers

Taken from the delivery plan's suggested fixture, unchanged:

| | Actual | Comparison | Variance |
|---|---|---|---|
| Queue A | 70 | 60 | +10 |
| Queue B | 50 | 40 | +10 |
| Queue C *(configured, no rows)* | — | — | — |
| **Total** | **120** | **100** | **+20** |

Two non-overlapping queues, so the contributions add to the total variance
exactly. That is what makes it a golden fixture: any arithmetic that does not
produce +10, +10 and +20 is wrong, with no judgement call.

**Queue C is the point of the fixture, not padding.** It is configured in the
skeleton and returns no rows from the view. R14 says the skeleton survives
regardless of what the query returns, so Queue C must appear in the output with
its heading intact and its values marked not-available — never dropped, and
never shown as zero. A row that is absent and a row that is zero are different
statements about the business, and a bridge that confuses them is worse than
one that fails.

**Nothing here says +20 is good.** Polarity belongs to the approved metric
definition, per R09 and the delivery plan's explicit warning. The fixture
records the arithmetic and stops.

## Files

| File | What it is | Requirement |
|---|---|---|
| `skeleton.ts` | The workbook's contents as data, and the builder that writes it | R10 |
| `skeleton.xlsx` | The same workbook as a real file, openable in Excel | R10 |
| `sql-metadata.json` | Configuration metadata as a read-only connector would return it | R11 |
| `bindings.json` | Explicit skeleton-to-view bindings, with grain and units | R12 |
| `prepared-view.csv` | The business-data view the bindings point at | R12 |
| `expected.json` | Required structure and results, including Queue C's absence | R14 |

`skeleton.xlsx` is generated from `skeleton.ts` — the code is the reviewable
source, the file is there so a person can open it. Rebuild with:

```
node --experimental-strip-types fixtures/support-ops/build.ts
```

## What this fixture does not do

It does not establish Qlik or Vizlib compatibility, does not exercise a live
database, and does not demonstrate a non-additive metric — R08 says a
non-additive metric must not inherit sum behaviour, and proving that needs its
own fixture with its own expected values, not a column bolted onto this one.
