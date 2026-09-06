import { describeFinding, scanText, type Finding } from "@gridwright/contracts";
import { AdapterError, classify, type Transport } from "./transport.js";

/**
 * A typed client for Talk2Data's domain admission and query contracts (T12).
 *
 * Every enum below is that project's own vocabulary, copied rather than
 * paraphrased. That is deliberate and it is the expensive part: ten verdicts
 * is more than a caller wants, and collapsing them to `ok | not ok` would be
 * the single most damaging thing this adapter could do. `OUT_OF_DOMAIN`,
 * `VALID_NO_SOURCE`, `SOURCE_NOT_READY`, `CONFLICTING_DEFINITIONS` and `DENY`
 * are five different things to say to a person, and four of them are not
 * failures.
 *
 * **Admission comes before data.** R02 and scenario A04 both require an
 * out-of-domain or ambiguous question to be refused or clarified *before* any
 * data is touched. `admit()` is therefore a separate call that returns a
 * decision, and `ask()` refuses to run without one — not as a convention but
 * because the compiled query is only issued for a verdict that accepts.
 *
 * **A receipt is carried, never made.** Talk2Data issues `QueryReceipt` with
 * its own plan, SQL and result hashes and its own coverage window. This code
 * copies those fields and adds nothing. R19 is explicit that adapters'
 * receipts are preserved rather than replaced with unsupported claims, and a
 * result hash this adapter recomputed would be a claim about a computation it
 * did not perform.
 *
 * **A model here decides nothing.** Talk2Data's own README is clear that
 * models do not define metrics, grant access, receive credentials or calculate
 * certified results. Nothing in this file calls a model, and the interpreter
 * mode it reports is information about how the *question* was read, never
 * about whether the answer is trustworthy.
 */

/** Talk2Data's admission verdicts, verbatim. */
export type QuestionVerdict =
  | "ACCEPT_INTERNAL"
  | "ACCEPT_KNOWLEDGE"
  | "ACCEPT_EXTERNAL_AUGMENTED"
  | "CLARIFY"
  | "VALID_NO_SOURCE"
  | "OUT_OF_DOMAIN"
  | "INVALID_ANALYTIC_REQUEST"
  | "DENY"
  | "CONFLICTING_DEFINITIONS"
  | "SOURCE_NOT_READY";

export type QuestionIntent =
  | "METRIC_LOOKUP"
  | "TREND_ANALYSIS"
  | "COMPARISON"
  | "DRIVER_ANALYSIS"
  | "KNOWLEDGE_LOOKUP"
  | "UNKNOWN";

export type MetricAggregation =
  | "SUM"
  | "COUNT"
  | "DISTINCT_COUNT"
  | "AVERAGE"
  | "RATIO"
  | "LAST_VALUE";

export type MetricAdditivity = "ADDITIVE" | "SEMI_ADDITIVE" | "NON_ADDITIVE";

export type ComparisonType = "NONE" | "PRIOR_PERIOD" | "YEAR_OVER_YEAR";

export type TimeGrain = "HOUR" | "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR";

export type ChatStatus =
  | "ANSWERED"
  | "CLARIFICATION_REQUIRED"
  | "OUT_OF_DOMAIN"
  | "DENIED"
  | "NO_SOURCE"
  | "SOURCE_NOT_READY"
  | "CONTEXT_NOT_CONNECTED"
  | "INVALID"
  | "VERIFICATION_FAILED";

/** The verdicts that permit a query to be compiled and run. */
export const ACCEPTING_VERDICTS: readonly QuestionVerdict[] = [
  "ACCEPT_INTERNAL",
  "ACCEPT_KNOWLEDGE",
  "ACCEPT_EXTERNAL_AUGMENTED",
];

export interface QuestionDecision {
  decision_id: string;
  verdict: QuestionVerdict;
  intent?: QuestionIntent;
  /** Why, in the service's own words. Untrusted text — it is scanned. */
  explanation?: string;
  clarifying_questions?: string[];
  metric_ids?: string[];
  domain_id?: string;
}

