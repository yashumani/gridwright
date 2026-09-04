# Getting started

## Try it without installing anything

```bash
pnpm install
pnpm build
pnpm --filter @gridwright/playground dev
```

Open the playground and drag a file onto it — a `.csv` on its own, or a
`.gw.yaml` together with the CSVs it names. Or click one of the two worked
examples on the landing screen. Nothing is uploaded: every query runs in the tab,
and the standalone build makes no network requests at all after load.

Two examples ship:

| File | Shape |
|---|---|
| `examples/sales-overview.gw.yaml` | One flat CSV, 2694 rows. |
| `examples/orders-star.gw.yaml` | A fact table joined to two dimension tables. |

## Starting from a CSV, with no manifest at all

Drop a bare `.csv` on the playground and you get a dashboard without writing
anything. Gridwright reads the columns and answers three questions from the data
itself: what type is each column, which ones are worth grouping by, and which
ones are worth adding up.

Then **View manifest** shows you the file it wrote. Save it as
`dashboard.gw.yaml` beside your data and it reopens exactly as it was — the
inferred path and the hand-written path produce the same kind of file, so
nothing is a dead end.

### What it guesses, and what it refuses to

Every guess is one where a wrong answer would be visibly silly, so each is
deliberately conservative:

| Question | The rule | Why not something cleverer |
|---|---|---|
| Is this a date? | It must look like one — `YYYY-MM-DD`, or at least eight characters that parse | `Date.parse("2024")` succeeds, which would turn a count column into a timeline |
| Is this a flag? | Only `true`/`false`/`yes`/`no`/`y`/`n`/`t`/`f` | A quantity column holding only `0` and `1` read as a flag loses the measure entirely; summing a flag still counts its trues, so the ambiguous case takes the recoverable side |
| Should I add this up? | Numbers, unless the name says the column identifies a row (`id`, `uuid`, `key`, `code`, `no`, `num`) | `sum(order_id)` is a large, confident, meaningless number |
| Can I group by this? | Between 2 and 50 distinct values, and no more than one per two rows | 60 customers grouped by name is a legal dimension and a useless chart: sixty bars of one |
| How many charts? | The date first, then up to two more dimensions | More than a few is a wall nobody reads |

A banner above the dashboard says what it did — how many rows it read, how many
things it found to group by, and any column it deliberately left out of the
measures. **Change it** opens the same builder you would use on a hand-written
manifest.

**Joins are never guessed.** Combining tables needs declared relations, and
cardinality is what stops a join silently multiplying every total downstream —
see [Joins](joins.md). Drop several files and the first one is used; the rest
are named in the banner so you know they were skipped.

Programmatically, this is `inferManifest`:

```ts
import { inferManifest, loadBlob } from "@gridwright/engine";

const table = await loadBlob("sales", file);          // a File or Blob
const { manifest, notes } = inferManifest(table, { path: file.name });
```

`notes` is the plain-English list the banner shows. `path` is the file's real
name on disk — the table id has to be a legal identifier, so `sales-q3.csv`
becomes the id `sales_q3`, and without `path` the manifest would point at a file
nobody has.

## Your first manifest

You need a CSV and a description of what to do with it. Say `sales.csv` looks
like this:

```csv
order_date,region,channel,amount
2024-01-05,North,Web,1240.50
2024-01-05,South,Retail,880.00
```

Then `sales.gw.yaml` beside it:

