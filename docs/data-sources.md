# Data sources

The in-process executor is the default. It handles the "upload a file and go"
case with no backend at all, and every query runs in the tab — nothing is
uploaded anywhere.

## File formats

`format:` on a declared file is `csv` (the default), `tsv`, or `json`.

**CSV and TSV** are read by our own RFC 4180 parser, which is incremental and
resumable. A ten-million-row CSV is about 350 MB, and `File.text()` would need
the whole thing as one JavaScript string before parsing could even start —
which is where a browser tab dies, long before the engine gets a chance to be
slow. Feeding chunks through a resumable parser straight into column arrays
means the source text is never held whole.

One deliberate deviation from strict RFC 4180: **a CRLF inside a quoted field
collapses to LF.** Keeping the CR would mean the same logical value exported
from Windows and from Unix groups separately — a data bug caused by nothing but
the file's origin. A lone CR is preserved.

**JSON** means a top-level array of row objects, where the first object fixes
the columns:

```json
[
  { "region": "North", "amount": 1240.5 },
  { "region": "South", "amount": 880 }
]
```

A later row may omit a column — that cell reads null — and a key the first row
did not declare is ignored, so one stray record cannot silently widen the table
underneath the manifest. A nested object or array in a cell is an error naming
the column.

JSON is for the convenient extract, not the large one. It cannot be resumed at
an arbitrary byte, so that path reads the document whole and gives up the
streaming ceiling below. **A ten-million-row export belongs in CSV.**

## Loading

```ts
// Small files, or Node: text you already have.
const r = loadBundle(manifestText, [{ name: "sales.csv", text: csv }]);

// Large uploads: streams each file, never holding the raw text whole.
const r = await loadBundleFromBlobs(manifestText, [{ name: "sales.csv", blob: file }], {
  maxRows: 5_000_000,
});
```

Neither throws. Every failure comes back as an issue list, because "the file you
dropped is missing a column" is a message for a user rather than a stack trace.

Matching a manifest's `./sales.csv` to a `File` that arrives with a bare name
and no path is the awkward part of any upload flow, so it lives in the library:
basename matching, case-insensitive, falling back to a sole unmatched file for a
sole table.

`maxRows` gives a ceiling with a message instead of an unexplained freeze.

## Measured scale

End to end, streaming from disk, five columns, four datasets:

| Rows | File | Parse | First pass | Per cross-filter | Peak memory |
|---|---|---|---|---|---|
| 1M | 35 MB | 1.4 s | 0.2 s | ~0.05 s | ~170 MB |
| 2M | 72 MB | 3 s | ~6 s | **1.0 s** | 267 MB |
| 5M | 172 MB | 7 s | 1.8 s | **0.2 s** | ~320 MB |
| 10M | 344 MB | 14 s | 16 s | **4.4 s** | 1.7 GB |

The 2M row is a real browser upload through the file input; the rest are Node,
which is the same code on the same path.

First-pass cost scales with the number of **distinct dimensions** across your
panels, not the number of panels, because dimension encodings and join indexes
are cached and reused. Cross-filtering only ever re-runs filter, group and
aggregate — neither the encodings nor the join indexes depend on the filters, so
the path users hammer hardest was pure repeated work until it was cached.

**The honest ceiling is a few million rows.** Up to ~5M this is a responsive
dashboard. At 10M it works and the numbers are exact, but you wait half a minute
for the first render and 1.7 GB is close to what a browser tab will tolerate —
some machines will not make it. Past that, the `DataSource` seam is the answer
rather than more tuning here.

Those numbers came out of three rounds of profiling in which the first two
guesses were wrong. Neither the dictionary keys nor the parser dominated:
**coercion did** — converting ten million dates into `Date` objects only to
format them back, and allocating an array per row to test a boolean. Measured,
not assumed.

## Another backend

One interface:

```ts
interface DataSource {
  readonly name: string;
  capabilities(): SourceCapabilities;
  introspect(table: string): Promise<string[]>;
  execute(plan: QueryPlan): Promise<QueryResult>;
}
```

`execute` receives a compiled `QueryPlan` — the base table, the join steps, the
dimensions with their grain, the two measure tiers in dependency order, the
filters, the sorts and the limit. What you do with it is your business; the
plan is deliberately not SQL, so a backend that is not SQL can implement this
too.

### Pushdown

For a SQL backend, the plan is already compiled for you:

```ts
import { planToSqlParams } from "@gridwright/engine";

async execute(plan) {
  const { sql, params } = planToSqlParams(plan);
  const rows = await this.db.query(sql, params);   // rewrite ? to $1 if your driver wants that
  return toQueryResult(plan, rows);
}
```

**Use `planToSqlParams`, not `planToSql`.** `planToSql` inlines constants with
ANSI escaping — correct for Postgres, DuckDB, SQLite, Snowflake and BigQuery,
and *not* correct for MySQL or MariaDB, which honour backslash escapes by
default. `planToSqlParams` binds every constant, including the ones written
inside measure expressions, so no manifest string ever becomes SQL text. See
the [security policy](../SECURITY.md#pushdown-adapters-read-this-before-you-write-one).

`planToSql` remains for display:

```bash
gridwright explain my-dashboard.gw.yaml by_region
```

prints exactly the query shape an adapter would send, which is the fastest way
to see what the compiler decided.

### If you connect a warehouse

Authenticate **per user**, not with a shared service account. A dashboard tool
holding one privileged connection is how row-level security silently stops
applying — every viewer sees whatever the service account can see, and nothing
in the UI says so.

## Status

`MemorySource` is the only adapter in the repository today. The seam is real
and the SQL emitter is tested, but nobody has yet shipped a pushdown adapter on
it — if you build one, that is exactly the contribution this project needs
most, and [an issue first](https://github.com/yashumani/gridwright/issues/new?template=feature.yml)
will save you rework.
