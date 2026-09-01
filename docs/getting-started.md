# Getting started

## Try it without installing anything

```bash
pnpm install
pnpm build
pnpm --filter @gridwright/playground dev
```

Open the playground and click **Load flat example**, or drag in your own
`.gw.yaml` and the CSVs it names. Nothing is uploaded — every query runs in the
tab, and the standalone build makes no network requests at all after load.

Two examples ship:

| File | Shape |
|---|---|
| `examples/sales-overview.gw.yaml` | One flat CSV, 2694 rows. |
| `examples/orders-star.gw.yaml` | A fact table joined to two dimension tables. |

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
