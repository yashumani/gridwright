# Joins

A dataset can read from several tables. Declare how they connect and the
planner works out the rest.

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

model:
  fields:
    - { name: amount,       type: number, from: orders.amount }
    - { name: region,       type: string, from: customers.region }
    - { name: category,     type: string, from: products.category }
```

Fields name any table, and a dataset mixing them compiles to a single grouped
query with only the joins it actually needs.

## Cardinality is the correctness mechanism

`cardinality` is not metadata. It is the thing that decides whether your numbers
are right.

- `many-to-one` — the left side is the **many** side (the fact table), the right
  side is the **one** side (a dimension table). This is the safe direction:
  every fact row matches at most one dimension row, so the grain is unchanged
  and `sum()` still means what it says.
- `one-to-one` — safe in both directions.

Follow a many-to-one edge **backwards** — from one dimension row out to many
facts — and every row on the many side is repeated. Every `sum` downstream is
then inflated, silently, by a factor nobody can see in the output. This is the
classic BI bug, and it does not announce itself: the dashboard renders, the
numbers look plausible, and they are wrong.

So the planner only ever traverses relations in the safe direction. When the
tables a dataset needs cannot be connected that way, it refuses and says what
the consequence would have been:

```
dataset "bad" cannot be joined without multiplying rows
  Reaching "products" from "customers" means following a one-to-many relation,
  which repeats every row on the many side and would double-count sums. Model
  the shared grain as its own table, or split this into separate datasets.
```

Tables that nothing connects get a different message, because the fix is
different:

```
dataset "bad" reads "orders" and "inventory", which are not connected
  Declare a relation under source.relations that links them.
```

## Two more decisions

**Joins are LEFT, never INNER.** A fact row whose dimension row is missing
survives under a null group rather than vanishing from the totals. Losing rows
is a wrong answer wearing a smaller number, and it is harder to notice than an
obviously blank category. The `orders-star` example ships with a deliberate
orphan — a customer id present in the facts and absent from the dimension —
so this behaviour is visible rather than theoretical.

**Join keys carry their type.** Numeric `1` does not match the string `"1"`. A
key column typed differently in two files is a data problem worth seeing, not
one to paper over with coercion.

## How it executes

The planner picks a base table and the join steps that reach the rest, pruning
hops no field needs. Base choice is deterministic, so a plan hash stays a usable
cache key.

Each step is a hash join, built once and indexed by base row — about half a
second for 400 000 facts against a 5 000-row dimension table. Join indexes are
cached across queries: they depend on the data, not on the filters, and
cross-filtering only ever changes the filters. That is why clicking through a
star schema stays fast after the first query.

## Not supported

Each of these is refused by name rather than approximated:

- **Many-to-many.** There is no correct single answer without a bridge table
  and an explicit rule for it.
- **Self-joins.**
- **Datasets whose tables connect only through a one-to-many hop.** See above.

If you need one of these, the honest workaround today is to pre-join upstream —
in the warehouse, or with a script — and hand Gridwright a table at the grain
you want.