/** Talk2Data's compiled query, carried without alteration. */
export interface BusinessQueryIR {
  query_id: string;
  session_id: string;
  decision_id: string;
  tenant_id: string;
  user_id: string;
  question: string;
  recognized_intent: QuestionIntent;
  metric_id: string;
  metric_name: string;
  semantic_version: string;
  value_type: string;
  aggregation: MetricAggregation;
  additivity: MetricAdditivity;
  unit: string;
  currency?: string | null;
  dimensions?: string[];
  time_window: unknown;
  comparison: unknown;
  source_connector_id: string;
  domain_pack_version: string;
  semantic_snapshot_hash: string;
  plan_hash: string;
  requires_external_context?: boolean;
  warnings?: string[];
}

/** Talk2Data's receipt, field for field. Nothing here is recomputed. */
export interface QueryReceipt {
  receipt_id: string;
  query_id: string;
  decision_id: string;
  plan_hash: string;
  connector_id: string;
  executed_at: string;
  source_snapshot: string;
  coverage_start: string;
  coverage_end: string;
  resolved_start: string;
  resolved_end: string;
  comparison_start?: string | null;
  comparison_end?: string | null;
  row_count: number;
  result_rows: Record<string, unknown>[];
  result_hash: string;
  sql_hash: string;
  physical_mapping_version?: string | null;
  physical_mapping_hash?: string | null;
  data_quality_status: string;
  data_quality_checks?: string[];
  policy_decision_id: string;
  warnings?: string[];
}

export interface CertifiedClaim {
  claim_id: string;
  statement: string;
  metric_id: string;
  dimensions?: Record<string, string>;
  value: number;
  formatted_value: string;
  comparison_value?: number | null;
  absolute_change?: number | null;
  percent_change?: number | null;
  receipt_id: string;
}

export interface AskResult {
  status: ChatStatus;
  decision: QuestionDecision;
  /** Present only when a query was compiled and run. */
  queryIr?: BusinessQueryIR;
  receipt?: QueryReceipt;
  claims: CertifiedClaim[];
  caveats: string[];
  /** True when every claim traces to a receipt this call actually received. */
  claimsAreReceipted: boolean;
  untrusted: Finding[];
  diagnostics: string[];
}

