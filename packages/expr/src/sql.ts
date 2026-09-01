import { IDENTIFIER } from "@gridwright/schema";
import type { Node } from "./ast.js";
import { FUNCTIONS } from "./functions.js";

/**
 * AST to SQL. Kept separate from evaluation so a pushdown backend and the
 * in-process engine compile from exactly the same tree.
 *
 * Identifiers are checked against the strict pattern before interpolation and
 * literals are emitted through `sqlLiteral` — a manifest string never reaches
 * a query unescaped.
 */

export interface SqlContext {
  /** Column reference for a source field. */
  field(name: string): string;
  /** Column reference for an already-computed measure. */
  measure(id: string): string;
  /**
   * ORDER BY for window frames, without the keywords. Supplying it is what
   * makes `runningSum` and `lag` deterministic on a pushdown backend.
   */
  windowOrder?: string;
  /**
   * Emits a constant. Defaults to an inline ANSI literal; an adapter that
   * binds parameters supplies a placeholder instead and collects the value.
   * See the note on `sqlLiteral` for why binding is the safer default.
   */
  literal?(v: string | number | boolean | null): string;
}

export function quoteIdent(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`refusing to emit unsafe SQL identifier ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

/**
 * An inline SQL constant, escaped for ANSI SQL — Postgres, DuckDB, SQLite,
 * Snowflake, BigQuery.
 *
 * Doubling the quote is the whole of ANSI's escaping, and it is *not* enough
 * for a backend that also treats backslash as an escape character. MySQL and
 * MariaDB do that by default: there, the value `\` closes nothing and the
 * text after it is read as SQL. Rather than pick an escaping that is wrong for
 * one family or the other, `planToSqlParams` binds values as parameters and
 * never interpolates them at all. Prefer it for anything that will actually
 * execute; this function is for display, `gridwright explain`, and backends
 * you know follow ANSI.
 */
export function sqlLiteral(v: string | number | boolean | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("cannot emit a non-finite number as SQL");
    return String(v);
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return `'${v.replace(/'/g, "''")}'`;
}

const BINARY_SQL: Record<string, string> = {
  "+": "+", "-": "-", "*": "*", "%": "%",
  "=": "=", "!=": "<>", "<": "<", "<=": "<=", ">": ">", ">=": ">=",
  and: "AND", or: "OR",
};

export function toSql(node: Node, ctx: SqlContext): string {
  switch (node.kind) {
    case "number":
      return (ctx.literal ?? sqlLiteral)(node.value);
    case "string":
      return (ctx.literal ?? sqlLiteral)(node.value);
    case "boolean":
      return (ctx.literal ?? sqlLiteral)(node.value);
    case "null":
      // NULL is a keyword, not a value: binding it would compare as unknown.
      return "NULL";
    case "field":
      return ctx.field(node.name);
    case "measure":
      return ctx.measure(node.id);
    case "unary":
      return node.op === "-"
        ? `-(${toSql(node.operand, ctx)})`
        : `NOT (${toSql(node.operand, ctx)})`;
    case "binary": {
      const l = toSql(node.left, ctx);
      const r = toSql(node.right, ctx);
      // Division is guarded so a zero denominator yields NULL in every backend.
      if (node.op === "/") return `((${l}) / nullif((${r}), 0))`;
      const op = BINARY_SQL[node.op];
      if (!op) throw new Error(`no SQL mapping for operator ${node.op}`);
      return `((${l}) ${op} (${r}))`;
    }
    case "call": {
      const spec = FUNCTIONS[node.name];
      if (!spec) throw new Error(`no SQL mapping for unknown function ${node.name}()`);
      return spec.sql(
        node.args.map((a) => toSql(a, ctx)),
        ctx.windowOrder ? { windowOrder: ctx.windowOrder } : undefined,
      );
    }
  }
}
