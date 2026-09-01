# Changelog

Notable changes to Gridwright. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## What "pre-1.0" means here

Before 1.0, **the package APIs may change in a minor release.** Pin an exact
version if that matters to you.

The **manifest format** is treated more carefully than that, because it is the
part you write by hand and store in a repository:

- A manifest declares `gridwright: 1`. That number changes only for a breaking
  format change, and a change ships with a migration — a manifest written today
  keeps opening.
- A manifest from a *newer* version than the library is refused by name rather
  than parsed on a best-effort basis, so a version mismatch is never a silently
  wrong dashboard.
- New optional keys can appear in a minor release. Unknown keys are rejected,
  so writing a key from a newer version against an older library fails loudly.

What is **not** stable before 1.0: the shape of `QueryPlan` and `QueryResult`
(a pushdown adapter will need updating), panel prop schemas beyond the four
documented types, and the internals of every package below `@gridwright/react`.

## Unreleased

### Added

- **Model editing in the builder.** The inspector now has two tabs: panels, and
  the model behind them — fields, dimensions, measures, datasets (including
  their filters and sort) and relations. Expressions validate as you type,
  naming the tier they landed in or what is wrong with them; `from:` picks a
  real column read out of the loaded file; grain is offered only on a date.
- **`planToSqlParams`** — the query with constants bound rather than
  interpolated, for adapters that will actually execute it. See
  [SECURITY.md](SECURITY.md#pushdown-adapters-read-this-before-you-write-one).
- **JSON data files.** `format: json` means a top-level array of row objects.
  The schema always accepted the value; now a loader honours it.
- **`null` in manifest filters.** `value: null` and `null` inside an `in` list
  now validate, matching what both executors already did.
- Community and release scaffolding: `SECURITY.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, issue and PR templates, CodeQL, dependency review,
  Dependabot, and a gated release workflow publishing with provenance.
- Documentation split out of the README into [`docs/`](docs/).

### Fixed

- **Arbitrary file read through a manifest.** `gridwright validate --data`
  resolved each declared data path with no containment, so
  `path: ../../../../etc/passwd` was a file read — and not a quiet one, since
  the loader reports the columns it found and the first line of whatever it
  opened is that list. Paths must now stay inside the manifest's directory.
- **A KPI vanished when a cross-filter excluded the last record.** An aggregate
  query with no `GROUP BY` returns one row whatever the `WHERE` says; now it
  does here too, reading 0.
- **An interaction targeting a dimension other than the one clicked** stored the
  clicked value under it — filtering `channel` by a region name, which empties a
  dashboard rather than narrowing it. `select` now carries the clicked row.
- **`onError` was called during render**, so a host that turned it into state
  re-rendered and was called again. It now reports from an effect.
- Three defects in the SQL emitter, none of which affected the in-process
  executor: a filter on an ungrouped dimension resolved through the wrong map
  and lost its grain; a post measure reading another post measure emitted an
  alias its neighbour could not see; and the display order was left inside a CTE
  that does not bind the query reading it.
- **The builder crashed on a half-typed expression.** `new Engine()` compiles
  the measure model synchronously during render; the preview now shows the last
  manifest that compiled.

### Security

- `planToSql` escapes for ANSI SQL, which is not sufficient for MySQL or
  MariaDB. It now documents that, and `planToSqlParams` exists so an adapter
  never has to rely on it.
- Every workflow declares least-privilege permissions and pins actions to
  commit SHAs.

## 0.1.0

First working version. Seven packages, ~8000 lines.

### Added

- **`@gridwright/schema`** — manifest v1, a combinator validator that also emits
  JSON Schema so error messages and editor tooling cannot drift apart,
  referential-integrity checks, a migration harness, and a resource ceiling on
  every unbounded dimension of the format.
- **`@gridwright/expr`** — tokenizer, Pratt parser, and a typed AST with no
  member-access node. Two-tier stage analysis, 24 functions across aggregate,
  window and scalar, model-level dependency resolution with cycle detection, a
  SQL compiler and a sandboxed evaluator.
- **`@gridwright/engine`** — plan compiler, star-schema joins where cardinality
  is the correctness mechanism, a columnar in-process executor, an LRU result
  cache, streaming CSV/TSV loaders, and the `DataSource` seam.
- **`@gridwright/panels`** — KPI, table, bar and line, dependency-free SVG, each
  with a schema for its own props. A validated categorical palette assigned in
  fixed order and never cycled.
- **`@gridwright/react`** — `<Dashboard>`, grid layout, the cross-filter store,
  and per-panel error isolation.
- **`@gridwright/builder`** — schema-generated property form, an editing reducer
  with undo/redo, and comment-preserving YAML export.
- **`gridwright`** — `validate`, `explain`, `functions`, `panels`, `schema`.
- Two worked examples: one flat file, and a fact table joined to two dimension
  tables.

### Notes

Performance work in this version was measured rather than guessed: query at 5M
rows went 7121 ms → ~1300 ms and parse at 10M went 39 s → 14.4 s, across three
rounds of profiling in which the first two hypotheses were wrong. Coercion
dominated, not the parser and not the dictionary keys.
