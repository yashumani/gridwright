import type { Node } from "./ast.js";
import { FUNCTIONS } from "./functions.js";

/**
 * Evaluation, in the same two tiers the compiler emits:
 *
 *   evalAggregate — folds a group of source rows into one value
 *   evalPostColumn — computes a whole column over the already-grouped result,
 *                    which is what makes window functions expressible at all
 *
 * Both share `applyScalar`, so `round()` cannot mean two different things
 * depending on where it appears.
 */

export type Value = string | number | boolean | null;
export type Row = Record<string, Value>;

const num = (v: Value): number | null => {
  if (v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const truthy = (v: Value): boolean =>
  v !== null && v !== false && v !== 0 && v !== "" && v !== "false";

const cmp = (a: Value, b: Value): number | null => {
  if (a === null || b === null) return null;
  if (typeof a === "number" || typeof b === "number") {
    const x = num(a), y = num(b);
    return x === null || y === null ? null : x - y;
  }
  const x = String(a), y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

export function applyScalar(name: string, args: Value[]): Value {
  switch (name) {
    case "if":
      return truthy(args[0]!) ? args[1]! : args[2]!;
    case "coalesce":
      return args.find((a) => a !== null) ?? null;
    case "nullif":
      return cmp(args[0]!, args[1]!) === 0 ? null : args[0]!;
    case "round": {
      const v = num(args[0]!);
      const p = num(args[1] ?? 0) ?? 0;
      if (v === null) return null;
      const f = 10 ** p;
      return Math.round(v * f) / f;
    }
    case "abs": { const v = num(args[0]!); return v === null ? null : Math.abs(v); }
    case "floor": { const v = num(args[0]!); return v === null ? null : Math.floor(v); }
    case "ceil": { const v = num(args[0]!); return v === null ? null : Math.ceil(v); }
    case "sqrt": { const v = num(args[0]!); return v === null || v < 0 ? null : Math.sqrt(v); }
    case "dateTrunc":
      return truncateDate(String(args[1] ?? ""), String(args[0] ?? "day"));
    case "dateDiff": {
      const unit = String(args[0] ?? "day");
      const a = Date.parse(String(args[1]));
      const b = Date.parse(String(args[2]));
      if (Number.isNaN(a) || Number.isNaN(b)) return null;
      const days = (b - a) / 86_400_000;
      if (unit === "day") return Math.trunc(days);
      if (unit === "week") return Math.trunc(days / 7);
      if (unit === "month") return Math.trunc(days / 30.4375);
      if (unit === "quarter") return Math.trunc(days / 91.3125);
      if (unit === "year") return Math.trunc(days / 365.25);
      return Math.trunc(days);
    }
    case "concat":
      return args.map((a) => (a === null ? "" : String(a))).join("");
    case "lower": return args[0] === null ? null : String(args[0]).toLowerCase();
    case "upper": return args[0] === null ? null : String(args[0]).toUpperCase();
    case "len": return args[0] === null ? null : String(args[0]).length;
    default:
      throw new Error(`no evaluator for scalar function ${name}()`);
  }
}

/** ISO-date bucketing. Dates travel as `YYYY-MM-DD` strings throughout. */
export function truncateDate(value: string, grain: string): Value {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const iso = (year: number, month: number, day: number) =>
    `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  switch (grain) {
    case "year": return iso(y, 0, 1);
    case "quarter": return iso(y, Math.floor(m / 3) * 3, 1);
    case "month": return iso(y, m, 1);
    case "week": {
      const copy = new Date(Date.UTC(y, m, d.getUTCDate()));
      // ISO weeks start Monday.
      copy.setUTCDate(copy.getUTCDate() - ((copy.getUTCDay() + 6) % 7));
      return iso(copy.getUTCFullYear(), copy.getUTCMonth(), copy.getUTCDate());
    }
    default: return iso(y, m, d.getUTCDate());
  }
}

export function applyAggregate(name: string, values: Value[]): Value {
  switch (name) {
    case "count":
      return values.length;
    case "countDistinct": {
      const seen = new Set<string>();
      for (const v of values) if (v !== null) seen.add(`${typeof v}:${String(v)}`);
      return seen.size;
    }
    case "countIf":
      return values.reduce<number>((n, v) => n + (truthy(v) ? 1 : 0), 0);
    case "sum": {
      let total = 0, any = false;
      for (const v of values) { const n = num(v); if (n !== null) { total += n; any = true; } }
      return any ? total : null;
    }
    case "avg": {
      let total = 0, n = 0;
      for (const v of values) { const x = num(v); if (x !== null) { total += x; n++; } }
      return n ? total / n : null;
    }
    case "min":
    case "max": {
      let best: Value = null;
      for (const v of values) {
        if (v === null) continue;
        if (best === null) { best = v; continue; }
        const c = cmp(v, best);
        if (c === null) continue;
        if (name === "min" ? c < 0 : c > 0) best = v;
      }
      return best;
    }
    case "median": {
      const nums = values.map(num).filter((n): n is number => n !== null).sort((a, b) => a - b);
      if (!nums.length) return null;
      const mid = nums.length >> 1;
      return nums.length % 2 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2;
    }
    default:
      throw new Error(`no evaluator for aggregate ${name}()`);
  }
}

function applyBinary(op: string, l: Value, r: Value): Value {
  switch (op) {
    case "and": return truthy(l) && truthy(r);
    case "or": return truthy(l) || truthy(r);
    case "=": return cmp(l, r) === 0;
    case "!=": return cmp(l, r) !== 0;
    case "<": { const c = cmp(l, r); return c === null ? null : c < 0; }
    case "<=": { const c = cmp(l, r); return c === null ? null : c <= 0; }
    case ">": { const c = cmp(l, r); return c === null ? null : c > 0; }
    case ">=": { const c = cmp(l, r); return c === null ? null : c >= 0; }
    default: break;
  }
  const a = num(l), b = num(r);
  if (a === null || b === null) return null;
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    // Matches the SQL emitter's nullif guard rather than yielding Infinity.
    case "/": return b === 0 ? null : a / b;
    case "%": return b === 0 ? null : a % b;
    default: throw new Error(`no evaluator for operator ${op}`);
  }
}

/** Row-wise evaluation, used inside aggregates: `sum(if(returned, amount, 0))`. */
export function evalRow(node: Node, row: Row): Value {
  switch (node.kind) {
    case "number": return node.value;
    case "string": return node.value;
    case "boolean": return node.value;
    case "null": return null;
    case "field": return row[node.name] ?? null;
    case "measure": throw new Error("measure() cannot be evaluated row-wise");
    case "unary": {
      const v = evalRow(node.operand, row);
      if (node.op === "not") return !truthy(v);
      const n = num(v);
      return n === null ? null : -n;
    }
    case "binary":
      return applyBinary(node.op, evalRow(node.left, row), evalRow(node.right, row));
    case "call":
      return applyScalar(node.name, node.args.map((a) => evalRow(a, row)));
  }
}

/** Folds one group of source rows into a single value. */
export function evalAggregate(node: Node, rows: readonly Row[]): Value {
  switch (node.kind) {
    case "number": return node.value;
    case "string": return node.value;
    case "boolean": return node.value;
    case "null": return null;
    case "field":
      throw new Error(`field "${node.name}" used outside an aggregate`);
    case "measure":
      throw new Error("measure() belongs to the post-aggregation tier");
    case "unary": {
      const v = evalAggregate(node.operand, rows);
      if (node.op === "not") return !truthy(v);
      const n = num(v);
      return n === null ? null : -n;
    }
    case "binary":
      return applyBinary(node.op, evalAggregate(node.left, rows), evalAggregate(node.right, rows));
    case "call": {
      const spec = FUNCTIONS[node.name];
      if (!spec) throw new Error(`unknown function ${node.name}()`);
      if (spec.stage === "aggregate") {
        const arg = node.args[0];
        const values = arg ? rows.map((r) => evalRow(arg, r)) : rows.map(() => 1 as Value);
        const kept = node.name === "count" && arg ? values.filter((v) => v !== null) : values;
        return applyAggregate(node.name, kept);
      }
      return applyScalar(node.name, node.args.map((a) => evalAggregate(a, rows)));
    }
  }
}

export interface PostContext {
  rowCount: number;
  /** Already-computed measure columns, keyed by measure id. */
  column(id: string): Value[];
}

const fill = (n: number, v: Value): Value[] => new Array<Value>(n).fill(v);

/** Computes an entire post-aggregation column. Window functions need the column. */
export function evalPostColumn(node: Node, ctx: PostContext): Value[] {
  const n = ctx.rowCount;
  switch (node.kind) {
    case "number": return fill(n, node.value);
    case "string": return fill(n, node.value);
    case "boolean": return fill(n, node.value);
    case "null": return fill(n, null);
    case "field":
      throw new Error(`field "${node.name}" used outside an aggregate`);
    case "measure":
      return ctx.column(node.id);
    case "unary": {
      const v = evalPostColumn(node.operand, ctx);
      return v.map((x) => {
        if (node.op === "not") return !truthy(x);
        const k = num(x);
        return k === null ? null : -k;
      });
    }
    case "binary": {
      const l = evalPostColumn(node.left, ctx);
      const r = evalPostColumn(node.right, ctx);
      return l.map((x, i) => applyBinary(node.op, x, r[i] ?? null));
    }
    case "call": {
      const spec = FUNCTIONS[node.name];
      if (!spec) throw new Error(`unknown function ${node.name}()`);
      if (spec.stage === "window") {
        const col = evalPostColumn(node.args[0]!, ctx);
        const arg = node.args[1] ? evalPostColumn(node.args[1], ctx)[0] : null;
        return applyWindow(node.name, col, num(arg ?? 1) ?? 1);
      }
      if (spec.stage === "aggregate") {
        throw new Error(`${node.name}() belongs to the aggregate tier`);
      }
      const cols = node.args.map((a) => evalPostColumn(a, ctx));
      return Array.from({ length: n }, (_, i) => applyScalar(node.name, cols.map((c) => c[i] ?? null)));
    }
  }
}

export function applyWindow(name: string, col: Value[], offset: number): Value[] {
  const n = col.length;
  switch (name) {
    case "lag":
      return col.map((_, i) => (i - offset >= 0 ? col[i - offset]! : null));
    case "lead":
      return col.map((_, i) => (i + offset < n ? col[i + offset]! : null));
    case "runningSum": {
      let total = 0;
      let any = false;
      return col.map((v) => {
        const x = num(v);
        if (x !== null) { total += x; any = true; }
        return any ? total : null;
      });
    }
    case "rank": {
      const values = col.map(num);
      const sorted = [...new Set(values.filter((v): v is number => v !== null))].sort((a, b) => b - a);
      const ranks = new Map(sorted.map((v, i) => [v, i + 1]));
      return values.map((v) => (v === null ? null : ranks.get(v) ?? null));
    }
    case "pctOfTotal": {
      const total = col.reduce<number>((t, v) => t + (num(v) ?? 0), 0);
      return col.map((v) => {
        const x = num(v);
        return x === null || total === 0 ? null : x / total;
      });
    }
    default:
      throw new Error(`no evaluator for window function ${name}()`);
  }
}
