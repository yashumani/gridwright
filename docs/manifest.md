# The manifest

One YAML (or JSON) file describes the data, the arithmetic, the layout and what
a click does. This is the reference; [Getting started](getting-started.md) has
the tutorial.

The manifest is **untrusted input**. Unknown keys are rejected rather than
ignored, every unbounded dimension has a ceiling, and `__proto__`,
`constructor` and `prototype` are refused as identifiers or keys anywhere. See
the [security policy](../SECURITY.md).

```bash
gridwright validate my-dashboard.gw.yaml --data   # shape, expressions, and a real query pass
gridwright schema > gridwright.schema.json        # JSON Schema, for editor completion
```

## Top level

| Key | Type | Required | Notes |
|---|---|---|---|
| `gridwright` | integer ≥ 1 | yes | Format version. Currently `1`. A higher number is refused with the version it needs. |
| `title` | string | no | Rendered as the dashboard heading. Max 200 chars. |
| `source` | object | yes | Where the data comes from. |
| `model` | object | yes | Fields, dimensions and measures. |
| `datasets` | map | yes | Named queries. Max 64. |
| `panels` | array | yes | What is drawn. Max 64. |
| `interactions` | array | no | What a click does. Max 128. |
| `grid` | object | no | Layout geometry. |
| `theme` | object | no | Preset name and colour overrides. |

Whole file: **512 KB**.

## Identifiers

Every `id`, `name` and dataset key must match `^[A-Za-z_][A-Za-z0-9_]*$` and be
at most 64 characters. `__proto__`, `constructor` and `prototype` are rejected.

## `source`

```yaml
source:
  kind: file
  files:
    - { id: orders,    path: ./orders.csv,    format: csv }
    - { id: customers, path: ./customers.json, format: json }
  relations:
    - { left: orders.customer_id, right: customers.customer_id, cardinality: many-to-one }
```

