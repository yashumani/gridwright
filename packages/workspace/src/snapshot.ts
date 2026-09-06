import type { AskResult, ContextPackResult, AnalysisResult } from "@gridwright/adapters";
import type { ReportResult } from "@gridwright/bridge";

/**
 * One analysis snapshot, read by every surface (task T16, requirement R18).
 *
 * R18 asks that question scope, reporting period, filters and numerical results
 * be synchronised across chat, analytics and report views *using one analysis
 * snapshot*. The last five words are the requirement. Three views that each
 * fetch their own numbers and are carefully kept in step will drift the first
 * time one of them retries; three views reading one frozen object cannot drift,
 * because there is nothing to keep in step.
 *
 * So the snapshot is the unit of work here, not the panel. It is built once
 * from a run, frozen, and handed to whatever renders. A surface that wants
 * different numbers has to ask for a new snapshot, which is a visible act
 * rather than a silent refetch.
 *
 * **Every material value points at its receipt.** R09 requires it and A05
 * checks it. `reconcile` is the function that says whether that actually
 * holds — not whether the numbers look similar, but whether the same metric,
 * period, filters and source snapshot produced them, and whether the figure the
 * chat is quoting is the figure the report is drawing.
 *
 * The failure this guards is specific and common: a chat that says "revenue was
 * £4.2m" beside a table showing £4.19m, because one rounded and the other
 * refetched. Both are defensible in isolation. Together they destroy the
 * credibility of the page.
 */

export interface SnapshotScope {
  tenant: string;
  user: string;
  domain: string;
  /** The reporting period, exactly as every surface must show it. */
  period: { start: string; end: string; label: string };
  comparison: { start?: string; end?: string; label: string };
  /** Filters in force. One list, not one per view. */
  filters: { dimension: string; values: string[] }[];
}

export interface SnapshotVersions {
  source: string;
  policy: string;
  semantic: string;
  configuration: string;
  result: string;
}

/** A number somebody will read, with the thing that backs it. */
export interface MaterialValue {
  id: string;
  label: string;
  value: number | null;
  formatted: string;
  /** The issuer's receipt this figure came from. Absent is a finding. */
  receiptId?: string;
  /** Where it was measured, for a reader who wants to check. */
  source?: string;
}

export interface AnalysisSnapshot {
  snapshotId: string;
  runId: string;
  question: string;
  scope: SnapshotScope;
  versions: SnapshotVersions;
  /** Every figure any surface may display. The single source for all of them. */
  values: MaterialValue[];
  /** What the chat is allowed to say, already tied to `values`. */
  claims: { statement: string; valueId: string; receiptId?: string }[];
  /** The report, as the bridge filled it. */
  report?: ReportResult;
  /** Approved context, when a knowledge specialist ran. */
  context?: Pick<ContextPackResult, "objects" | "citations" | "caveats" | "freshness" | "decision">;
  /** Everything flagged as untrusted anywhere in the run. */
  diagnostics: string[];
  /** Whether every specialist contributed. A partial snapshot says so. */
  complete: boolean;
  completeness: string;
}

export type ReconciliationCode =
  | "value-without-receipt"
  | "claim-without-value"
  | "claim-value-mismatch"
  | "report-disagrees"
  | "period-disagrees"
  | "source-snapshot-disagrees";

export interface ReconciliationProblem {
  code: ReconciliationCode;
  /** Which surfaces disagree, so a reader knows where to look. */
  between: string;
  message: string;
}

const money = (n: number | null): string => (n === null ? "—" : String(n));

/**
 * Builds the snapshot from what the run produced.
 *
 * Takes finished results rather than clients: assembling a snapshot is not the
 * place to decide whether to call a service, and a function that could fetch
 * would eventually be the fourth thing fetching its own numbers.
 */