export interface Talk2DataOptions {
  admitPath?: string;
  askPath?: string;
  maxTextLength?: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export class Talk2DataClient {
  private readonly transport: Transport;
  private readonly admitPath: string;
  private readonly askPath: string;
  private readonly maxTextLength: number;

  constructor(transport: Transport, options: Talk2DataOptions = {}) {
    this.transport = transport;
    this.admitPath = options.admitPath ?? "/api/v1/questions/decide";
    this.askPath = options.askPath ?? "/api/v1/chat";
    this.maxTextLength = options.maxTextLength ?? 2000;
  }

  /**
   * Decides whether a question may reach data at all.
   *
   * Separate from `ask` on purpose: A04 requires the refusal to happen before
   * data access, and two calls make that ordering something a test can observe
   * rather than something a comment claims.
   */
  async admit(question: string, domainId?: string): Promise<QuestionDecision> {
    const response = await this.transport({
      method: "POST",
      path: this.admitPath,
      body: { question, ...(domainId ? { domain_id: domainId } : {}) },
    });

    const failure = classify(response.status, "talk2data");
    if (failure && failure.kind === "forbidden") {
      return { decision_id: "", verdict: "DENY", explanation: "denied by the service" };
    }
    if (failure) throw failure;
    if (!isObject(response.body) || typeof response.body["verdict"] !== "string") {
      throw new AdapterError("malformed", "talk2data returned no verdict", "talk2data");
    }
    return response.body as unknown as QuestionDecision;
  }

  /**
   * Runs an admitted question and returns the certified answer with its receipt.
   *
   * Refuses to call the service at all for a verdict that does not accept.
   * That refusal is the enforcement point for "clarify or decline before data
   * access" — the request is never issued, so there is nothing to trust the
   * service to have skipped.
   */
  async ask(question: string, decision: QuestionDecision, sessionId?: string): Promise<AskResult> {
    if (!ACCEPTING_VERDICTS.includes(decision.verdict)) {
      return {
        status: statusForVerdict(decision.verdict),
        decision,
        claims: [],
        caveats: decision.explanation ? [decision.explanation] : [],
        claimsAreReceipted: true,
        untrusted: scanText(decision.explanation, "decision.explanation", {
          maxLength: this.maxTextLength,
        }),
        diagnostics: [],
      };
    }

    const response = await this.transport({
      method: "POST",
      path: this.askPath,
      body: {
        question,
        decision_id: decision.decision_id,
        ...(sessionId ? { session_id: sessionId } : {}),
      },
    });

    const failure = classify(response.status, "talk2data");
    if (failure && failure.kind === "forbidden") {
      return {
        status: "DENIED",
        decision,
        claims: [],
        caveats: ["denied by the service"],
        claimsAreReceipted: true,
        untrusted: [],
        diagnostics: [],
      };
    }
    if (failure) throw failure;
    if (!isObject(response.body)) {
      throw new AdapterError("malformed", "talk2data returned no answer", "talk2data");
    }

    const body = response.body as Record<string, unknown>;
    const receipt = isObject(body["receipt"]) ? (body["receipt"] as unknown as QueryReceipt) : undefined;
    const answer = isObject(body["answer"]) ? (body["answer"] as Record<string, unknown>) : undefined;
    const claims = Array.isArray(answer?.["claims"])
      ? (answer!["claims"] as CertifiedClaim[])
      : [];

    // R09: a numerical claim is released only with receipt linkage. A claim
    // pointing at a receipt this call did not receive is not linked to
    // anything a caller can check, so it is reported rather than displayed.
    const claimsAreReceipted =
      claims.length === 0 || claims.every((c) => receipt !== undefined && c.receipt_id === receipt.receipt_id);

    const untrusted: Finding[] = [];
    const scan = (v: unknown, path: string) =>
      untrusted.push(...scanText(v, path, { maxLength: this.maxTextLength }));

    scan(decision.explanation, "decision.explanation");
    scan(body["message"], "answer.message");
    if (answer) {
      scan(answer["headline"], "answer.headline");
      scan(answer["text"], "answer.text");
    }
    claims.forEach((c, i) => scan(c.statement, `answer.claims[${i}].statement`));
    const caveats = Array.isArray(answer?.["caveats"]) ? (answer!["caveats"] as string[]) : [];
    caveats.forEach((c, i) => scan(c, `answer.caveats[${i}]`));

    const diagnostics = untrusted.map(describeFinding);
    if (!claimsAreReceipted) {
      diagnostics.push(
        "a certified claim referenced a receipt that did not arrive with it; the claim is not traceable",
      );
    }

    return {
      status: (body["status"] as ChatStatus) ?? "INVALID",
      decision,
      ...(isObject(body["query_ir"]) ? { queryIr: body["query_ir"] as unknown as BusinessQueryIR } : {}),
      ...(receipt ? { receipt } : {}),
      claims,
      caveats,
      claimsAreReceipted,
      untrusted,
      diagnostics,
    };
  }
}

/** The chat status that corresponds to a non-accepting verdict. */
export function statusForVerdict(verdict: QuestionVerdict): ChatStatus {
  switch (verdict) {
    case "CLARIFY":
      return "CLARIFICATION_REQUIRED";
    case "OUT_OF_DOMAIN":
      return "OUT_OF_DOMAIN";
    case "DENY":
      return "DENIED";
    case "VALID_NO_SOURCE":
      return "NO_SOURCE";
    case "SOURCE_NOT_READY":
      return "SOURCE_NOT_READY";
    case "CONFLICTING_DEFINITIONS":
    case "INVALID_ANALYTIC_REQUEST":
      return "INVALID";
    default:
      return "ANSWERED";
  }
}

/**
 * Whether a status means the user should be shown numbers.
 *
 * One function rather than a comparison repeated at every call site, because
 * the mistake this prevents — treating `NO_SOURCE` or `VERIFICATION_FAILED` as
 * an answer with nothing in it — is exactly the mistake that gets made when
 * each caller re-derives the rule.
 */
export function isAnswered(status: ChatStatus): boolean {
  return status === "ANSWERED";
}