| Key | Type | Required | Notes |
|---|---|---|---|
| `kind` | `"file"` | yes | The only source kind in v1. Other backends arrive through the [`DataSource` seam](data-sources.md), not through this key. |
| `files[].id` | identifier | yes | The logical table name that `from:` references. Max 16 files. |
| `files[].path` | string | yes | Resolved relative to the manifest. **Cannot leave that directory** — no `../`, no absolute paths. |
| `files[].format` | `csv` \| `tsv` \| `json` | no | Default `csv`. See [data sources](data-sources.md#file-formats) for what JSON means and why it does not stream. |
| `relations` | array | no | How tables connect. Max 32. See [joins](joins.md). |

In the browser, `path` is matched to an uploaded file by basename, so directory
layout does not have to line up.

## `model`

### `fields`

A field names one column of one table and declares its type. Max 512.

```yaml
fields:
  - { name: order_date, type: date,    from: sales.order_date }
  - { name: amount,     type: number,  from: sales.amount }
  - { name: returned,   type: boolean, from: sales.returned }
```

| Key | Type | Notes |
|---|---|---|
| `name` | identifier | How expressions refer to it. |
| `type` | `string` \| `number` \| `date` \| `boolean` | Drives coercion at load. |
| `from` | `"table.column"` | `table` must be a `files[].id`. Verified against the real header when the data loads, so a typo is named at open time rather than as a panel that fails later. |

Type coercion at load:

- **number** — a plain number first; failing that, currency symbols and
  grouping separators are stripped and it is retried. Otherwise null.
- **date** — an ISO day (`2024-01-05`) passes straight through. Anything else
  goes through `Date.parse` and is normalised to an ISO day. Dates travel as
  strings so grouping, sorting and comparison all agree.
- **boolean** — `true`/`false`, and `1/0`, `yes/no`, `y/n`, `t/f`.
- Empty cells are null in every type.

### `dimensions`

A named, groupable view of one field. Max 128.

```yaml
dimensions:
  - { id: region, field: region,     label: Region }
  - { id: month,  field: order_date, label: Month, grain: month }
```

| Key | Type | Notes |
|---|---|---|
| `id` | identifier | Referenced by datasets, filters, sorts and interactions. |
| `field` | identifier | Must name a field. |
| `label` | string | Shown in the UI. Defaults to `id`. |
| `grain` | `year` \| `quarter` \| `month` \| `week` \| `day` | **Date fields only.** Buckets the value before grouping, so a filter on the dimension matches the bucket rather than the raw date. |

### `measures`

Max 256.

```yaml
measures:
  - { id: revenue, label: Revenue,   expr: "sum(amount)", format: "$#,##0" }
  - { id: orders,  label: Orders,    expr: "count()",     format: "#,##0" }
  - { id: aov,     label: Avg order, expr: "measure(revenue) / measure(orders)" }
```

| Key | Type | Notes |
|---|---|---|
| `id` | identifier | |
| `expr` | string | A [Gridwright expression](expressions.md). Max 2000 chars. |
| `label` | string | Defaults to `id`. |
| `format` | string | Excel-style pattern: `$#,##0.00`, `#,##0`, `0.0%`. |

Measures compose. `measure(revenue) / measure(orders)` defines the arithmetic
once and reuses it; selecting a composed measure pulls in the aggregates it
needs even if the dataset never named them.

## `datasets`

A named query. Panels bind to one.

```yaml
datasets:
  by_region:
    dimensions: [region]
    measures: [revenue, orders, aov]
    filters: [{ dimension: channel, op: in, values: [Web, Retail] }]
    sort: [{ measure: revenue, dir: desc }]
    limit: 100
```

| Key | Type | Notes |
|---|---|---|
| `dimensions` | identifier[] | Omit for a totals row — one row, no `GROUP BY`. |
| `measures` | identifier[] | Required (may be empty). |
| `filters` | filter[] | Baked into every query for this dataset, on top of runtime cross-filters. |
| `sort` | sort[] | Max 8. |
| `limit` | integer | 1 – 100 000. Defaults to 10 000. |

A dataset with no dimensions returns exactly one row **even when the filters
match nothing** — a KPI reads 0 rather than disappearing.

### Filters

`op` selects the shape:

| `op` | Extra keys | Meaning |
|---|---|---|
| `in` | `values: scalar[]` | Membership. An empty list matches nothing. Max 5000 values. |
| `between` | `from`, `to` (string or number) | Inclusive. |
| `eq`, `ne` | `value: scalar` | `null` compares as "is blank" / "is not blank". |
| `gt`, `gte`, `lt`, `lte` | `value: scalar` | |

A scalar is a string, number, boolean or `null`.

Filters bite on dimensions the dataset does not group by — that is what makes
cross-filtering move unrelated panels.

### Sort

Either `{ measure: id, dir: asc|desc }` or `{ dimension: id, dir: asc|desc }`.
`dir` defaults to `asc`. Nulls sort last under either direction.

Sorts are split by the tier that can resolve them: dimensions and plain
aggregates sort *before* the post tier, so window functions accumulate in the
declared order; sorts on composed or windowed measures run after.

## `panels`

```yaml
panels:
  - id: regions
    type: table
    dataset: by_region
    title: Regions
    layout: { x: 0, y: 0, w: 12, h: 6 }
    props:
      columns: [{ ref: region }, { ref: revenue, align: right, bar: true }]
```

| Key | Type | Notes |
|---|---|---|
| `id` | identifier | Referenced by interactions. |
| `type` | lowercase kebab-case | Looked up in the panel registry. |
| `dataset` | identifier | |
| `title` | string | |
| `layout` | `{x, y, w, h}` | Integers. `x` 0–64, `y` 0–4096, `w` 1–64, `h` 1–256. A panel wider than the grid is a validation error. |
| `props` | object | **Validated against that panel type's own schema**, not by the core. See [panels](panels.md). |

## `interactions`

```yaml
interactions:
  - { on: regions.rowClick, do: [{ action: filter, dimension: region, from: row }] }
  - { on: channels.click,   do: [{ action: filter, dimension: channel, from: value }] }
```

| Key | Notes |
|---|---|
| `on` | `"panelId.event"`. |
| `do` | 1–8 actions. |

Actions:

- `{ action: filter, dimension, from }` — `from: row` (default) reads the
  target dimension's own value from the clicked row; `from: value` uses the
  clicked value whatever it names. An action whose target the panel cannot
  supply is dropped rather than guessed at.
- `{ action: clearFilters, dimension }` — clears one dimension, or all of them
  if `dimension` is omitted.

With no interaction declared, clicking filters on what was clicked. That is
what everyone expects, so it is the default rather than something to opt into.

**A panel is never filtered by its own selection.** Collapsing a bar chart to
the bar you just clicked would make a second selection impossible.

## `grid`

```yaml
grid: { columns: 12, rowHeight: 76, gap: 12 }
```

`columns` 1–64 (default 12), `rowHeight` 8–512 px (default 76), `gap` 0–64 px
(default 12).

## `theme`

```yaml
theme:
  preset: default
  colors: ["#2f6fd0", "#c8642a"]
```

`colors` entries must be hex (`#rgb` through `#rrggbbaa`), max 32. See the
[colour rules](panels.md#colour) before overriding — the default palette is
validated for contrast and colour-vision deficiency.

## Versioning and migration

`gridwright: 1` is the current version. A manifest from a *newer* version is
refused with a message naming the version it needs, rather than being parsed on
a best-effort basis. Migrations live in `packages/schema/src/migrate.ts`; a
format change ships with one.

The format is pre-1.0. See the [changelog](../CHANGELOG.md) for what that means
for anything you build on it.
