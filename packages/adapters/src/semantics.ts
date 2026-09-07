import type { MetricAdditivity, MetricAggregation } from "./talk2data.js";

/**
 * Reconciling one metric across three products that describe it differently.
 *
 * R07 asks for authoritative definitions to be synchronised by explicit
 * mappings rather than label matching, and for definition, unit and grain
 * conflicts to be resolved *before* computation. This module is where that
 * happens, and writing it surfaced a real gap rather than confirming a tidy
 * one.
 *
 * The three vocabularies, as each project actually defines them:
 *
 * | | aggregation | additivity |
 * |---|---|---|
 * | Talk2Data | `SUM COUNT DISTINCT_COUNT AVERAGE RATIO LAST_VALUE` | `ADDITIVE SEMI_ADDITIVE NON_ADDITIVE` |
 * | Variance | `sum` `average` (support-weighted) `period_end` | implied by the method |
 * | Bridge | `sum` `min` `max` | `additive: boolean` |
 *
 * Three things fall out of that table, and none of them is a naming quibble.
 *
 * **`SEMI_ADDITIVE` crosses intact, now.** A backlog adds across queues and
 * does not add across time — one number, additive on one axis and not the
 * other. Writing this mapping is what showed that the bridge's boolean had no
 * room for it; the bridge's additivity is three-valued because of this file,
 * and the value is carried rather than rounded.
 *
 * **`LAST_VALUE` and `period_end` are the same rule** under two names, and the
 * bridge implements it — but only where the configuration declares which row
 * is last. The mapping carries the rule and notes the condition; the compiler
 * enforces it, because that is where the bindings are.
 *
 * **`AVERAGE` is not one rule.** Variance's is support-weighted; a plain mean
 * of pre-aggregated rows is a different number. The bridge refuses `average`
 * outright, which is compatible in the only way that matters — nothing is
 * silently computed — but the mapping has to say *why* rather than let the
 * agreement look like a coincidence.
 *
 * A conflict here suspends the affected computation and produces a diagnostic.
 * That is the architecture's own rule, and it is the reason this returns
 * problems rather than a best guess.
 */

/** The variance product's aggregation vocabulary. */
export type VarianceAggregation = "sum" | "average" | "period_end";

/** What the bridge implements, from `@gridwright/bridge`. */
export type BridgeAggregation = "sum" | "min" | "max" | "period_end";

export type SemanticProblemCode =
  | "aggregation-unrepresentable"
  | "additivity-unrepresentable"
  | "unit-conflict"
  | "grain-conflict"
  | "version-conflict"
  | "identity-unmapped";

export interface SemanticProblem {
  code: SemanticProblemCode;
  /** Which side the value came from. */
  source: "talk2data" | "variance" | "bridge" | "mapping";
  message: string;
}

/** One metric, as each product names it. Ids, never labels. */
export interface MetricMapping {
  /** The bridge's metric id, as the workbook and bindings use it. */
  bridgeId: string;
  /** Talk2Data's metric id in its semantic registry. */
  talk2dataId?: string;
  /** The variance product's `metric_id`. */
  varianceId?: string;
  /** The approved knowledge object this definition traces to. */
  knowledgeObjectId?: string;
  /** The semantic version the mapping was written against. */
  semanticVersion: string;
}

export interface MetricFacts {
  aggregation: MetricAggregation;
  additivity: MetricAdditivity;
  unit: string;
  grain?: string;
  semanticVersion: string;
}

/** Matches the bridge's own three-valued vocabulary. */
export type BridgeAdditivity = "additive" | "semi_additive" | "non_additive";

export interface BridgeFacts {
  aggregation: BridgeAggregation;
  additivity: BridgeAdditivity;
  unit: string;
  grain: string;
}

export type Reconciliation =
  | { ok: true; bridge: BridgeFacts; notes: string[] }
  | { ok: false; problems: SemanticProblem[] };

/**
 * `LAST_VALUE` and `period_end` name one rule; neither product spells it the
 * same way, and neither spelling is implemented by the bridge.
 */
export const PERIOD_END_ALIASES: readonly string[] = ["LAST_VALUE", "period_end"];

/**
 * Turns Talk2Data's description of a metric into the bridge's, or explains why
 * it cannot.
 *
 * Every refusal names the value that could not be carried across, because the
 * person reading it has to decide whether to change the metric definition or
 * to extend the bridge, and "unsupported" alone answers neither question.
 */
