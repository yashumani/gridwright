import { describe, expect, it, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readWorkbook } from "@gridwright/bridge";
import {
  resolveBindings,
  compileReport,
  fillReport,
  type BindingSpec,
  type MetadataSnapshot,
  type ViewRow,
} from "@gridwright/bridge";
import type { AnalysisResult, AskResult } from "@gridwright/adapters";
import {
  Workspace,
  buildSnapshot,
  isTrustworthy,
  reconcile,
  type AnalysisSnapshot,
  type SnapshotScope,
  type SnapshotVersions,
} from "../src/index.js";

/**
 * T16 — one snapshot behind both surfaces.
 *
 * The plan asks for a full journey where chat, analytics and report values
 * reconcile. The browser half is `scripts/verify-a05.mjs`; this is the half
 * that can be checked without a browser: that the values are the same values,
 * and that when they are not, the page says so before it says anything else.
 */

beforeEach(cleanup);

/**
 * Resolved from the working directory rather than from `import.meta.url`.
 *
 * Under jsdom `import.meta.url` resolves to the document's base, so a relative
 * fixture path lands at the filesystem root and every read fails on a file
 * nobody ever meant to open.
 */
const fixturePath = (p: string) => resolve(process.cwd(), "fixtures/support-ops", p);
const readJson = (p: string) => JSON.parse(readFileSync(fixturePath(p), "utf8"));

/** The golden fixture's report, filled from its own prepared view. */
function report() {
  const wb = readWorkbook("skeleton.xlsx", readFileSync(fixturePath("skeleton.xlsx")));
  const raw = readJson("sql-metadata.json");
  const metadata: MetadataSnapshot = { ...raw.snapshot, metrics: raw.metrics, views: raw.views };
  const resolved = resolveBindings(wb, metadata, readJson("bindings.json") as BindingSpec);
  if (!resolved.ok) throw new Error("bindings failed");
  const compiled = compileReport(wb, resolved.resolution, {});
  if (!compiled.ok) throw new Error("compile failed");

  const [header, ...lines] = readFileSync(fixturePath("prepared-view.csv"), "utf8").trim().split(/\r?\n/);
  const columns = header!.split(",");
  const rows: ViewRow[] = lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? null])) as ViewRow;
  });

  return fillReport(compiled.definition, { rows, keyColumn: "queue_key", periodColumn: "period" });
}

const scope: SnapshotScope = {
  tenant: "acme",
  user: "u-1042",
  domain: "support-operations",
  period: { start: "2026-08-01", end: "2026-08-31", label: "August 2026" },
  comparison: { start: "2026-07-01", end: "2026-07-31", label: "July 2026" },
  filters: [{ dimension: "queue", values: ["Queue A", "Queue B"] }],
};

const versions: SnapshotVersions = {
  source: "src-1",
  policy: "pol-1",
  semantic: "sem-2026-09-01",
  configuration: "cfg-1",
  result: "res-1",
};

const chat = (over: Partial<AskResult["claims"][number]> = {}): AskResult => ({
  status: "ANSWERED",
  decision: { decision_id: "d-1", verdict: "ACCEPT_INTERNAL" },
  claims: [
    {
      claim_id: "c-1",
      statement: "Closed cases were 120 in August 2026.",
      metric_id: "closed_cases",
      value: 120,
      formatted_value: "120",
      receipt_id: "r-88213",
      ...over,
    },
  ],
  caveats: [],
  claimsAreReceipted: true,
  untrusted: [],
  diagnostics: [],
});

const analysis = (actual = 120): AnalysisResult => ({
  evidence: {
    analysis_id: "r-88213",
    metric_id: "closed_cases",
    aggregation_method: "sum",
    metric_polarity: "unset",
    actual,
    comparison: 100,
    absolute_change: actual - 100,
    percent_change: 20,
    contributions: [],
  },
  reconciles: true,
  unexplained: null,
  untrusted: [],
  diagnostics: [],
});

const snapshot = (over: Parameters<typeof buildSnapshot>[0] | undefined = undefined): AnalysisSnapshot =>
  buildSnapshot(
    over ?? {
      snapshotId: "snap-1",
      runId: "run-1",
      question: "How many cases closed in August?",
      scope,
      versions,
      chat: chat(),
      analysis: analysis(),
      report: report(),
      complete: true,
      completeness: "complete",
    },
  );

describe("the golden fixture reconciles across every surface", () => {
  it("shows the same 120 in the answer and the report", () => {
    // A05, as arithmetic rather than as a hope: the chat's certified claim and
    // the bridge's total row are the same number.
    const s = snapshot();
    expect(reconcile(s)).toEqual([]);
    expect(isTrustworthy(s)).toBe(true);

    const total = s.report!.rows.find((r) => r.kind === "total")!;
    expect(total.cells["actual"]!.value).toBe(120);
    expect(s.values.find((v) => v.id === "analysis:actual")!.value).toBe(120);
    expect(s.claims[0]!.valueId).toBe("claim:c-1");
  });

  it("says so when the report draws a number the analysis did not measure", () => {
    // The failure that destroys a page's credibility: a chat saying one figure
    // beside a table showing another. Both defensible alone.
    const s = snapshot({
      snapshotId: "snap-2",
      runId: "run-1",
      question: "q",
      scope,
      versions,
      chat: chat(),
      analysis: analysis(119),
      report: report(),
      complete: true,
      completeness: "complete",
    });
    const problems = reconcile(s);
    expect(problems.map((p) => p.code)).toContain("report-disagrees");
    expect(isTrustworthy(s)).toBe(false);
  });

  it("reports a value nobody can trace, even when it is right", () => {
    // R09 releases a claim only *with* linkage. A right number nobody can
    // trace is the one quoted in a meeting and then not defensible.
    const noReceipt = chat();
    delete (noReceipt.claims[0] as { receipt_id?: string }).receipt_id;
    const s = snapshot({
      snapshotId: "snap-3",
      runId: "run-1",
      question: "q",
      scope,
      versions,
      chat: noReceipt,
      complete: true,
      completeness: "complete",
    });
    expect(reconcile(s).map((p) => p.code)).toContain("value-without-receipt");
  });
});

