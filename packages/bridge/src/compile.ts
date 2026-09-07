import { analyzeModel } from "@gridwright/expr";
import type { Issue } from "@gridwright/schema";
import type { CellRef, SheetRead, WorkbookRead } from "./xlsx.js";
import { readConfigTable } from "./bindings.js";
import type {
  BindingResolution,
  MetricDefinition,
  Problem,
  ProblemCode,
  ViewDefinition,
} from "./bindings.js";

/**
 * Compiles a resolved binding into a report definition, deterministically.
 *
 * The definition says what the report *is* — every configured row in the
 * skeleton's order, what each row reads or computes, what must be fetched to
 * fill it, and where each of those facts came from. It does not fetch anything
 * and it does not compute a value.
 *
 * Three requirements decide the shape.
 *
 * **R13: unknown rules fail explicitly.** A configured rule this compiler does
 * not understand stops the compile and is named. The tempting alternative —
 * skipping it with a warning — produces a report that is quietly missing a line
 * somebody configured, which is the failure mode hardest to notice downstream.
 *
 * **R14: the skeleton survives whatever the query returns.** Every configured
 * row reaches the definition, including one the view will have no data for, and
 * the blank policy is read from configuration rather than assumed. A blank and
 * a zero are different claims about the business; guessing between them is not
 * this compiler's to do, so an undeclared or unrecognised policy is an error.
 *
 * **R15: calculations go through the governed expression system.** Row formulas
 * are parsed and analysed by `@gridwright/expr` — the same parser the manifest
 * uses — so `analyzeModel` supplies reference resolution, cycle detection and
 * an evaluation order, and the bridge does not grow a second semantic registry
 * the architecture note explicitly forbids. It also settles R15's "no raw
 * JavaScript or unrestricted SQL from metadata" by construction: that system is
 * a parser over a fixed grammar, never an evaluator, so a configuration cell
 * containing code is a syntax error rather than a payload.
 */

export type DefinitionRowKind = "data" | "total" | "calculated";

/**
 * How a row with no data is reported. Declared in configuration, never
 * inferred — R14 requires the policy to be explicit.
 */
export type BlankPolicy = "not_available" | "zero" | "blank";

const BLANK_POLICIES: readonly string[] = ["not_available", "zero", "blank"];

export interface DefinitionRow {
  rowKey: string;
  heading: string;
  indent: number;
  kind: DefinitionRowKind;
  /** `data`: the view key this row reads. */
  viewKey?: string;
  /** `total`: the row keys it spans. */
  over?: string[];
  /** `calculated`: the configured expression, as written. */
  expr?: string;
  /** `calculated`: row keys it reads, resolved from the expression. */
  dependsOn?: string[];
}

/** What has to be fetched before the definition can be filled. */
export interface ExecutionRequirement {
  view: string;
  metric: string;
  grain: string;
  /** Distinct view keys the data rows need. */
  keys: string[];
  periods: Record<string, string>;
  /** The column that orders rows within a key and period, when one is needed. */
  orderColumn?: string;
}

export interface RowProvenance {
  /** The workbook cell that configured this row. */
  skeleton: CellRef;
  /** How the row gets its number, in words. */
  boundBy: string;
}

export interface ReportDefinition {
  metric: MetricDefinition;
  view: ViewDefinition;
  /** Every configured row, in the skeleton's order. R14. */
  rows: DefinitionRow[];
  /** Calculated rows in dependency order; a row always follows what it reads. */
  evaluationOrder: string[];
  execution: ExecutionRequirement;
  blankPolicy: BlankPolicy;
  provenance: Record<string, RowProvenance>;
  snapshot: { source: string; capturedAt: string; version: string };
  diagnostics: string[];
}

export type CompileOutcome =
  | { ok: true; definition: ReportDefinition }
  | { ok: false; problems: Problem[] };

/** Extra codes this stage can raise, beyond the binding stage's. */
export type CompileProblemCode =
  | ProblemCode
  | "blank-policy-missing"
  | "blank-policy-unknown"
  | "rule-unsupported"
  | "reference-unknown"
  | "dependency-cycle"
  | "division-by-zero"
  | "aggregation-unsupported";

/**
 * The rules for combining several view rows into one cell that this bridge
 * actually implements.
 *
 * Short on purpose. A metric declared `average` needs the weights the average
 * was taken over, and a `period_end` metric needs to know which row is last —
 * neither is recoverable from a prepared view alone, so neither is implemented,
 * and A03 says a metric that is not additive must not inherit sum behaviour.
 * Summing one anyway would produce a number that looks right and is not.
 */
