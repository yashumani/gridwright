import type { Issue } from "@gridwright/schema";
import type { Node } from "./ast.js";
import { FUNCTIONS, FUNCTION_NAMES, MEASURE_REF, describeArity } from "./functions.js";
import { ExprSyntaxError, parse } from "./parse.js";

/**
 * Stage analysis. Gridwright compiles in two tiers — a GROUP BY query, then a
 * pass over its result — so every expression has to belong to exactly one.
 * Catching a mixed expression here turns a baffling runtime result into a
 * validation error with a fix in it.
 */
export type Stage = "aggregate" | "post";

export interface ExprAnalysis {
  ast: Node;
  stage: Stage;
  /** Source columns read, for the aggregate tier. */
  fields: string[];
  /** Other measures referenced, for dependency ordering. */
  measures: string[];
  usesWindow: boolean;
}

const suggest = (name: string): string => {
  const lower = name.toLowerCase();
  const near = FUNCTION_NAMES.find((f) => f.toLowerCase() === lower)
    ?? FUNCTION_NAMES.find((f) => f.toLowerCase().startsWith(lower.slice(0, 3)));
  return near ? ` — did you mean ${near}()?` : "";
};

export function analyzeAst(ast: Node): { analysis?: ExprAnalysis; issues: Issue[] } {
  const issues: Issue[] = [];
  const fields = new Set<string>();
  const measures = new Set<string>();
  let sawAggregate = false;
  let usesWindow = false;

  const add = (message: string) => issues.push({ path: "", message });

  const visit = (node: Node, inAggregate: boolean, inWindow: boolean): void => {
    switch (node.kind) {
      case "field":
        if (!inAggregate) {
          add(
            `"${node.name}" is a raw column and must sit inside an aggregate, ` +
            `e.g. sum(${node.name}) — or reference a measure with measure(id)`,
          );
        } else {
          fields.add(node.name);
        }
        return;

      case "measure":
        measures.add(node.id);
        if (inAggregate) {
          add(`measure(${node.id}) cannot appear inside an aggregate — it is already aggregated`);
        }
        return;

      case "call": {
        const spec = FUNCTIONS[node.name];
        if (!spec) {
          add(`unknown function "${node.name}()"${suggest(node.name)}`);
          for (const a of node.args) visit(a, inAggregate, inWindow);
          return;
        }
        if (node.args.length < spec.minArgs || node.args.length > spec.maxArgs) {
          add(
            `${node.name}() takes ${describeArity(spec)} argument(s) but got ${node.args.length}`,
          );
        }
        if (spec.stage === "aggregate") {
          if (inAggregate) add(`${node.name}() cannot be nested inside another aggregate`);
          if (inWindow) {
            add(
              `${node.name}() cannot be used inside a window function — ` +
              `define it as its own measure and reference it with measure(id)`,
            );
          }
          sawAggregate = true;
          for (const a of node.args) visit(a, true, inWindow);
          return;
        }
        if (spec.stage === "window") {
          if (inWindow) add(`${node.name}() cannot be nested inside another window function`);
          if (inAggregate) add(`${node.name}() cannot be used inside an aggregate`);
          usesWindow = true;
          for (const a of node.args) visit(a, inAggregate, true);
          return;
        }
        for (const a of node.args) visit(a, inAggregate, inWindow);
        return;
      }

      case "unary":
        visit(node.operand, inAggregate, inWindow);
        return;

      case "binary":
        visit(node.left, inAggregate, inWindow);
        visit(node.right, inAggregate, inWindow);
        return;

      default:
        return;
    }
  };

  visit(ast, false, false);

  if (sawAggregate && measures.size > 0) {
    add(
      "an expression cannot mix raw aggregates with measure() references — " +
      "move the aggregate into its own measure and reference that instead",
    );
  }
  if (usesWindow && measures.size === 0 && !sawAggregate) {
    add("a window function needs something aggregated to operate on, e.g. runningSum(measure(revenue))");
  }

  if (issues.length) return { issues };

  return {
    analysis: {
      ast,
      stage: measures.size > 0 || usesWindow ? "post" : "aggregate",
      fields: [...fields],
      measures: [...measures],
      usesWindow,
    },
    issues: [],
  };
}

/** Parses and analyses one expression. Never throws — syntax errors become issues. */
export function analyzeExpression(source: string): { analysis?: ExprAnalysis; issues: Issue[] } {
  let ast: Node;
  try {
    ast = parse(source);
  } catch (err) {
    if (err instanceof ExprSyntaxError) {
      return { issues: [{ path: "", message: `${err.message} (at character ${err.pos + 1})` }] };
    }
    throw err;
  }
  return analyzeAst(ast);
}

export interface MeasureSource {
  id: string;
  expr: string;
}

export interface ModelAnalysis {
  /** Analysis per measure id, in declaration order. */
  byId: Map<string, ExprAnalysis>;
  /** Topological order: a measure always follows everything it references. */
  order: string[];
  issues: Issue[];
}

/**
 * Analyses a whole measure set: resolves measure() references, rejects cycles,
 * and returns an evaluation order the engine can walk straight down.
 */
export function analyzeModel(measures: readonly MeasureSource[]): ModelAnalysis {
  const issues: Issue[] = [];
  const byId = new Map<string, ExprAnalysis>();

  for (const m of measures) {
    const { analysis, issues: local } = analyzeExpression(m.expr);
    for (const i of local) issues.push({ path: `measure ${m.id}`, message: i.message });
    if (analysis) byId.set(m.id, analysis);
  }

  for (const [id, a] of byId) {
    for (const ref of a.measures) {
      if (ref === id) {
        issues.push({ path: `measure ${id}`, message: `measure "${id}" references itself` });
      } else if (!byId.has(ref) && !measures.some((m) => m.id === ref)) {
        issues.push({ path: `measure ${id}`, message: `unknown measure "${ref}"` });
      }
    }
  }

  // Depth-first cycle detection; colour 1 = on the stack, 2 = finished.
  const colour = new Map<string, 1 | 2>();
  const order: string[] = [];
  const stack: string[] = [];
  const reported = new Set<string>();

  const visit = (id: string): void => {
    const c = colour.get(id);
    if (c === 2) return;
    if (c === 1) {
      const cycle = [...stack.slice(stack.indexOf(id)), id].join(" -> ");
      if (!reported.has(cycle)) {
        reported.add(cycle);
        issues.push({ path: `measure ${id}`, message: `circular measure reference: ${cycle}` });
      }
      return;
    }
    colour.set(id, 1);
    stack.push(id);
    for (const ref of byId.get(id)?.measures ?? []) {
      if (byId.has(ref)) visit(ref);
    }
    stack.pop();
    colour.set(id, 2);
    order.push(id);
  };

  for (const id of byId.keys()) visit(id);

  return { byId, order, issues };
}
