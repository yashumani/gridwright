/**
 * Generates `snapshot.json` — the golden fixture as one analysis snapshot.
 *
 * The workbook reader needs `node:zlib`, so a browser cannot build this for
 * itself. Precomputing it here keeps the demo bundle free of Node builtins and
 * has a second benefit worth the file: it proves a report definition survives
 * JSON, which is what an exported artifact and a stored session both depend on.
 *
 *   node --experimental-strip-types fixtures/support-ops/build-snapshot.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// From the built output rather than the sources: type stripping does not
// rewrite the `.js` specifiers these modules use between themselves, and a
// generator that needs a working build is a generator that cannot emit a
// fixture from code that does not compile.
import {
  readWorkbook,
  resolveBindings,
  compileReport,
  fillReport,
  type BindingSpec,
  type MetadataSnapshot,
  type ViewRow,
} from "../../packages/bridge/dist/index.js";
import { buildSnapshot } from "../../packages/workspace/dist/snapshot.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const json = (p: string) => JSON.parse(readFileSync(here(p), "utf8"));

const wb = readWorkbook("skeleton.xlsx", readFileSync(here("./skeleton.xlsx")));
const raw = json("./sql-metadata.json");
const metadata: MetadataSnapshot = { ...raw.snapshot, metrics: raw.metrics, views: raw.views };

const resolved = resolveBindings(wb, metadata, json("./bindings.json") as BindingSpec);
if (!resolved.ok) throw new Error(`bindings: ${JSON.stringify(resolved.problems)}`);
const compiled = compileReport(wb, resolved.resolution, {});
if (!compiled.ok) throw new Error(`compile: ${JSON.stringify(compiled.problems)}`);

const [header, ...lines] = readFileSync(here("./prepared-view.csv"), "utf8").trim().split(/\r?\n/);
const columns = header!.split(",");
const rows: ViewRow[] = lines.map((line) => {
  const cells = line.split(",");
  return Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? null])) as ViewRow;
});

const report = fillReport(compiled.definition, {
  rows,
  keyColumn: "queue_key",
  periodColumn: "period",
});

const snapshot = buildSnapshot({
  snapshotId: "snap-support-ops-001",
  runId: "run-support-ops-001",
  question: "How many cases did each queue close, against the prior period?",
  scope: {
    tenant: "synthetic",
    user: "demo",
    domain: "support-operations",
    period: { start: "2026-08-01", end: "2026-08-31", label: "Actual" },
    comparison: { start: "2026-07-01", end: "2026-07-31", label: "Prior period" },
    filters: [{ dimension: "queue", values: ["Queue A", "Queue B", "Queue C"] }],
  },
  versions: {
    source: raw.snapshot.version,
    policy: "synthetic-policy-1",
    semantic: raw.snapshot.version,
    configuration: "support-ops-bindings-1",
    result: "res-1",
  },
  chat: {
    status: "ANSWERED",
    decision: { decision_id: "d-demo", verdict: "ACCEPT_INTERNAL" },
    claims: [
      {
        claim_id: "c-total",
        statement: "Closed cases were 120 against 100 in the prior period, a difference of +20.",
        metric_id: "closed_cases",
        value: 120,
        formatted_value: "120",
        comparison_value: 100,
        absolute_change: 20,
        receipt_id: "synthetic-receipt-001",
      },
    ],
    caveats: ["Queue C is configured and the view returned no rows for it."],
    claimsAreReceipted: true,
    untrusted: [],
    diagnostics: [],
  },
  analysis: {
    evidence: {
      analysis_id: "synthetic-receipt-001",
      metric_id: "closed_cases",
      aggregation_method: "sum",
      metric_polarity: "unset",
      actual: 120,
      comparison: 100,
      absolute_change: 20,
      percent_change: 20,
      contributions: [
        { dimension: "queue", value: "Queue A", actual: 70, comparison: 60, absolute_change: 10, share: 0.5 },
        { dimension: "queue", value: "Queue B", actual: 50, comparison: 40, absolute_change: 10, share: 0.5 },
      ],
    },
    reconciles: true,
    unexplained: 0,
    untrusted: [],
    diagnostics: [],
  },
  report,
  complete: true,
  completeness: "complete",
});

const out = here("./snapshot.json");
writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`wrote ${out}`);
