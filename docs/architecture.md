# Architecture

## How a query runs

```
manifest ──parse──▶ validate ──plan──▶ compile ──▶ source ──▶ panels
                                          ▲                     │
                                          └──── filter store ◀──┘
                                        re-plans WHERE, re-queries all
```

A dataset plus the active filters compiles to **one plan**. The executor then:

1. **Resolves fields to tables** and plans the joins, pruning hops no field
   needs.
2. **Groups on the dimension value with grain already applied**, so a filter on
   a month dimension matches the bucket rather than the raw date.
3. **Computes the aggregate tier** — the measures that fold raw rows.
4. **Sorts.**
5. **Computes the post tier** — `measure()` composition and window functions.

Steps 4 and 5 are in that order deliberately: `runningSum` on a by-month
dataset must accumulate in month order, which is the only reading anyone
expects. A sort on a post measure runs after step 5 instead.

Clicking a mark writes to the filter store, which re-plans and re-queries every
panel — including panels that share no dataset with the one clicked, and panels
reached only through a join. One query pass serves the whole dashboard, so
panels agreeing on a dataset share a result and there is a single loading state
rather than a ripple.

## The two-tier split, concretely

This is the idea most of the engine is shaped around. `sum(amount)` reads one
row at a time and belongs in the `GROUP BY` query. `measure(revenue) /
measure(orders)` cannot exist until after grouping. Keeping them in separate
tiers means:

- the compiler emits each list in dependency order, so an executor walks
  straight down it with no resolution step;
- a composed measure pulls in the aggregates it needs even when the dataset
  never named them;
- the SQL emitter can nest post measures that reference other post measures,
  each level its own CTE, because a sibling select-list alias is not visible to
  its neighbours in standard SQL.

Mixing tiers in one expression is a validation error rather than a guess. See
[expressions](expressions.md).

## Columnar execution

At a few million rows the naive shapes stop working, so:

- **No row object is materialised.** Fields are read through accessors
  positioned by index, and expressions see a single cursor repositioned rather
  than five million short-lived objects.
- **Dimensions encode to integer codes once**, so grouping is an array index
  rather than a string hash, and a filter on a grouped dimension becomes a
  lookup table over those codes.
- **Rows are counting-sorted into contiguous per-group runs**, so an aggregate
  walks a slice instead of chasing a list of arrays.
- **Aggregates fold through a streaming reducer**; `sum(field)`, `count()` and
  `countIf(field)` read the column directly.
- **Join indexes and dimension encodings are cached across queries.** Neither
  depends on the filters, and cross-filtering changes only the filters.

## Packages

```
schema  →  expr  →  engine  →  panels  →  react  →  builder  →  cli
```

Dependencies only ever point right to left in that list.

| Package | Owns |
|---|---|
| `@gridwright/schema` | Manifest types, the validator, JSON Schema, migrations |
| `@gridwright/expr` | Tokenizer, Pratt parser, AST, stage analysis, SQL compiler, evaluator |
| `@gridwright/engine` | Plan compiler, joins, the `DataSource` seam, executor, cache, loaders |
| `@gridwright/panels` | Panel components, each with a schema for its own props |
| `@gridwright/react` | `<Dashboard>`, grid layout, filter store, stylesheet |
| `@gridwright/builder` | Model and panel editors, comment-preserving YAML export |
| `gridwright` | The CLI |

### One decision worth calling out

**A panel ships a schema for its own props.** The renderer validates manifests
against it and the builder generates its editing form from it. That is why
adding a panel type needs no plumbing, and why nobody hand-writes a config UI —
one definition serves validation, documentation and editing.

The same trick appears a level down: the validator in `@gridwright/schema` is a
combinator library where every validator can also emit its JSON Schema. Human
error messages and editor tooling come from one definition, so they cannot
drift apart.

## The builder

The builder edits the same manifest the renderer runs, with a live preview that
is a real `<Dashboard>` — editing a mock is the only way to be confidently
wrong about what you are building.

Three rules make that safe:

**Editing is comment-preserving.** An export patches the original YAML document
in place, writing only what changed, so untouched sections keep their comments
and layout. Lists whose items carry an `id` are matched by identity, so a
comment survives its neighbour being added or removed. This matters the moment
engineers and analysts share a file: the first visual save must not silently
delete the notes somebody wrote to explain a measure.

**Removals and renames cascade through structure, never through expressions.**
Deleting a dimension takes it out of every dataset, filter, sort and interaction
that names it — those are ids in lists, and keeping them consistent is the
editor's job. `measure(revenue)` inside somebody's formula is not: rewriting it
would be a guess, so a rename leaves it alone and the validator names it
instead.

**The preview renders the last manifest that compiled.** `new Engine()` analyses
the whole measure model in its constructor, during render, so a half-typed
expression — which every expression is for a moment — would otherwise throw
straight through the editor and take it down along with the dashboard. Holding
the last good one back keeps the form usable while the numbers behind it are
briefly nonsense, and an issue strip says what is wrong and that the preview is
behind.

## Testing

529 tests across node and jsdom projects. Component tests opt into jsdom, which
doubles as a check that the core packages carry no DOM assumptions.

Two conventions the history of this repo earned the hard way:

- **A fix ships with a test that was watched failing** against the old code.
- **Rendering is verified in a real browser**, not only in jsdom. jsdom has no
  layout, so clipped labels, collapsed panels and contrast problems are
  invisible to it. Every visual bug found here so far was found by looking at a
  page.

The chunk-boundary suite is worth a look: it re-parses the same awkward CSV
fixture at every chunk size from one byte upward and demands a single answer.
That is what made rewriting the parser for streaming safe.