describe("the snapshot is one object, not three", () => {
  it("is frozen, so no surface can adjust a number on the way to the screen", () => {
    const s = snapshot();
    expect(Object.isFrozen(s)).toBe(true);
    expect(() => {
      (s as { question: string }).question = "something else";
    }).toThrow();
  });

  it("carries one period and one filter list for every surface to read", () => {
    const s = snapshot();
    expect(s.scope.period.label).toBe("August 2026");
    expect(s.scope.filters).toHaveLength(1);
  });
});

describe("the page renders what the snapshot says", () => {
  it("draws the scope every surface shares", () => {
    render(<Workspace snapshot={snapshot()} />);
    expect(screen.getByTestId("period")).toHaveTextContent("August 2026");
    expect(screen.getByTestId("comparison")).toHaveTextContent("July 2026");
    expect(screen.getByTestId("filters")).toHaveTextContent("queue: Queue A");
    expect(screen.getByTestId("semantic-version")).toHaveTextContent("sem-2026-09-01");
  });

  it("draws the receipt beside the figure rather than hiding it in a tooltip", () => {
    // Nobody hovers to check a number they already believe.
    render(<Workspace snapshot={snapshot()} />);
    expect(screen.getByTestId("receipt-0")).toHaveTextContent("r-88213");
  });

  it("says a figure is untraceable rather than drawing it plain", () => {
    const noReceipt = chat();
    delete (noReceipt.claims[0] as { receipt_id?: string }).receipt_id;
    render(
      <Workspace
        snapshot={snapshot({
          snapshotId: "s",
          runId: "r",
          question: "q",
          scope,
          versions,
          chat: noReceipt,
          complete: true,
          completeness: "complete",
        })}
      />,
    );
    expect(screen.getByTestId("receipt-0")).toHaveTextContent("cannot be traced");
  });

  it("puts a disagreement above the numbers, not below them", () => {
    render(
      <Workspace
        snapshot={snapshot({
          snapshotId: "s",
          runId: "r",
          question: "q",
          scope,
          versions,
          chat: chat(),
          analysis: analysis(119),
          report: report(),
          complete: true,
          completeness: "complete",
        })}
      />,
    );
    const alert = screen.getByTestId("disagreement");
    const body = document.querySelector(".gww-body")!;
    expect(alert.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("labels a partial answer as partial", () => {
    render(
      <Workspace
        snapshot={snapshot({
          snapshotId: "s",
          runId: "r",
          question: "q",
          scope,
          versions,
          chat: chat(),
          complete: false,
          completeness: "partial — analytics did not contribute",
        })}
      />,
    );
    expect(screen.getByTestId("partial")).toHaveTextContent("analytics did not contribute");
  });

  it("renders the report's rows, including the one with no data", () => {
    // R14 survives all the way to this surface: Queue C is on the page.
    render(<Workspace snapshot={snapshot()} />);
    expect(screen.getByText("Queue C")).toBeInTheDocument();
  });
});

describe("restricted context reads as restricted", () => {
  it("says the context exists and was not returned", () => {
    const s = snapshot({
      snapshotId: "s",
      runId: "r",
      question: "q",
      scope,
      versions,
      chat: chat(),
      context: {
        usable: false,
        decision: "denied",
        packId: "",
        question: "q",
        objects: [],
        citations: [],
        evidence: [],
        caveats: [],
        missingContext: [],
        confidence: undefined,
        freshness: { status: "unknown" },
        droppedUnpublished: [],
        untrusted: [],
        diagnostics: [],
      },
      complete: true,
      completeness: "complete",
    });
    render(<Workspace snapshot={s} />);
    expect(screen.getByTestId("context-denied")).toHaveTextContent("It exists; it was not returned");
  });

  it("shows citations with their versions when context was allowed", () => {
    const s = snapshot({
      snapshotId: "s",
      runId: "r",
      question: "q",
      scope,
      versions,
      chat: chat(),
      context: {
        usable: true,
        decision: "allowed",
        packId: "ctx-1",
        question: "q",
        objects: [{ id: "o1", type: "Metric", title: "Closed cases", status: "published" }],
        citations: [
          { object_id: "o1", source_id: "s1", source_version_id: "v7", quote: "A closed case is…", locator: "2.1" },
        ],
        evidence: [],
        caveats: ["Tags settle after 24 hours."],
        missingContext: [],
        confidence: 0.9,
        freshness: { status: "fresh", oldest_source_age_days: 3 },
        droppedUnpublished: [],
        untrusted: [],
        diagnostics: [],
      },
      complete: true,
      completeness: "complete",
    });
    render(<Workspace snapshot={s} />);
    expect(screen.getByTestId("citations")).toHaveTextContent("v7");
    expect(screen.getByTestId("caveats")).toHaveTextContent("24 hours");
    expect(screen.getByTestId("freshness")).toHaveTextContent("fresh");
  });
});
