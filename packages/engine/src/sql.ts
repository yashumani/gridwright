import { quoteIdent, sqlLiteral, toSql, walk, type Node } from "@gridwright/expr";
import type { Filter, Sort } from "@gridwright/schema";
import { dimKey, measureKey, type PlanMeasure, type QueryPlan } from "./types.js";

/**
 * Plan to SQL, in the same two tiers the in-process executor runs: a grouped
 * inner query, then an outer pass for composed and windowed measures.
 *
 * Nothing here interpolates a manifest string directly — identifiers go through
 * `quoteIdent`, which refuses anything outside the strict pattern, and values
 * through `sqlLiteral`.
 */

/** `"table"."column"` — qualification is mandatory once a query can join. */
const qualify = (table: string, column: string): string =>
  `${quoteIdent(table)}.${quoteIdent(column)}`;

/** Resolves a manifest field name to its qualified column. */
function fieldRef(plan: QueryPlan, name: string): string {
  const origin = plan.fieldMap[name];
  if (!origin) throw new Error(`field "${name}" has no resolved source`);
  return qualify(origin.table, origin.column);
}

function filterSql(f: Filter, expr: string): string {
  switch (f.op) {
    case "in":
      return f.values.length
        ? `${expr} IN (${f.values.map((v) => sqlLiteral(v)).join(", ")})`
        : "FALSE";
    case "between":
      return `${expr} BETWEEN ${sqlLiteral(f.from)} AND ${sqlLiteral(f.to)}`;
    case "eq": return f.value === null ? `${expr} IS NULL` : `${expr} = ${sqlLiteral(f.value)}`;
    case "ne": return f.value === null ? `${expr} IS NOT NULL` : `${expr} <> ${sqlLiteral(f.value)}`;
    case "gt": return `${expr} > ${sqlLiteral(f.value)}`;
    case "gte": return `${expr} >= ${sqlLiteral(f.value)}`;
    case "lt": return `${expr} < ${sqlLiteral(f.value)}`;
    case "lte": return `${expr} <= ${sqlLiteral(f.value)}`;
  }
}

/** Ordering expression list, without the ORDER BY keywords. */
function orderList(sorts: readonly Sort[]): string {
  return sorts
    .map((s) => {
      const col = "measure" in s ? measureKey(s.measure) : dimKey(s.dimension);
      // NULLS LAST matches the executor: an empty cell is not a small one.
      return `${quoteIdent(col)} ${s.dir === "asc" ? "ASC" : "DESC"} NULLS LAST`;
    })
    .join(", ");
}

const orderSql = (sorts: readonly Sort[]): string => orderList(sorts);