```yaml
gridwright: 1
title: Sales overview

source:
  kind: file
  files:
    - { id: sales, path: ./sales.csv }

model:
  fields:
    - { name: order_date, type: date,   from: sales.order_date }
    - { name: region,     type: string, from: sales.region }
    - { name: amount,     type: number, from: sales.amount }

  dimensions:
    - { id: region, field: region,     label: Region }
    - { id: month,  field: order_date, label: Month, grain: month }

  measures:
    - { id: revenue, label: Revenue,   expr: "sum(amount)", format: "$#,##0" }
    - { id: orders,  label: Orders,    expr: "count()" }
    - { id: aov,     label: Avg order, expr: "measure(revenue) / measure(orders)" }

datasets:
  totals:
    measures: [revenue, orders, aov]
  by_region:
    dimensions: [region]
    measures: [revenue, orders, aov]
    sort: [{ measure: revenue, dir: desc }]
  by_month:
    dimensions: [month]
    measures: [revenue]
    sort: [{ dimension: month, dir: asc }]

panels:
  - { id: kpi_rev, type: kpi, dataset: totals,
      layout: { x: 0, y: 0, w: 4, h: 2 }, props: { measure: revenue } }
  - { id: trend, type: line, dataset: by_month, title: Revenue by month,
      layout: { x: 0, y: 2, w: 12, h: 4 },
      props: { x: month, y: [revenue], area: true } }
  - { id: regions, type: table, dataset: by_region, title: Regions,
      layout: { x: 0, y: 6, w: 12, h: 5 },
      props: { columns: [{ ref: region }, { ref: revenue, align: right },
                         { ref: aov, align: right }] } }

interactions:
  - { on: regions.rowClick, do: [{ action: filter, dimension: region, from: row }] }
```

Check it before you open it:

```bash
gridwright validate sales.gw.yaml --data
```

```
✓ sales.gw.yaml
  3 fields · 2 dimensions · 3 measures · 3 datasets · 3 panels
  totals: 1 row in 2ms
  by_region: 5 rows in 1ms
  by_month: 24 rows in 3ms
```

`--data` actually loads the CSV and runs every dataset, so a column that does
not exist or a measure that does not compile is named here rather than
surfacing later as a panel that will not draw.

Clicking a region in the table now re-queries the KPI and the trend line, even
though they share no dataset with it. That is the cross-filter loop, and you did
not write any of it.

## Building it visually

The playground's **Build** tab edits the same manifest:

- **Panels** — add, remove, move, resize, and edit each panel's own settings.
- **Model** — fields, dimensions, measures, datasets and relations.

Expressions validate as you type. Export writes YAML back, and **keeps the
comments** of the file it was opened from, so a manifest can be hand-written by
an engineer and edited visually by an analyst without either destroying the
other's work.

## Embedding it in your own app

```tsx
import { loadBundle } from "@gridwright/engine";
import { Dashboard, injectStyles } from "@gridwright/react";

injectStyles();

const r = loadBundle(manifestText, [{ name: "sales.csv", text: csv }]);
if (!r.ok) return <pre>{r.issues.map((i) => `${i.path}: ${i.message}`).join("\n")}</pre>;

return <Dashboard manifest={r.manifest} source={r.source} />;
```

`loadBundle` never throws — every failure comes back as an issue list, because
"the file you dropped is missing a column" is a message for a user, not a stack
trace.

For large files use the streaming path instead, which never holds the raw text
whole:

```tsx
const r = await loadBundleFromBlobs(manifestText, [{ name: "sales.csv", blob: file }]);
```

See [data sources](data-sources.md) for what "large" means in measured numbers.

## The CLI

```bash
gridwright validate <manifest> [--data]   # shape, expressions, panel props, and a real query pass
gridwright explain <manifest> [dataset]   # the compiled plan, as SQL
gridwright functions                      # the expression catalogue
gridwright panels                         # registered panel types and their props
gridwright schema [--out file]            # JSON Schema for the manifest format
```

Point your editor at the JSON Schema and you get completion and inline errors
while writing a manifest:

```bash
gridwright schema --out gridwright.schema.json
```

## Where to next

- [The manifest](manifest.md) — every key, with its type and limit.
- [Expressions](expressions.md) — the two tiers, and the full catalogue.
- [Joins](joins.md) — when your data is more than one file.
- [Panels](panels.md) — what ships, and how to add your own.
