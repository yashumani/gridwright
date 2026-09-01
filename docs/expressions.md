# Expressions

Users need arithmetic. Handing them JavaScript would be remote code execution
with an unsupportable surface attached, so expressions are a small typed
language: tokenised, parsed to an AST, then either compiled to SQL or walked by
an interpreter. No `eval`, no `Function`, and **no member-access node in the
grammar** — an expression has no route to a host object, not because we filter
for one but because the shape cannot be written.

```bash
gridwright functions        # the catalogue, with arities
```

## Two tiers, and why mixing them is an error

Every expression belongs to exactly one tier.

**Aggregate** expressions fold raw rows. They become the `GROUP BY` query.

```yaml
- { id: revenue, expr: "sum(amount)" }
- { id: orders,  expr: "count()" }
- { id: returns, expr: "countIf(returned)" }
```

**Post** expressions run over the already-grouped result. Anything that
references another measure with `measure()`, or looks across rows with a window
function, is post-tier.

```yaml
- { id: aov,       expr: "measure(revenue) / measure(orders)" }
- { id: rev_share, expr: "pctOfTotal(measure(revenue))" }
- { id: rev_mom,   expr: "measure(revenue) / lag(measure(revenue), 1) - 1" }
```

Mixing them is a validation error that carries the fix:

```
sum(amount) / measure(orders)
  → an expression cannot mix raw aggregates with measure() references —
    move the aggregate into its own measure and reference that instead
```

This is not pedantry. `sum(amount)` reads one row at a time before grouping;
`measure(orders)` does not exist until after. An engine that accepted both in
one expression would have to guess which one you meant, and the guess would be
wrong silently.

## Composition

`measure(id)` is what makes arithmetic reusable: define it once, reference it
anywhere. Dependencies are resolved with a topological order and a cycle check,
so `a = measure(b)` / `b = measure(a)` is refused rather than looping. Selecting
a composed measure pulls in the aggregates it needs even when the dataset never
named them.

Post measures may reference other post measures. `double_aov = measure(aov) * 2`
works, and the SQL emitter nests it in its own pass — a sibling alias is not
visible to its neighbours in standard SQL.

## Catalogue

### Aggregate — folds raw rows

| Function | Arity | Notes |
|---|---|---|
| `sum(field)` | 1 | Null over an empty group, as in SQL. |
| `count()` | 0 | Rows. |
| `count(field)` | 1 | Non-null values. |
| `countDistinct(field)` | 1 | |
| `countIf(field)` | 1 | Truthy values. |
| `avg(field)` | 1 | |
| `min(field)`, `max(field)` | 1 | Works on strings and dates too. |
| `median(field)` | 1 | The one aggregate that must hold every value. |

### Window — runs over the grouped result

| Function | Arity | Notes |
|---|---|---|
| `lag(x, n?)` | 1–2 | `n` defaults to 1. |
| `lead(x, n?)` | 1–2 | |
| `runningSum(x)` | 1 | Accumulates in the dataset's sort order. |
| `rank(x)` | 1 | Dense rank, largest first. |
| `pctOfTotal(x)` | 1 | Spans the whole partition, so it carries no ordering. |

Ordering matters here: `runningSum` on a by-month dataset must accumulate in
month order. The executor sorts before the post tier, and the SQL emitter gives
every window frame an explicit `ORDER BY` — a subquery's ordering does not
propagate into an outer window, so `over ()` would be non-deterministic on a
real backend even though the in-process executor got it right.

### Scalar — row-wise, either tier

| Function | Arity |
|---|---|
| `if(cond, then, else)` | 3 |
| `coalesce(a, b, …)` | 2–8 |
| `nullif(a, b)` | 2 |
| `round(x, digits?)` | 1–2 |
| `abs(x)`, `floor(x)`, `ceil(x)`, `sqrt(x)` | 1 |
| `dateTrunc(unit, date)` | 2 |
| `dateDiff(unit, a, b)` | 3 |
| `concat(a, b, …)` | 2–8 |
| `lower(s)`, `upper(s)`, `len(s)` | 1 |

## Operators

Arithmetic `+ - * / %`, comparison `= != < <= > >=`, boolean `and or not`,
unary `-`. Precedence is conventional; parentheses group.

**Division is guarded.** `a / b` compiles to `a / nullif(b, 0)` in SQL and
returns null on a zero denominator in process, so a ratio measure over an empty
group is blank rather than an error or an infinity.

## Literals

Numbers, single- or double-quoted strings, `true`, `false`, `null`.

## Limits

An expression is untrusted input, so it is bounded:

| Limit | Value |
|---|---|
| Source length | 2000 characters |
| AST nodes | 500 |
| AST depth | 32 |
| Parser recursion | 64 |
| Function arguments | 16 (a function's own arity is often tighter) |

Parser recursion is capped **during** the parse, not after. Parenthesised
groups collapse to their inner node, so `((((…))))` has an AST depth of 1 no
matter how deep the source nests — the stack has to be bounded while it is
being consumed.

`__proto__`, `constructor` and `prototype` are rejected as field names and as
`measure()` targets.

## Errors

Errors name the position and, where there is an obvious repair, the repair:

```
sum(amoun
  → expected ")" to close the argument list but found end of expression (at character 10)

sm(amount)
  → unknown function sm() — did you mean sum()?
```

In the builder, expressions are checked as you type: each measure shows either
the tier it landed in or exactly what is wrong with it.