export const SUPPORTED_AGGREGATIONS = ["sum", "min", "max", "period_end"] as const;
export type Aggregation = (typeof SUPPORTED_AGGREGATIONS)[number];

/**
 * `period_end` needs to know which row is last, and only the binding can say.
 *
 * It was refused outright until now for exactly that reason: a prepared view
 * arrives in whatever order the query returned, and picking "the last one" from
 * an unordered set is picking an arbitrary one. With an explicit ordering
 * column declared in the bindings there is a real answer, so the rule is
 * supported *when the configuration supplies the ordering* and refused when it
 * does not — which is the same standard the rest of this bridge holds to.
 */
export const ORDERED_AGGREGATIONS: readonly Aggregation[] = ["period_end"];

/** A calculated row, as configuration declares it. */
export interface CalculatedRow {
  rowKey: string;
  /** An expression over other rows, e.g. `measure(queue_a) + measure(queue_b)`. */
  expr: string;
}

export interface CompileInput {
  /** Calculated rows, keyed to skeleton rows that must already exist. */
  calculated?: CalculatedRow[];
}

/**
 * `analyzeModel` reports a cycle and an unknown reference in prose. Sorting its
 * issues into codes keeps a caller from string-matching on wording that is free
 * to improve.
 */
function classify(issue: Issue): CompileProblemCode {
  if (/circular|references itself/i.test(issue.message)) return "dependency-cycle";
  if (/unknown measure/i.test(issue.message)) return "reference-unknown";
  return "rule-unsupported";
}

/** A literal zero on the right of a division, which no runtime value can rescue. */
function dividesByLiteralZero(expr: string): boolean {
  return /\/\s*0+(\.0*)?\s*(\)|$|[+\-*/])/.test(expr);
}

function readBlankPolicy(
  config: SheetRead | undefined,
  problems: Problem[],
): BlankPolicy | undefined {
  if (!config) {
    problems.push({
      code: "blank-policy-missing" as ProblemCode,
      message: 'no "Config" sheet, so the blank/zero/not-available policy is undeclared',
    });
    return undefined;
  }
  const entry = readConfigTable(config).get("blank_policy");
  if (!entry || entry.value.value === null) {
    problems.push({
      code: "blank-policy-missing" as ProblemCode,
      message:
        "configuration declares no blank_policy. A row with no data and a row measuring zero " +
        "are different claims, and which one an empty row means is not this compiler's to guess",
    });
    return undefined;
  }
  const declared = String(entry.value.value);
  if (!BLANK_POLICIES.includes(declared)) {
    problems.push({
      code: "blank-policy-unknown" as ProblemCode,
      message: `blank_policy "${declared}" is not one of ${BLANK_POLICIES.join(", ")}`,
      at: entry.value.ref,
    });
    return undefined;
  }
  return declared as BlankPolicy;
}

/**
 * Compiles a resolved binding, plus any configured calculations, into a report
 * definition — or returns every problem found.
 */
