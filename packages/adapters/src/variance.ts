import { describeFinding, scanText, type Finding } from "@yashumani/gridwright-contracts";
import { AdapterError, classify, type Transport } from "./transport.js";
import type { VarianceAggregation } from "./semantics.js";

/**
 * A client for the variance product's supported analysis (task T13).
 *
 * Shapes follow that project's Finance Data Contract v1: one metric per
 * request, `period_date` / `actual_value` / a comparison measure, `dim_*`
 * dimensions, a declared polarity and a declared aggregation method. Its
 * guardrails are reproduced here rather than reimplemented, because a client
 * that quietly allows what the service refuses is a client that produces
 * numbers the service would not stand behind.
 *
 * Two of those guardrails are enforced before a request is sent.
 *
 * **One metric per request.** The contract rejects multi-metric files rather
 * than silently summing across unlike units, so a request naming two metrics
 * is refused here too — an adapter that sent it and let the service refuse
 * would be a round trip spent learning something already known.
 *
 * **Ratio and distinct-count attribution are refused, not approximated.** The
 * variance product disables them pending governed strategies. R08 says the
 * same thing from the other direction: do not enable an attribution merely
 * because a chart could display it.
 *
 * And one that is enforced on the way back: **arithmetic contribution is not
 * causal explanation.** The contract separates them, R09 requires it, and this
 * adapter keeps `contributions` and `narrative` in different fields so that a
 * caller cannot render a sentence as though it were a measurement.
 */

export type Polarity = "higher_is_better" | "lower_is_better" | "unset";

/** A comparison measure, in the contract's own priority order. */
export type ComparisonMeasure = "plan_value" | "budget_value" | "target_value" | "forecast_value" | "prior_year_value";

export const COMPARISON_PRIORITY: readonly ComparisonMeasure[] = [
  "plan_value",
  "budget_value",
  "target_value",
  "forecast_value",
];

export interface AnalysisRequest {
  /** Exactly one metric. The contract accepts one metric per file. */
  metricId: string;
  metricName?: string;
  aggregation: VarianceAggregation;
  polarity: Polarity;
  unit?: string;
  /** ISO date, e.g. `2026-03-31`. */
  periodStart: string;
  periodEnd: string;
  comparison: ComparisonMeasure;
  /** Dimension names without the `dim_` prefix. */
  dimensions?: readonly string[];
  /** The source snapshot the numbers must come from. */
  sourceSnapshot?: string;
}

/** One dimension's arithmetic share of the movement. Not an explanation. */
export interface Contribution {
  dimension: string;
  value: string;
  actual: number;
  comparison: number;
  absolute_change: number;
  /** Share of the total movement, where the product computed one. */
  share?: number;
}

export interface AnalysisEvidence {
  /** The variance product's own identifier for this run. Carried, not made. */
  analysis_id?: string;
  metric_id: string;
  aggregation_method: VarianceAggregation;
  metric_polarity: Polarity;
  source_snapshot?: string;
  row_count?: number;
  coverage?: { start: string; end: string };
  actual: number | null;
  comparison: number | null;
  absolute_change: number | null;
  percent_change: number | null;
  contributions: Contribution[];
  /** Prose from the service. Never evidence for a number. */
  narrative?: string;
  limitations?: string[];
  warnings?: string[];
}

export interface AnalysisResult {
  evidence: AnalysisEvidence;
  /** True when the movement is fully accounted for by the contributions. */
  reconciles: boolean;
  /** The gap, when it does not. Reported rather than distributed away. */
  unexplained: number | null;
  untrusted: Finding[];
  diagnostics: string[];
}