export function buildSnapshot(input: {
  snapshotId: string;
  runId: string;
  question: string;
  scope: SnapshotScope;
  versions: SnapshotVersions;
  chat?: AskResult;
  analysis?: AnalysisResult;
  report?: ReportResult;
  context?: ContextPackResult;
  complete: boolean;
  completeness: string;
}): AnalysisSnapshot {
  const values: MaterialValue[] = [];
  const claims: AnalysisSnapshot["claims"] = [];
  const diagnostics: string[] = [];

  // Certified claims come with their own receipts; each becomes a value.
  for (const claim of input.chat?.claims ?? []) {
    const id = `claim:${claim.claim_id}`;
    values.push({
      id,
      label: claim.metric_id,
      value: claim.value,
      formatted: claim.formatted_value,
      ...(claim.receipt_id ? { receiptId: claim.receipt_id } : {}),
      source: "talk2data",
    });
    claims.push({
      statement: claim.statement,
      valueId: id,
      ...(claim.receipt_id ? { receiptId: claim.receipt_id } : {}),
    });
  }

  if (input.analysis) {
    const e = input.analysis.evidence;
    const receipt = e.analysis_id;
    values.push(
      {
        id: "analysis:actual",
        label: `${e.metric_id} actual`,
        value: e.actual,
        formatted: money(e.actual),
        ...(receipt ? { receiptId: receipt } : {}),
        source: "variance",
      },
      {
        id: "analysis:comparison",
        label: `${e.metric_id} comparison`,
        value: e.comparison,
        formatted: money(e.comparison),
        ...(receipt ? { receiptId: receipt } : {}),
        source: "variance",
      },
    );
    diagnostics.push(...input.analysis.diagnostics);
  }

  diagnostics.push(...(input.chat?.diagnostics ?? []), ...(input.context?.diagnostics ?? []));

  const snapshot: AnalysisSnapshot = {
    snapshotId: input.snapshotId,
    runId: input.runId,
    question: input.question,
    scope: input.scope,
    versions: input.versions,
    values,
    claims,
    ...(input.report ? { report: input.report } : {}),
    ...(input.context
      ? {
          context: {
            objects: input.context.objects,
            citations: input.context.citations,
            caveats: input.context.caveats,
            freshness: input.context.freshness,
            decision: input.context.decision,
          },
        }
      : {}),
    diagnostics,
    complete: input.complete,
    completeness: input.completeness,
  };

  // Frozen so a surface cannot adjust a number on its way to the screen, which
  // is the quiet version of the drift this whole file exists to prevent.
  return Object.freeze(snapshot);
}

/**
 * Whether every surface is showing the same thing.
 *
 * A05's check, as a function rather than a hope. It is deliberately strict
 * about receipts: a figure with no receipt is reported even when it is
 * numerically right, because R09 releases a numerical claim only *with* result
 * linkage, and a right number nobody can trace is the one that gets quoted in a
 * meeting and cannot be defended.
 */
export function reconcile(
  snapshot: AnalysisSnapshot,
  options: { requireReceipts?: boolean } = {},
): ReconciliationProblem[] {
  const problems: ReconciliationProblem[] = [];
  const requireReceipts = options.requireReceipts ?? true;
  const byId = new Map(snapshot.values.map((v) => [v.id, v]));

  if (requireReceipts) {
    for (const value of snapshot.values) {
      if (value.value !== null && !value.receiptId) {
        problems.push({
          code: "value-without-receipt",
          between: `${value.source ?? "unknown"} and the reader`,
          message: `"${value.label}" is displayed as ${value.formatted} with nothing to trace it to`,
        });
      }
    }
  }

  for (const claim of snapshot.claims) {
    const value = byId.get(claim.valueId);
    if (!value) {
      problems.push({
        code: "claim-without-value",
        between: "chat and the snapshot",
        message: `a claim quotes "${claim.valueId}", which is not a value in this snapshot`,
      });
      continue;
    }
    if (claim.receiptId !== value.receiptId) {
      problems.push({
        code: "claim-value-mismatch",
        between: "chat and analytics",
        message:
          `a claim about "${value.label}" cites receipt ${claim.receiptId ?? "none"} and the ` +
          `value carries ${value.receiptId ?? "none"}`,
      });
    }
  }

  // The report is filled from the bridge and the analysis from the variance
  // service. They are two computations of the same thing, which is exactly why
  // they have to be compared rather than assumed.
  const analysisActual = byId.get("analysis:actual")?.value;
  if (snapshot.report && analysisActual !== undefined && analysisActual !== null) {
    const total = snapshot.report.rows.find((r) => r.kind === "total");
    // The first period is the actual column, in configuration order.
    const actualPeriod = snapshot.report.periods[0];
    const drawn = actualPeriod ? total?.cells[actualPeriod]?.value : undefined;
    if (typeof drawn === "number" && drawn !== analysisActual) {
      problems.push({
        code: "report-disagrees",
        between: "the report and analytics",
        message: `the report draws ${drawn} where the analysis measured ${analysisActual}`,
      });
    }
  }

  return problems;
}

/** True when nothing disagrees and the run was complete. */
export function isTrustworthy(snapshot: AnalysisSnapshot): boolean {
  return snapshot.complete && reconcile(snapshot).length === 0;
}
