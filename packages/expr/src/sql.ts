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
}

export function quoteIdent(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`refusing to emit unsafe SQL identifier ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

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
      return sqlLiteral(node.value);
    case "string":
      return sqlLiteral(node.value);
    case "boolean":
      return sqlLiteral(node.value);
    case "null":
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