/** Drops a repeated sort key, so a restated order does not name a column twice. */
function dedupeSorts(sorts: readonly Sort[]): Sort[] {
  const seen = new Set<string>();
  const out: Sort[] = [];
  for (const s of sorts) {
    const key = "measure" in s ? `m:${s.measure}` : `d:${s.dimension}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Measures an expression references, for tiering the post-aggregate passes. */
function measureRefs(node: Node): string[] {
  const out: string[] = [];
  walk(node, (n) => { if (n.kind === "measure") out.push(n.id); });
  return out;
}

/**
 * Splits post measures into dependency levels.
 *
 * One select list cannot hold both `aov` and `double_aov = measure(aov) * 2`:
 * a sibling alias is not visible to its neighbours in standard SQL, however
 * neatly the in-process executor walks them in order. Each level therefore
 * gets its own pass over the one before it.
 */
function postLevels(post: readonly PlanMeasure[]): PlanMeasure[][] {
  const levelOf = new Map<string, number>();
  const levels: PlanMeasure[][] = [];
  // `post` is topologically ordered, so a post dependency is always placed
  // before the measure that reads it. Aggregate references stay at level 0.
  for (const m of post) {
    let level = 0;
    for (const ref of measureRefs(m.ast)) {
      const at = levelOf.get(ref);
      if (at !== undefined) level = Math.max(level, at + 1);
    }
    levelOf.set(m.id, level);
    (levels[level] ??= []).push(m);
  }
  return levels;
}

export function planToSql(plan: QueryPlan): string {
  const ref = (name: string) => fieldRef(plan, name);
  const dimExpr = (d: QueryPlan["dimensions"][number]) =>
    d.grain ? `date_trunc(${sqlLiteral(d.grain)}, ${ref(d.field)})` : ref(d.field);

  const inner = [
    ...plan.dimensions.map((d) => `${dimExpr(d)} AS ${quoteIdent(dimKey(d.id))}`),
    ...plan.aggregate.map(
      (m) => `${toSql(m.ast, { field: ref, measure: (id) => quoteIdent(measureKey(id)) })} AS ${quoteIdent(measureKey(m.id))}`,
    ),
  ];

  const where = plan.filters
    .map((f) => {
      const d = plan.dimensions.find((x) => x.id === f.dimension);
      if (d) return filterSql(f, dimExpr(d));
      // A filter on a dimension this dataset does not group by still bites, via
      // the field the compiler projected for it — and via that dimension's own
      // grain, since `month` filters a truncated `order_date` rather than some
      // column that happens to go by the name "month".
      const origin = plan.dimensionFields?.[f.dimension];
      if (!origin) throw new Error(`filter on "${f.dimension}" has no resolved field`);
      return filterSql(
        f,
        origin.grain
          ? `date_trunc(${sqlLiteral(origin.grain)}, ${ref(origin.field)})`
          : ref(origin.field),
      );
    })
    .join(" AND ");

  // LEFT, never INNER: a fact row must survive a missing dimension row rather
  // than disappear from the totals.
  const joins = plan.joins.map(
    (j) =>
      `LEFT JOIN ${quoteIdent(j.table)} ON ` +
      `${qualify(j.fromTable, j.fromColumn)} = ${qualify(j.table, j.toColumn)}`,
  );

  const lines = [
    `SELECT ${inner.length ? inner.join(", ") : "1"}`,
    `FROM ${quoteIdent(plan.table)}`,
    ...joins,
  ];
  if (where) lines.push(`WHERE ${where}`);
  if (plan.dimensions.length) {
    lines.push(`GROUP BY ${plan.dimensions.map((d) => dimExpr(d)).join(", ")}`);
  }
  if (plan.preSort.length) lines.push(`ORDER BY ${orderSql(plan.preSort)}`);

  if (!plan.post.length) {
    if (plan.limit) lines.push(`LIMIT ${Math.floor(plan.limit)}`);
    return lines.join("\n");
  }

  // Window frames in the outer pass carry the inner query's ordering
  // explicitly; a subquery's ORDER BY does not propagate into a window.
  const windowOrder = plan.preSort.length ? orderList(plan.preSort) : undefined;
  const project = (ms: readonly PlanMeasure[]): string =>
    ms
      .map(
        (m) => `${toSql(m.ast, {
          field: quoteIdent,
          measure: (id) => quoteIdent(measureKey(id)),
          ...(windowOrder ? { windowOrder } : {}),
        })} AS ${quoteIdent(measureKey(m.id))}`,
      )
      .join(", ");

  // Every level but the last becomes its own CTE; the last is the final
  // select, so a plan whose post measures are independent — very much the
  // common case — still emits a single wrap.
  const levels = postLevels(plan.post);
  const ctes = [`grouped AS (\n${lines.map((l) => `  ${l}`).join("\n")}\n)`];
  let from = "grouped";
  for (let i = 0; i < levels.length - 1; i++) {
    const name = `post_${i + 1}`;
    ctes.push(`${name} AS (\n  SELECT *, ${project(levels[i]!)}\n  FROM ${from}\n)`);
    from = name;
  }

  const wrapped = [
    `WITH ${ctes.join(",\n")}`,
    `SELECT *, ${project(levels.at(-1)!)}`,
    `FROM ${from}`,
  ];

  // A CTE's ORDER BY does not bind the query that reads it, so the display
  // order has to be restated out here. A sort the post tier resolves comes
  // first and anything resolved earlier is the tiebreaker — the same order the
  // executor applies them in.
  const finalSort = dedupeSorts([...plan.postSort, ...plan.preSort]);
  if (finalSort.length) wrapped.push(`ORDER BY ${orderSql(finalSort)}`);
  if (plan.limit) wrapped.push(`LIMIT ${Math.floor(plan.limit)}`);
  return wrapped.join("\n");
}
