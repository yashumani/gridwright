# Gridwright

A schema-driven dashboard engine. Write a manifest, get a working React dashboard — no code.

```bash
pnpm install && pnpm build
node packages/cli/dist/bin.js validate examples/orders-star.gw.yaml --data
pnpm --filter @gridwright/playground dev
```

Two examples ship: `sales-overview.gw.yaml` (one flat file) and
`orders-star.gw.yaml` (a fact table joined to two dimension tables).

Drop a `.gw.yaml` and its CSV into the playground and the dashboard is there. Nothing is
uploaded; every query runs in the tab.

## Why

Dashboards are configuration, not code. Every BI platform has proven it: a chart's whole
definition — dimensions, measures, formatting, click behaviour — is a data structure, and
the config UI is generated from a schema rather than hand-written. Gridwright is that model
on an engine we own: no license dependency, no server to install, and a manifest that is
portable anywhere.

## The manifest

One file describes the data, the arithmetic, the layout, and what a click does.

```yaml
gridwright: 1
title: Sales overview

source:
  kind: file
  files:
    - { id: sales, path: ./sales.csv, format: csv }

model:
  fields:
    - { name: order_date, type: date,   from: sales.order_date }
    - { name: region,     type: string, from: sales.region }
    - { name: amount,     type: number, from: sales.amount }

  dimensions:
    - { id: region, field: region,     label: Region }
    - { id: month,  field: order_date, label: Month, grain: month }

  measures:
    - { id: revenue, label: Revenue, expr: "sum(amount)", format: "$#,##0" }
    - { id: orders,  label: Orders,  expr: "count()" }
    - { id: aov,     label: Avg order, expr: "measure(revenue) / measure(orders)" }

datasets:
  by_region:
    dimensions: [region]
    measures: [revenue, orders, aov]
    sort: [{ measure: revenue, dir: desc }]

panels:
  - { id: tbl, type: table, dataset: by_region,
      layout: { x: 0, y: 0, w: 12, h: 6 },
      props: { columns: [{ ref: region }, { ref: revenue }] } }

interactions:
  - { on: tbl.rowClick, do: [{ action: filter, dimension: region, from: row }] }
```

Two properties matter more than the syntax. **Measures compose** — `measure(revenue) /
measure(orders)` means arithmetic is defined once and reused. And **every `props` block is
validated against its own panel's schema**, so a new panel type extends the manifest
language without touching the core.

## Joins

A dataset can read from several tables. Declare how they connect and the planner
works out the rest:

```yaml
source:
  kind: file
  files:
    - { id: orders,    path: ./orders.csv }
    - { id: customers, path: ./customers.csv }
    - { id: products,  path: ./products.csv }
  relations:
    - { left: orders.customer_id, right: customers.customer_id, cardinality: many-to-one }
    - { left: orders.product_id,  right: products.product_id,   cardinality: many-to-one }
```

Fields then name any table (`from: customers.region`), and a dataset mixing them
compiles to a single grouped query with only the joins it needs.

**`cardinality` is not decoration — it is the correctness mechanism.** Joining a
fact table to a dimension many-to-one leaves the grain alone, so `sum()` still
means what it says. Following that edge backwards, one dimension row to many
facts, multiplies rows and inflates every aggregate downstream. Silently. That is
the classic BI bug.

So the planner only ever traverses relations in the safe direction. If the tables
a dataset needs cannot be connected that way, it refuses:

```
dataset "bad" cannot be joined without multiplying rows
  Reaching "products" from "customers" means following a one-to-many relation,
  which repeats every row on the many side and would double-count sums.
```

Two more choices worth knowing:

- **Joins are LEFT, never INNER.** A fact whose dimension row is missing survives
  under a null group rather than vanishing from the totals. Losing rows is a
  wrong answer wearing a smaller number.
- **Join keys carry their type.** Numeric `1` does not match the string `"1"`.

Not supported: many-to-many, self-joins, and datasets whose tables are connected
only through a one-to-many hop. Each is refused by name rather than approximated.

## Expressions

