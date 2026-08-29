# Gridwright

A schema-driven dashboard engine. Write a manifest, get a working React dashboard — no code.

```bash
pnpm install && pnpm build
node packages/cli/dist/bin.js validate examples/sales-overview.gw.yaml --data
pnpm --filter @gridwright/playground dev
```

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
including panels that share no dataset with the one clicked.

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
backend. It comfortably groups a million rows: two dimensions and four measures compile and
run cold in about a second, and warm from cache in ~1ms.

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

- **Joins.** A dataset reads one table. Spanning two is refused by name rather than
  producing a cross product.
- **The associative model.** Cross-filtering works; Qlik's grey "excluded values" behaviour
  does not. That needs an inverted index across the whole model maintained incrementally,
  and it is genuinely hard. If it matters to your users, treat it as a research spike, not a
  checkbox.
- **Scale past a few million rows in-browser.** The `DataSource` seam is the escape hatch.

## Development

```bash
pnpm install
pnpm build        # tsc -b across the workspace
pnpm test         # 250 tests
pnpm --filter @gridwright/playground dev
```

Tests run on node by default; component tests opt into jsdom, which doubles as a check that
the core packages carry no DOM assumptions.
