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

- **Drag panels around the canvas.** A grip to move, eight handles to resize,
  snapping to the grid, a ghost showing where a panel will land, and a drop that
  pushes what it lands on down then settles everything up into the space that
  leaves. Arrows nudge the selected panel, shift+arrows resize it. The whole
  gesture is one undo step.
- **Two new panel types.** `stack` for part-to-whole, with a `share` mode that
  normalises every bar — and a note when the segments turn out to be measured in
  different units, because revenue stacked on an order count is metres plus
  seconds. `heatmap` for one number across two dimensions, shaded with a
  sequential ramp that follows the theme and re-anchors in dark mode. See
  [Panels](docs/panels.md).
- **`emphasise` on the bar chart** — one category in the accent colour, the rest
  recessed. When the story is "this one went up", a chart where every bar
  competes buries it.
- **`sparkline` on the KPI**, drawing the measure's own history behind the
  number. With a series present the headline is now its last point rather than
  its first: a KPI beside a trend means "now".
- **Brand colours.** `theme.colors` has been in the schema since v1 and nothing
  read it; it now repaints every chart, and the builder has a tab for editing it.
  Each colour is measured — lightness against the surface, chroma, separation
  from its neighbour under simulated colour blindness, contrast — and anything
  that fails is named in words with a one-click fix in the same hue. "Build from
  your brand colour" turns one hex into a whole validated palette.
- **A third worked example**, [`chart-types.gw.yaml`](examples/chart-types.gw.yaml),
  laying every panel type out beside the question it answers.
- **Keyboard access to a line chart's values.** Arrows walk the points, Home and
  End jump to the ends; the readout is a live region, so what appears on screen
  is what a screen reader is told. Previously a crosshair was the only way to get
  a number out of it, and the crosshair needed a mouse.
- **A dashboard from a bare CSV.** Drop a spreadsheet with no manifest and
  `inferManifest` writes one: it sniffs each column's type, picks the columns
  worth grouping by and the ones worth adding up, and lays out KPIs, a trend, bar
  charts and a detail table. Every guess is conservative and stated in words
  above the dashboard — an id column is not summed, a near-unique column is not
  charted, a bare year is not a date. **View manifest** shows the file it wrote,
  and saving it beside the data reopens the dashboard exactly as it was. See
  [Getting started](docs/getting-started.md#starting-from-a-csv-with-no-manifest-at-all).
- **The playground opens on the outcome**, not on a file picker: what you get,
  how to get it, and the two worked examples underneath.
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

### Changed

- **Selecting a panel asks its own question first, in words.** A bar chart
  offered eleven controls in schema order — X, Y, W, H, "Category", "Value",
  "Orientation", "Show Values", "Max Bars" — all weighted the same. It now leads
  with the two that decide what the chart draws and folds the rest, including the
  layout numbers, behind one disclosure. Props carry their own labels via JSON
  Schema's `title`, so "Show Values" is "Show the numbers".
- **A field that names a column is a dropdown of your own labels**, not a
  free-text box with a datalist. It is narrowed to what the field accepts, so a
  category picker no longer offers measures, and a value the dataset does not
  have stays selected and says so rather than silently blanking.
- **The playground serves `examples/` directly.** It served copies out of
  `apps/playground/public/`, which had drifted from the originals the tests and
  the CLI validate.
- **The builder names an untitled panel by what it draws.** A list reading
  `kpi_rev`, `kpi_rtn`, `detail` is legible to whoever wrote the manifest and to
  nobody else — and for an inferred manifest, to nobody at all.
- **The Model tab opens on dimensions and measures**, with fields collapsed —
  the fields came out of the file and are already right, and eight identical
  Name/Type/From blocks buried the two sections that matter. It also now says
  what each of the three is, in one sentence.
- The manifest and export dialogs close on **Escape** and dim what is behind
  them, and the playground's "Close" is now "Start over" — two buttons reading
  Close, one dismissing a dialog and one discarding the dashboard, is a trap.

### Fixed

- **`theme.colors` accepted hex the palette could not read.** The schema pattern
  allowed 3 to 8 digits, but a colour is measured by a parser that takes 3 or 6;
  a four- or eight-digit value carries alpha, which the palette maths has no way
  to represent, and five or seven digits are not a colour in any notation. All of
  them validated and then threw out of the Colours tab, several files from where
  the mistake was made. The schema now states what is actually accepted, so the
  failure arrives at validation with a message that names the field.
- **A new panel was invisible to review.** `heatmap.tsx` used a literal NUL as a
  Map key separator, which makes git classify the file as binary — 273 lines
  rendered as "Binary files differ" in the diff that introduced them. It is
  written as an escape now (the same string at runtime), and a test walks every
  source file for stray control characters, because this is the second time the
  project has hit it.
- **A heatmap cell's number could fall to 2.33:1 against its own fill.** The ink
  was picked by a threshold on the ramp step, and the ramp runs the other way in
  dark mode, so one threshold could not serve both. It is now chosen by measuring
  contrast against the step; worst case across the whole hue circle in both
  modes is 4.58:1.
- **The standalone build had no `<meta charset>`.** Opened over `file://` there
  is no header to say what the bytes mean, so the browser fell back to a legacy
  encoding and every em-dash, ellipsis and `×` in the app rendered as mojibake.
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