export function reconcileMetric(
  mapping: MetricMapping,
  authoritative: MetricFacts,
  expected?: Partial<BridgeFacts>,
): Reconciliation {
  const problems: SemanticProblem[] = [];
  const notes: string[] = [];

  if (!mapping.talk2dataId) {
    problems.push({
      code: "identity-unmapped",
      source: "mapping",
      message:
        `bridge metric "${mapping.bridgeId}" has no Talk2Data id in the mapping; ` +
        "matching by label is not permitted (R07)",
    });
  }

  if (mapping.semanticVersion !== authoritative.semanticVersion) {
    problems.push({
      code: "version-conflict",
      source: "mapping",
      message:
        `the mapping was written against semantic version "${mapping.semanticVersion}" and ` +
        `the definition is at "${authoritative.semanticVersion}"`,
    });
  }

  // Additivity first: it is the one the bridge's type system cannot hold.
  // The bridge's additivity became three-valued for exactly this reason, so
  // SEMI_ADDITIVE now crosses the boundary intact instead of being refused.
  const additivity: BridgeAdditivity =
    authoritative.additivity === "ADDITIVE"
      ? "additive"
      : authoritative.additivity === "SEMI_ADDITIVE"
        ? "semi_additive"
        : "non_additive";

  let aggregation: BridgeAggregation | undefined;
  switch (authoritative.aggregation) {
    case "SUM":
      aggregation = "sum";
      break;
    case "LAST_VALUE":
      // One rule under two names, and the bridge implements it now — but only
      // where the configuration says which row is last, which is the caller's
      // to supply and is checked at compile time rather than here.
      aggregation = "period_end";
      notes.push(
        "LAST_VALUE maps to the bridge's period_end, which needs an orderColumn declared in the " +
        "bindings. Without one the compiler refuses it rather than picking an arbitrary row",
      );
      break;
    case "AVERAGE":
      problems.push({
        code: "aggregation-unrepresentable",
        source: "talk2data",
        message:
          "AVERAGE needs the weights it was taken over — the variance product's is " +
          "support-weighted — and a plain mean of pre-aggregated rows is a different number",
      });
      break;
    case "RATIO":
    case "DISTINCT_COUNT":
      problems.push({
        code: "aggregation-unrepresentable",
        source: "talk2data",
        message:
          `${authoritative.aggregation} attribution is disabled in the variance product pending ` +
          "a governed strategy, and the bridge does not implement it either",
      });
      break;
    case "COUNT":
      aggregation = "sum";
      notes.push(
        "COUNT is carried as sum: counts of disjoint groups add, which is what the bridge does " +
        "with them. This holds only while the groups do not overlap, which the binding's " +
        "cardinality check already requires",
      );
      break;
  }

  if (expected?.unit !== undefined && expected.unit !== authoritative.unit) {
    problems.push({
      code: "unit-conflict",
      source: "bridge",
      message:
        `the workbook declares unit "${expected.unit}" and the approved definition says ` +
        `"${authoritative.unit}"`,
    });
  }

  if (
    expected?.grain !== undefined &&
    authoritative.grain !== undefined &&
    expected.grain !== authoritative.grain
  ) {
    problems.push({
      code: "grain-conflict",
      source: "bridge",
      message:
        `the workbook declares grain "${expected.grain}" and the approved definition says ` +
        `"${authoritative.grain}"`,
    });
  }

  if (problems.length > 0 || aggregation === undefined) {
    if (aggregation === undefined && problems.length === 0) {
      problems.push({
        code: "aggregation-unrepresentable",
        source: "talk2data",
        message: `aggregation "${authoritative.aggregation}" has no bridge equivalent`,
      });
    }
    return { ok: false, problems };
  }

  return {
    ok: true,
    bridge: {
      aggregation,
      additivity,
      unit: authoritative.unit,
      grain: authoritative.grain ?? expected?.grain ?? "",
    },
    notes,
  };
}

/**
 * Maps the variance product's aggregation onto Talk2Data's, so one metric can
 * be checked against both without either becoming the other's dialect.
 */
export function varianceToAuthoritative(method: VarianceAggregation): MetricAggregation {
  switch (method) {
    case "sum":
      return "SUM";
    case "average":
      return "AVERAGE";
    case "period_end":
      return "LAST_VALUE";
  }
}

/**
 * Whether two products describe the same metric compatibly.
 *
 * Compares the resolved rules, not the words: `period_end` and `LAST_VALUE`
 * agree, and `sum` and `SUM` agree, but a definition the two sides disagree on
 * suspends the computation rather than picking the more convenient side.
 */
export function agreesWithVariance(
  authoritative: MetricFacts,
  varianceMethod: VarianceAggregation,
): SemanticProblem | undefined {
  const asAuthoritative = varianceToAuthoritative(varianceMethod);
  if (asAuthoritative === authoritative.aggregation) return undefined;
  return {
    code: "aggregation-unrepresentable",
    source: "variance",
    message:
      `the variance contract computes this metric as "${varianceMethod}" (${asAuthoritative}) ` +
      `and the approved definition says ${authoritative.aggregation}; the computation is ` +
      "suspended rather than run under one of them",
  };
}