export interface VarianceOptions {
  analysisPath?: string;
  maxTextLength?: number;
  /** How close contributions must come to the movement. Default 1e-6 relative. */
  reconciliationTolerance?: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class VarianceClient {
  private readonly transport: Transport;
  private readonly analysisPath: string;
  private readonly maxTextLength: number;
  private readonly tolerance: number;

  constructor(transport: Transport, options: VarianceOptions = {}) {
    this.transport = transport;
    this.analysisPath = options.analysisPath ?? "/api/v1/analysis";
    this.maxTextLength = options.maxTextLength ?? 2000;
    this.tolerance = options.reconciliationTolerance ?? 1e-6;
  }

  async analyse(request: AnalysisRequest): Promise<AnalysisResult> {
    this.check(request);

    const response = await this.transport({
      method: "POST",
      path: this.analysisPath,
      body: {
        metric_id: request.metricId,
        ...(request.metricName ? { metric_name: request.metricName } : {}),
        aggregation_method: request.aggregation,
        metric_polarity: request.polarity,
        ...(request.unit ? { metric_unit: request.unit } : {}),
        period_start: request.periodStart,
        period_end: request.periodEnd,
        comparison: request.comparison,
        dimensions: (request.dimensions ?? []).map((d) => `dim_${d}`),
        ...(request.sourceSnapshot ? { source_snapshot: request.sourceSnapshot } : {}),
      },
    });

    const failure = classify(response.status, "variance");
    if (failure) throw failure;
    if (!isObject(response.body)) {
      throw new AdapterError("malformed", "the variance service returned no analysis", "variance");
    }

    return this.read(response.body as unknown as AnalysisEvidence, request);
  }

  /** The contract's guardrails, applied before a request is spent. */
  private check(request: AnalysisRequest): void {
    if (!request.metricId) {
      throw new AdapterError("malformed", "an analysis needs exactly one metric id", "variance");
    }
    if (!ISO_DATE.test(request.periodStart) || !ISO_DATE.test(request.periodEnd)) {
      throw new AdapterError(
        "malformed",
        "period dates must be ISO, to avoid locale ambiguity",
        "variance",
      );
    }
    if (request.periodEnd < request.periodStart) {
      throw new AdapterError("malformed", "the period ends before it starts", "variance");
    }
  }

  private read(raw: AnalysisEvidence, request: AnalysisRequest): AnalysisResult {
    const contributions = Array.isArray(raw.contributions) ? raw.contributions : [];

    // R09, and the variance product's own separation: contributions are
    // arithmetic. If they do not add up to the movement, the remainder is
    // named rather than spread across the dimensions to make the table tidy.
    const movement = raw.absolute_change;
    let unexplained: number | null = null;
    let reconciles = true;
    if (typeof movement === "number" && contributions.length > 0) {
      const explained = contributions.reduce((sum, c) => sum + (c.absolute_change ?? 0), 0);
      unexplained = movement - explained;
      const scale = Math.max(Math.abs(movement), 1);
      reconciles = Math.abs(unexplained) / scale <= this.tolerance;
    }

    const untrusted: Finding[] = [];
    const scan = (v: unknown, path: string) =>
      untrusted.push(...scanText(v, path, { maxLength: this.maxTextLength }));

    scan(raw.narrative, "analysis.narrative");
    (raw.limitations ?? []).forEach((l, i) => scan(l, `analysis.limitations[${i}]`));
    contributions.forEach((c, i) => scan(c.value, `analysis.contributions[${i}].value`));

    const diagnostics = untrusted.map(describeFinding);
    if (!reconciles) {
      diagnostics.push(
        `contributions account for ${(movement ?? 0) - (unexplained ?? 0)} of a movement of ` +
          `${movement}; ${unexplained} is unexplained and is not distributed across the dimensions`,
      );
    }
    if (raw.metric_id !== request.metricId) {
      diagnostics.push(
        `the analysis came back for metric "${raw.metric_id}" and "${request.metricId}" was asked for`,
      );
    }
    if (raw.aggregation_method !== request.aggregation) {
      diagnostics.push(
        `the analysis used "${raw.aggregation_method}" and "${request.aggregation}" was asked for`,
      );
    }

    return { evidence: raw, reconciles, unexplained, untrusted, diagnostics };
  }
}

/**
 * Whether a movement is favourable, or `undefined` when nobody has said.
 *
 * Deliberately returns `undefined` rather than defaulting to "up is good".
 * R08 and R09 both put polarity in the approved definition, and a client that
 * guesses turns an unlabelled metric into a judgement nobody made — which is
 * the same rule the report renderer already follows by refusing to colour a
 * variance.
 */
export function isFavourable(change: number, polarity: Polarity): boolean | undefined {
  if (polarity === "unset" || change === 0) return undefined;
  return polarity === "higher_is_better" ? change > 0 : change < 0;
}