export function compileReport(
  workbook: WorkbookRead,
  resolution: BindingResolution,
  input: CompileInput = {},
): CompileOutcome {
  const problems: Problem[] = [];
  const diagnostics = [...resolution.diagnostics];

  const blankPolicy = readBlankPolicy(
    workbook.sheets.find((s) => s.name === "Config"),
    problems,
  );

  // The metric's own combination rule, checked before anything reads data.
  //
  // Two ways this fails, and they are different mistakes. An aggregation this
  // build does not implement would otherwise be silently summed, which is the
  // exact behaviour A03 forbids. And `sum` on a metric declared non-additive is
  // a contradiction in the configuration itself — summing *is* additive — so
  // the configuration is refused rather than one half of it quietly winning.
  const aggregation = resolution.metric.aggregation;
  if (!(SUPPORTED_AGGREGATIONS as readonly string[]).includes(aggregation)) {
    problems.push({
      code: "aggregation-unsupported" as ProblemCode,
      message:
        `metric "${resolution.metric.id}" declares aggregation "${aggregation}", which this ` +
        `bridge does not implement (it implements ${SUPPORTED_AGGREGATIONS.join(", ")}). ` +
        "Summing it instead would report a number the source never computed",
    });
  } else if (aggregation === "sum" && resolution.metric.additivity === "non_additive") {
    problems.push({
      code: "aggregation-unsupported" as ProblemCode,
      message:
        `metric "${resolution.metric.id}" is declared non-additive and aggregated by "sum", ` +
        "which cannot both be true",
    });
  } else if (
    (ORDERED_AGGREGATIONS as readonly string[]).includes(aggregation) &&
    !resolution.orderColumn
  ) {
    problems.push({
      code: "aggregation-unsupported" as ProblemCode,
      message:
        `metric "${resolution.metric.id}" is aggregated by "${aggregation}", which needs to know ` +
        "which row is last. Declare an `orderColumn` in the bindings; without one, picking a " +
        "last row from a prepared view is picking an arbitrary one",
    });
  }

  const bound = new Map(resolution.rows.map((r) => [r.rowKey, r]));
  const calculated = input.calculated ?? [];

  // A calculation has to name a row that exists, before the expression system
  // is asked anything about it.
  for (const c of calculated) {
    if (!bound.has(c.rowKey)) {
      problems.push({
        code: "unknown-row",
        message: `a calculation is configured for row "${c.rowKey}", which the skeleton does not contain`,
      });
    }
    if (dividesByLiteralZero(c.expr)) {
      problems.push({
        code: "division-by-zero" as ProblemCode,
        message: `row "${c.rowKey}" divides by a literal zero`,
        at: bound.get(c.rowKey)?.provenance.skeleton,
      });
    }
  }

  // Every row becomes a node in one graph, so a calculation can reference a
  // data row or a total and the ordering comes out right. A data row's own
  // "expression" is the metric it reads; the expression system needs it
  // present, not interesting.
  const readsMetric = `sum(${resolution.metric.id})`;
  const sources = [
    ...resolution.rows
      .filter((r) => !calculated.some((c) => c.rowKey === r.rowKey))
      .map((r) => ({ id: r.rowKey, expr: readsMetric })),
    ...calculated.map((c) => ({ id: c.rowKey, expr: c.expr })),
  ];

  const model = analyzeModel(sources);
  for (const issue of model.issues) {
    problems.push({
      code: classify(issue) as ProblemCode,
      message: `${issue.path}: ${issue.message}`,
    });
  }

  if (problems.length > 0) return { ok: false, problems };
  if (!blankPolicy) return { ok: false, problems };

  // --- the definition ------------------------------------------------------
  const calcByKey = new Map(calculated.map((c) => [c.rowKey, c]));
  const provenance: Record<string, RowProvenance> = {};

  const rows: DefinitionRow[] = resolution.rows.map((r) => {
    const calc = calcByKey.get(r.rowKey);
    if (calc) {
      const dependsOn = model.byId.get(r.rowKey)?.measures ?? [];
      provenance[r.rowKey] = {
        skeleton: r.provenance.skeleton,
        boundBy: `calculated: ${calc.expr}`,
      };
      return {
        rowKey: r.rowKey,
        heading: r.heading,
        indent: r.indent,
        kind: "calculated",
        expr: calc.expr,
        dependsOn,
      };
    }

    provenance[r.rowKey] = { skeleton: r.provenance.skeleton, boundBy: r.provenance.boundBy };

    if (r.rowType === "total") {
      return {
        rowKey: r.rowKey,
        heading: r.heading,
        indent: r.indent,
        kind: "total",
        over: r.over ?? [],
      };
    }
    return {
      rowKey: r.rowKey,
      heading: r.heading,
      indent: r.indent,
      kind: "data",
      ...(r.viewKey !== undefined ? { viewKey: r.viewKey } : {}),
    };
  });

  // Only the rows that read the view need fetching. A total and a calculation
  // are derived from rows already being fetched, and asking the source for them
  // would be a second, unreconciled answer to the same question.
  const keys = [...new Set(rows.filter((r) => r.viewKey).map((r) => r.viewKey!))];

  if (blankPolicy === "zero") {
    // Allowed, and worth saying out loud: it makes an absent row indistinguishable
    // from a measured zero in everything downstream.
    diagnostics.push(
      'blank_policy is "zero": rows the view returns nothing for will read as measured zeros',
    );
  }

  return {
    ok: true,
    definition: {
      metric: resolution.metric,
      view: resolution.view,
      rows,
      evaluationOrder: model.order,
      execution: {
        view: resolution.view.id,
        metric: resolution.metric.id,
        grain: resolution.metric.grain,
        keys,
        periods: resolution.periods,
        ...(resolution.orderColumn ? { orderColumn: resolution.orderColumn } : {}),
      },
      blankPolicy,
      provenance,
      snapshot: resolution.snapshot,
      diagnostics,
    },
  };
}
