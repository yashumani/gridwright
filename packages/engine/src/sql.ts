import { quoteIdent, sqlLiteral, toSql } from "@gridwright/expr";
import type { Filter, Sort } from "@gridwright/schema";
import { dimKey, measureKey, type QueryPlan } from "./types.js";

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
      // the field the compiler projected for it.
      return filterSql(f, plan.fieldMap[f.dimension] ? ref(f.dimension) : quoteIdent(f.dimension));
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
  const outer = plan.post.map(
    (m) => `${toSql(m.ast, {
      field: quoteIdent,
      measure: (id) => quoteIdent(measureKey(id)),
      ...(windowOrder ? { windowOrder } : {}),
    })} AS ${quoteIdent(measureKey(m.id))}`,
  );

  const wrapped = [
    "WITH grouped AS (",
    lines.map((l) => `  ${l}`).join("\n"),
    ")",
    `SELECT *, ${outer.join(", ")}`,
    "FROM grouped",
  ];
  if (plan.postSort.length) wrapped.push(`ORDER BY ${orderSql(plan.postSort)}`);
  if (plan.limit) wrapped.push(`LIMIT ${Math.floor(plan.limit)}`);
  return wrapped.join("\n");
}
