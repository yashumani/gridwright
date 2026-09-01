# Contributing

Thanks for looking. Gridwright is young enough that most contributions still
change the shape of things, so a short issue before a large PR usually saves
everyone a rewrite.

## Getting set up

Node 20 or newer, and pnpm through corepack:

```bash
corepack enable
pnpm install
pnpm build          # tsc -b across the workspace
pnpm test           # vitest, node + jsdom projects
```

To see it running:

```bash
pnpm --filter @gridwright/playground dev       # drop a manifest and its CSVs
pnpm --filter @gridwright/playground bundle    # one self-contained HTML file
node packages/cli/dist/bin.js validate examples/orders-star.gw.yaml --data
```

## The bar for a change

CI runs exactly this, and it is fast enough to run before every push:

```bash
pnpm build
pnpm test
node packages/cli/dist/bin.js validate examples/sales-overview.gw.yaml --data
node packages/cli/dist/bin.js validate examples/orders-star.gw.yaml --data
pnpm --filter @gridwright/playground build
```

Two habits the codebase already keeps, and which reviews will ask about:

**A fix ships with a test that fails without it.** Not a test that passes
afterwards — one you have watched fail against the old code. Several bugs in
this repo's history were "fixed" twice because nobody checked that.

**A rendering change is checked in a browser, not only in jsdom.** jsdom has no
layout, so clipped labels, collapsed panels and contrast problems are all
invisible to it. Every visual bug found here so far was found by looking at a
real page.

## How the packages fit together

```
schema  →  expr  →  engine  →  panels  →  react  →  builder  →  cli
```

Dependencies only ever point right to left in that list. If a change needs an
arrow going the other way, the design is wrong somewhere — raise it rather than
adding the import.

| Package | Owns |
|---|---|
| `@gridwright/schema` | Manifest types, the validator, JSON Schema, migrations |
| `@gridwright/expr` | Tokenizer, parser, AST, stage analysis, SQL compiler, evaluator |
| `@gridwright/engine` | Plan compiler, joins, the `DataSource` seam, executor, loaders |
| `@gridwright/panels` | Panel components, each with a schema for its own props |
| `@gridwright/react` | `<Dashboard>`, grid layout, filter store, stylesheet |
| `@gridwright/builder` | Model and panel editors, YAML export |
| `gridwright` | The CLI |

## Adding a panel type

This is the most likely first contribution, and the registry is built so it
needs no plumbing. A panel ships a schema for its own props; the renderer
validates manifests against it and the builder generates the property form from
it, so you never hand-write a config UI.

In `packages/panels/src/`, add a file:

```tsx
const schema = obj({
  category: str({ minLength: 1 }),
  value: str({ minLength: 1 }),
  showTotal: opt(bool()),
});

function Donut({ result, props, size, select, selected }: PanelProps<DonutProps>) {
  const category = requireColumn(result, props.category, "props.category");
  // ...draw SVG at real pixels; `size` is the measured content box
}

export const donutPanel: PanelSpec<DonutProps> = {
  type: "donut",
  label: "Donut",
  description: "Share of a total across a few categories.",
  schema,
  defaults: (result) => ({ /* something sensible from the result's columns */ }),
  Component: Donut,
  minSize: { w: 3, h: 3 },
};
```

Then register it in `defaultRegistry()`. That is the whole integration.

Things reviewers will look for:

- **Selection.** Call `select(dimensionId, value, row)` and pass the clicked
  row — an interaction may target a dimension other than the one you emitted,
  and it needs that dimension's own value.
- **Colour.** Use `seriesVar(i)` from `theme.ts`. The palette is validated for
  contrast and colour-vision deficiency, assigned in fixed order and never
  cycled. Do not generate hues.
- **Identity is never colour alone.** Two or more series means a legend, direct
  labels, or both.
- **One y-axis.** Two measures on different scales get two panels or a common
  indexed base. A second axis makes any pair of lines cross wherever the
  author's scaling chose.
- **Empty and truncated results.** `result.rowCount` can be zero and
  `result.truncated` can be true. Say so rather than drawing nothing.

## Adding an expression function

`packages/expr/src/functions.ts` is one table. Each entry declares arity, its
stage (`aggregate`, `window` or `scalar`), how it compiles to SQL, and how it
evaluates in process. A function that folds raw rows is `aggregate`; one that
reads `measure()` results or looks across rows is `window`. Mixing tiers inside
one expression is a validation error, and that is deliberate — add to the tier
the function belongs in rather than relaxing the check.

## Conventions

- **TypeScript, strict.** No `any` in exported signatures.
- **Comments explain why, not what.** The codebase is written so that a reader
  can tell what a decision cost. If a line looks odd and is deliberate, say so.
- **Commit messages describe the change and the reason.** Look at `git log` for
  the register; it is prose, not a bullet list of file names.
- **Small PRs.** One idea each. If you found three things, that is three PRs.

## Things to raise before building

- Changes to the manifest format. It is a public contract and every change needs
  a migration; see `packages/schema/src/migrate.ts`.
- A new `DataSource` adapter, especially a pushdown one. Read
  [SECURITY.md](SECURITY.md#pushdown-adapters-read-this-before-you-write-one)
  first — use `planToSqlParams`, not `planToSql`.
- Anything touching the join planner's cardinality rules. Following a
  many-to-one edge backwards multiplies fact rows and inflates every aggregate
  downstream, silently, which is why the planner refuses rather than
  approximating.

## Reporting a security problem

Not in a public issue — see [SECURITY.md](SECURITY.md).

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
