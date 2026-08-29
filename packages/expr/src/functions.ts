/**
 * The function catalogue. This is the whole surface users can compute with, and
 * it is deliberately small — every entry is a permanent support obligation.
 *
 * `stage` decides where a call may appear:
 *   aggregate — folds raw rows, so it belongs in the GROUP BY query
 *   window    — reads across already-grouped rows, so it runs after aggregation
 *   scalar    — row-wise, legal in either stage
 */
export type FnStage = "aggregate" | "window" | "scalar";

export interface FnSpec {
  minArgs: number;
  maxArgs: number;
  stage: FnStage;
  doc: string;
  /** Emits SQL. `args` are already-compiled operand fragments. */
  sql(args: string[]): string;
}

const f = (
  minArgs: number,
  maxArgs: number,
  stage: FnStage,
  doc: string,
  sql: (a: string[]) => string,
): FnSpec => ({ minArgs, maxArgs, stage, doc, sql });

/** Guards against `x / 0` producing Infinity in one engine and an error in another. */
const safeDiv = (a: string, b: string) => `(${a}) / nullif(${b}, 0)`;

export const FUNCTIONS: Readonly<Record<string, FnSpec>> = Object.freeze({
  // ---- aggregate ----
  sum: f(1, 1, "aggregate", "Total of a numeric column.", (a) => `sum(${a[0]})`),
  count: f(0, 1, "aggregate", "Row count, or non-null count of a column.", (a) =>
    a.length ? `count(${a[0]})` : "count(*)"),
  countDistinct: f(1, 1, "aggregate", "Distinct non-null values.", (a) => `count(distinct ${a[0]})`),
  countIf: f(1, 1, "aggregate", "Rows where the condition holds.", (a) =>
    `sum(case when ${a[0]} then 1 else 0 end)`),
  avg: f(1, 1, "aggregate", "Arithmetic mean.", (a) => `avg(${a[0]})`),
  min: f(1, 1, "aggregate", "Smallest value.", (a) => `min(${a[0]})`),
  max: f(1, 1, "aggregate", "Largest value.", (a) => `max(${a[0]})`),
  median: f(1, 1, "aggregate", "50th percentile.", (a) => `median(${a[0]})`),

  // ---- window (post-aggregation) ----
  lag: f(1, 2, "window", "Value n rows earlier in sort order (default 1).", (a) =>
    `lag(${a[0]}, ${a[1] ?? "1"}) over ()`),
  lead: f(1, 2, "window", "Value n rows later in sort order (default 1).", (a) =>
    `lead(${a[0]}, ${a[1] ?? "1"}) over ()`),
  runningSum: f(1, 1, "window", "Cumulative total in sort order.", (a) =>
    `sum(${a[0]}) over (rows between unbounded preceding and current row)`),
  rank: f(1, 1, "window", "Dense rank, largest first.", (a) =>
    `dense_rank() over (order by ${a[0]} desc)`),
  pctOfTotal: f(1, 1, "window", "Share of the column total.", (a) =>
    safeDiv(a[0]!, `sum(${a[0]}) over ()`)),

  // ---- scalar ----
  if: f(3, 3, "scalar", "Conditional: if(test, then, else).", (a) =>
    `case when ${a[0]} then ${a[1]} else ${a[2]} end`),
  coalesce: f(2, 8, "scalar", "First non-null argument.", (a) => `coalesce(${a.join(", ")})`),
  nullif: f(2, 2, "scalar", "Null when the two arguments are equal.", (a) => `nullif(${a[0]}, ${a[1]})`),
  round: f(1, 2, "scalar", "Round to n decimal places (default 0).", (a) =>
    `round(${a[0]}, ${a[1] ?? "0"})`),
  abs: f(1, 1, "scalar", "Absolute value.", (a) => `abs(${a[0]})`),
  floor: f(1, 1, "scalar", "Round down.", (a) => `floor(${a[0]})`),
  ceil: f(1, 1, "scalar", "Round up.", (a) => `ceil(${a[0]})`),
  sqrt: f(1, 1, "scalar", "Square root.", (a) => `sqrt(${a[0]})`),
  dateTrunc: f(2, 2, "scalar", "Bucket a date: dateTrunc('month', d).", (a) =>
    `date_trunc(${a[0]}, ${a[1]})`),
  dateDiff: f(3, 3, "scalar", "Whole units between two dates.", (a) =>
    `date_diff(${a[0]}, ${a[1]}, ${a[2]})`),
  concat: f(2, 8, "scalar", "Join strings.", (a) => `concat(${a.join(", ")})`),
  lower: f(1, 1, "scalar", "Lowercase.", (a) => `lower(${a[0]})`),
  upper: f(1, 1, "scalar", "Uppercase.", (a) => `upper(${a[0]})`),
  len: f(1, 1, "scalar", "String length.", (a) => `length(${a[0]})`),
});

export const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();

/** `measure(id)` is a parse form, not a function — it resolves to another measure. */
export const MEASURE_REF = "measure";

export function describeArity(spec: FnSpec): string {
  if (spec.minArgs === spec.maxArgs) return `${spec.minArgs}`;
  return `${spec.minArgs}–${spec.maxArgs}`;
}
