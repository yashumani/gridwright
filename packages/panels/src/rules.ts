import type { Issue } from "@gridwright/schema";
import { ExprSyntaxError, FUNCTIONS, evalRow, parse, walk, type Node } from "@gridwright/expr";
import type { QueryResult, Value } from "@gridwright/engine";

/**
 * Conditional-formatting predicates.
 *
 * These run against a *result* row, not source rows, so a bare identifier means
 * a column of the query result — the opposite of a measure expression, where a
 * bare identifier is a raw column needing an aggregate. Stage analysis is
 * therefore skipped here, and replaced by a narrower rule: scalars only.
 */
export interface CompiledRule {
  test(row: Record<string, Value>): boolean;
}

export function compileRule(source: string): { rule?: CompiledRule; issues: Issue[] } {
  let ast: Node;
  try {
    ast = parse(source);
  } catch (err) {
    if (err instanceof ExprSyntaxError) {
      return { issues: [{ path: "when", message: `${err.message} (at character ${err.pos + 1})` }] };
    }
    throw err;
  }

  const issues: Issue[] = [];
  walk(ast, (n) => {
    if (n.kind === "measure") {
      issues.push({ path: "when", message: "use the column name directly here, not measure()" });
    }
    if (n.kind === "call") {
      const spec = FUNCTIONS[n.name];
      if (!spec) {
        issues.push({ path: "when", message: `unknown function "${n.name}()"` });
      } else if (spec.stage !== "scalar") {
        issues.push({
          path: "when",
          message: `${n.name}() cannot be used in a formatting rule — the row is already aggregated`,
        });
      }
    }
  });
  if (issues.length) return { issues };

  return {
    rule: {
      test(row) {
        try {
          return evalRow(ast, row) === true;
        } catch {
          // A rule that cannot evaluate must not take the table down with it.
          return false;
        }
      },
    },
    issues: [],
  };
}

/** Builds the row object a rule sees: every result column keyed by its id. */
export function resultRow(result: QueryResult, index: number): Record<string, Value> {
  const row: Record<string, Value> = Object.create(null);
  for (const c of result.columns) row[c.id] = result.data[c.key]?.[index] ?? null;
  return row;
}