Users need arithmetic. Handing them JavaScript would be remote code execution with an
unsupportable surface attached, so expressions are a small typed language: parsed to an
AST, compiled to SQL, evaluated in a sandbox. No `eval`, no `Function`, and no
member-access node in the grammar — an expression has no route to a host object.

| Stage | Functions |
|---|---|
| Aggregate | `sum` `count` `countDistinct` `countIf` `avg` `min` `max` `median` |
| Window | `lag` `lead` `runningSum` `rank` `pctOfTotal` |
| Scalar | `if` `coalesce` `nullif` `round` `abs` `floor` `ceil` `sqrt` `dateTrunc` `dateDiff` `concat` `lower` `upper` `len` |
| Composition | `measure(id)` |

Every expression belongs to exactly one **tier**. Aggregates fold raw rows and become the
`GROUP BY` query; `measure()` composition and window functions run over the grouped result.
Mixing them is a validation error that carries the fix:

```
sum(amount) / measure(orders)
  → an expression cannot mix raw aggregates with measure() references —
    move the aggregate into its own measure and reference that instead
```

Run `gridwright functions` for the catalogue with arities.

## How a query runs

```
manifest ──parse──▶ validate ──plan──▶ compile ──SQL──▶ source ──▶ panels
                                          ▲                          │
                                          └──── filter store ◀───────┘
                                        re-plans WHERE, re-queries all
```

A dataset plus the active filters compiles to one plan. The executor groups on the
*dimension* value with grain already applied — so a filter on a month dimension matches the
bucket, not the raw date — computes the aggregate tier, sorts, then computes the post tier.
That order is deliberate: `runningSum` on a by-month dataset must accumulate in month
order, which is the only reading anyone expects.

Clicking a mark writes to the filter store, which re-plans and re-queries every panel —
including panels that share no dataset with the one clicked, and panels reached only
through a join.

Editing is comment-preserving. A manifest exported from the visual builder keeps the
comments and layout of the file it was opened from, because the export patches the original
YAML document in place rather than re-serialising it. That matters the moment engineers and
analysts share a file: the first visual save must not silently delete the notes somebody
wrote to explain a measure.

**A panel is never filtered by its own selection.** Collapsing a bar chart to the one
bar you just clicked makes a second selection impossible and leaves nothing to render
as unselected. Every other panel narrows; the source chart keeps all its marks, with
the selected ones highlighted and the rest dimmed.

## Packages

| Package | Owns |
|---|---|
| `@gridwright/schema` | Manifest types, validator, JSON Schema, migrations |
| `@gridwright/expr` | Parser, AST, stage analysis, SQL compiler, sandboxed evaluator |
| `@gridwright/engine` | Plan compiler, `DataSource` seam, in-process executor, cache, loaders |
| `@gridwright/panels` | KPI, table, bar, line — each with its own props schema |
| `@gridwright/react` | `<Dashboard>`, grid layout, filter store, stylesheet |
| `@gridwright/builder` | Schema-generated property form, editing reducer, YAML export |
| `gridwright` | CLI: `validate`, `explain`, `functions`, `panels`, `schema` |

Dependencies only ever point down that list.

## Embedding

```tsx
import { loadBundle } from "@gridwright/engine";
import { Dashboard, injectStyles } from "@gridwright/react";

injectStyles();
const r = loadBundle(manifestText, [{ name: "sales.csv", text: csv }]);
if (r.ok) return <Dashboard manifest={r.manifest} source={r.source} />;
```

Register your own panel type and it gains manifest validation and a builder form for free:

```tsx
import { defaultRegistry } from "@gridwright/panels";
import { obj, str } from "@gridwright/schema";

const registry = defaultRegistry().register({
  type: "gauge",
  label: "Gauge",
  description: "A single measure against a target.",
  schema: obj({ measure: str(), target: str() }),
  defaults: (result) => ({ measure: result.columns[0]!.id, target: "" }),
  Component: MyGauge,
});
```

## Data sources

The in-process executor is the default and handles the "upload a file and go" case with no
backend at all. Data files are **streamed** into columns rather than read as text: a
ten-million-row CSV is about 350&nbsp;MB, and `File.text()` would need the whole thing as one
JavaScript string before parsing could begin, which is where a tab dies.

`format:` on a file is `csv` (the default), `tsv`, or `json`. JSON means a top-level array
of row objects, where the first object fixes the columns. It is there for the convenient
extract, not the large one: JSON cannot be resumed at an arbitrary byte, so that path reads
the document whole and gives up the streaming ceiling below. A ten-million-row export
belongs in CSV.

Measured end to end, streaming from disk, five columns, four datasets:

| Rows | File | Parse | First pass | Per cross-filter | Peak memory |
|---|---|---|---|---|---|
| 1M | 35 MB | 1.4 s | 0.2 s | ~0.05 s | ~170 MB |
| 2M | 72 MB | 3 s | ~6 s | **1.0 s** | 267 MB |
| 5M | 172 MB | 7 s | 1.8 s | **0.2 s** | ~320 MB |
| 10M | 344 MB | 14 s | 16 s | **4.4 s** | 1.7 GB |

The 2M row is from a real browser upload through the file input; the rest are Node, which
is the same code on the same path. First-pass cost scales with the number of *distinct
dimensions* across your panels, not the number of panels, because encodings are cached and
reused; cross-filtering only ever re-runs filter, group and aggregate.

**Where the honest ceiling is: a few million rows.** Up to ~5M this is a responsive
dashboard. At 10M it works and the numbers are correct, but you wait half a minute for the
first render and 1.7&nbsp;GB is close to what a browser tab will tolerate — some machines
will not make it. Past that, or for anything you want to feel instant at 10M, the
`DataSource` seam is the answer rather than more tuning here.

`maxRows` on the loader gives you a ceiling with a message instead of an unexplained freeze.

Another backend implements one interface:

```ts
interface DataSource {
  capabilities(): SourceCapabilities;
  introspect(table: string): Promise<string[]>;
  execute(plan: QueryPlan): Promise<QueryResult>;
}
```

`planToSql` already emits the two-tier query, so a pushdown adapter is mostly wiring.
`gridwright explain <manifest>` prints exactly what it would send.

## Security

The manifest is untrusted input, and is treated that way from the first commit.

- **Strict validation.** Unknown keys are rejected, not ignored. Every resource has a
  ceiling with a specific message.
- **Reserved names.** `__proto__`, `constructor` and `prototype` are refused as identifiers
  and as map keys. Both `JSON.parse` and the YAML parser materialise `__proto__` as a real
  own property, so this is a live hazard rather than a theoretical one.
- **Bounded parsing.** Parser recursion is capped during the parse, not after — parenthesised
  groups collapse to their inner node, so an AST depth check never sees them.
- **Parameterised queries.** Identifiers go through a strict pattern check and values through
  a literal escaper. The plan compiler and the SQL emitter reject injected identifiers
  independently.
- **Escaped output.** Labels and titles reach the DOM as React text, never as markup.

If a warehouse backend is added, authenticate per user rather than with a shared service
account, or row-level security silently stops applying.

## Colour

Series colours are a validated categorical palette, assigned in fixed order and never
cycled; a ninth series folds to "Other" rather than inventing a hue. Dark mode is selected
from the palette's dark column against the dark surface, not flipped. The brand verdigris
was measured against the chroma floor, failed it — it reads gray in a chart — and is
confined to UI chrome. Bars carry direct value labels and a table view exists, which is what
discharges the light-mode contrast relief rule.

## Not in v1

- **The associative model.** Cross-filtering works; Qlik's grey "excluded values" behaviour
  does not. That needs an inverted index across the whole model maintained incrementally,
  and it is genuinely hard. If it matters to your users, treat it as a research spike, not a
  checkbox.
- **Scale much past a few million rows in-browser.** 10M works but is slow and memory-hungry;
  see the table above. The `DataSource` seam is the escape hatch.
- **Many-to-many joins, self-joins, and one-to-many traversal.** Refused, not approximated.

## Development

```bash
pnpm install
pnpm build        # tsc -b across the workspace
pnpm test         # 334 tests
pnpm --filter @gridwright/playground dev
```

Tests run on node by default; component tests opt into jsdom, which doubles as a check that
the core packages carry no DOM assumptions.
