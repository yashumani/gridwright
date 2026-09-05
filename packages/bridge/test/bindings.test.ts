import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx.js";
import {
  readSkeleton,
  resolveBindings,
  type BindingSpec,
  type MetadataSnapshot,
  type Problem,
} from "../src/bindings.js";

const fixturePath = (p: string) =>
  fileURLToPath(new URL(`../../../fixtures/support-ops/${p}`, import.meta.url));

const readJson = (p: string) => JSON.parse(readFileSync(fixturePath(p), "utf8"));

const workbook = () => readWorkbook("skeleton.xlsx", readFileSync(fixturePath("skeleton.xlsx")));
const metadata = (): MetadataSnapshot => {
  const raw = readJson("sql-metadata.json");
  return { ...raw.snapshot, metrics: raw.metrics, views: raw.views };
};
const bindings = (): BindingSpec => readJson("bindings.json");

/** Codes only — the messages are prose and asserting them whole is brittle. */
const codes = (problems: Problem[]) => problems.map((p) => p.code).sort();

describe("reading the skeleton", () => {
  it("reads the configured rows in the workbook's own order", () => {
    const sheet = workbook().sheets[0]!;
    const rows = readSkeleton(sheet, "RowKey");
    expect(Array.isArray(rows)).toBe(true);
    expect((rows as ReturnType<typeof readSkeleton> & unknown[]).map((r: any) => r.rowKey)).toEqual(
      ["queue_a", "queue_b", "queue_c", "total"],
    );
  });

  it("finds the header by name rather than at a fixed offset", () => {
    // The fixture has a title and a version line above its table. A bridge
    // that always read row 5 would bind the wrong things without saying so.
    const sheet = workbook().sheets[0]!;
    const rows = readSkeleton(sheet, "RowKey") as any[];
    expect(rows[0].ref.address).toBe("A5");
    expect(rows[0].heading).toBe("Queue A");
  });

  it("carries each row's own cell, so a later diagnostic can name it", () => {
    const rows = readSkeleton(workbook().sheets[0]!, "RowKey") as any[];
    expect(rows[2].ref).toMatchObject({ sheet: "Skeleton", address: "A7", row: 7 });
  });

  it("says so when the header column is not there", () => {
    const problem = readSkeleton(workbook().sheets[0]!, "NoSuchColumn");
    expect(Array.isArray(problem)).toBe(false);
    expect((problem as Problem).code).toBe("skeleton-unreadable");
  });
});

describe("a valid binding", () => {
  it("resolves the fixture", () => {
    const out = resolveBindings(workbook(), metadata(), bindings());
    if (!out.ok) throw new Error(`expected a resolution, got ${JSON.stringify(out.problems)}`);
    expect(out.resolution.rows.map((r) => r.rowKey)).toEqual([
      "queue_a",
      "queue_b",
      "queue_c",
      "total",
    ]);
  });

  it("keeps the skeleton's order, not the bindings file's", () => {
    // R14: the skeleton fixes the report's shape. A reordered bindings file is
    // not a reordered report.
    const spec = bindings();
    spec.rows = [...spec.rows].reverse();
    const out = resolveBindings(workbook(), metadata(), spec);
    if (!out.ok) throw new Error("expected a resolution");
    expect(out.resolution.rows.map((r) => r.rowKey)).toEqual([
      "queue_a",
      "queue_b",
      "queue_c",
      "total",
    ]);
  });

  it("binds the queue that has no data, because the skeleton says it exists", () => {
    // Queue C is the fixture's whole point: the view returns nothing for it and
    // it still has to reach the report.
    const out = resolveBindings(workbook(), metadata(), bindings());
    if (!out.ok) throw new Error("expected a resolution");
    const queueC = out.resolution.rows.find((r) => r.rowKey === "queue_c");
    expect(queueC).toBeDefined();
    expect(queueC!.heading).toBe("Queue C");
    expect(queueC!.viewKey).toBe("queue_c");
  });

  it("records both ends of every link", () => {
    const out = resolveBindings(workbook(), metadata(), bindings());
    if (!out.ok) throw new Error("expected a resolution");
    const a = out.resolution.rows[0]!;
    expect(a.provenance.skeleton.address).toBe("A5");
    expect(a.provenance.boundBy).toBe("vw_closed_cases_by_queue.queue_key=queue_a");
  });

  it("records which metadata snapshot it resolved against", () => {
    const out = resolveBindings(workbook(), metadata(), bindings());
    if (!out.ok) throw new Error("expected a resolution");
    expect(out.resolution.snapshot).toEqual({
      source: "synthetic://support-ops",
      capturedAt: "2026-09-05T00:00:00Z",
      version: "0.1",
    });
  });

  it("says the metric's approved definition is not traceable, rather than implying it is", () => {
    // R07 wants definitions traceable to approved knowledge. No knowledge
    // service is wired, and the fixture's definitionRef is deliberately
    // unresolvable, so the gap is reported.
    const out = resolveBindings(workbook(), metadata(), bindings());
    if (!out.ok) throw new Error("expected a resolution");
    expect(out.resolution.diagnostics.join(" ")).toMatch(/traceability is not established/);
  });
});

describe("a duplicate binding", () => {
  it("refuses the same row bound twice", () => {
    const spec = bindings();
    spec.rows = [...spec.rows, { rowKey: "queue_a", kind: "data", viewKey: "queue_a" }];
    const out = resolveBindings(workbook(), metadata(), spec);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("duplicate-row");
  });

  it("refuses two rows reading the same view key", () => {
    // Double-counting into any total over both, and the total is the number
    // people quote.
    const spec = bindings();
    spec.rows = spec.rows.map((r) =>
      r.rowKey === "queue_b" ? { ...r, viewKey: "queue_a" } : r,
    );
    const out = resolveBindings(workbook(), metadata(), spec);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("duplicate-view-key");
    expect(out.problems.find((p) => p.code === "duplicate-view-key")!.message).toMatch(
      /"queue_a" and "queue_b"/,
    );
  });
});

describe("a missing binding", () => {
  it("refuses a skeleton row nothing binds", () => {
    const spec = bindings();
    spec.rows = spec.rows.filter((r) => r.rowKey !== "queue_c");
    const out = resolveBindings(workbook(), metadata(), spec);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    const unbound = out.problems.find((p) => p.code === "unbound-row")!;
    expect(unbound.message).toMatch(/queue_c/);
    // And it names the cell, which is the point of carrying provenance.
    expect(unbound.at?.address).toBe("A7");
  });

  it("refuses a binding for a row the skeleton does not have", () => {
    const spec = bindings();
    spec.rows = [...spec.rows, { rowKey: "queue_z", kind: "data", viewKey: "queue_z" }];
    const out = resolveBindings(workbook(), metadata(), spec);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("unknown-row");
  });

  it("refuses a total spanning a row that is not there", () => {
    const spec = bindings();
    spec.rows = spec.rows.map((r) =>
      r.kind === "total" ? { ...r, over: [...(r.over ?? []), "queue_z"] } : r,
    );
    const out = resolveBindings(workbook(), metadata(), spec);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("total-over-unknown");
  });

  it("refuses an unknown metric or view by name", () => {
    const spec = { ...bindings(), metric: "no_such_metric" };
    const out = resolveBindings(workbook(), metadata(), spec);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("metric-unknown");

    const spec2 = { ...bindings(), view: "no_such_view" };
    const out2 = resolveBindings(workbook(), metadata(), spec2);
    expect(out2.ok).toBe(false);
    if (out2.ok) return;
    expect(codes(out2.problems)).toContain("view-unknown");
  });
});

describe("an incompatible binding", () => {
  it("refuses a grain the metric is not defined at", () => {
    const out = resolveBindings(workbook(), metadata(), { ...bindings(), grain: "agent" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("grain-conflict");
  });

  it("refuses a unit the metric is not defined in", () => {
    const out = resolveBindings(workbook(), metadata(), { ...bindings(), unit: "hours" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("unit-conflict");
  });

  it("refuses a view with no column for the metric", () => {
    const meta = metadata();
    meta.views[0]!.columns = meta.views[0]!.columns.filter((c) => c.role !== "measure");
    const out = resolveBindings(workbook(), meta, bindings());
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("view-missing-column");
  });

  it("refuses a view that cannot identify a row at the binding's grain", () => {
    const meta = metadata();
    meta.views[0]!.columns = meta.views[0]!.columns.map((c) =>
      c.name === "queue_key" ? { ...c, name: "something_else" } : c,
    );
    meta.views[0]!.grain = ["something_else", "period"];
    const out = resolveBindings(workbook(), meta, bindings());
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("cardinality-unusable");
  });

  it("refuses a total over a metric declared non-additive", () => {
    // R08: a metric does not become summable because a row is labelled Total.
    const meta = metadata();
    meta.metrics[0]!.additive = false;
    const out = resolveBindings(workbook(), meta, bindings());
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("total-not-additive");
  });
});

describe("a workbook that disagrees with the metadata", () => {
  /**
   * The sharpest rule in this module. Which source wins is decision D01 and
   * still open, so a disagreement is refused rather than resolved — no silent
   * precedence in either direction.
   */
  it("refuses a grain the workbook and the snapshot disagree about", () => {
    const meta = metadata();
    meta.metrics[0]!.grain = "agent"; // the workbook's Config sheet says "queue"
    const out = resolveBindings(workbook(), meta, { ...bindings(), grain: "agent" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    const conflict = out.problems.find((p) => p.code === "grain-conflict")!;
    expect(conflict.message).toMatch(/the workbook says "queue"/);
    expect(conflict.message).toMatch(/the metadata snapshot says "agent"/);
    // It names the workbook cell, and says why it is not picking a side.
    expect(conflict.at?.sheet).toBe("Config");
    expect(conflict.message).toMatch(/decision D01/);
  });

  it("refuses an additivity the workbook and the snapshot disagree about", () => {
    const meta = metadata();
    meta.metrics[0]!.additive = false; // the workbook declares additive: true
    const out = resolveBindings(workbook(), meta, bindings());
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("additive-conflict");
  });

  it("reports every problem at once rather than one per run", () => {
    const meta = metadata();
    meta.metrics[0]!.grain = "agent";
    meta.metrics[0]!.unit = "hours";
    const spec = bindings();
    spec.rows = [...spec.rows, { rowKey: "queue_z", kind: "data", viewKey: "queue_z" }];
    const out = resolveBindings(workbook(), meta, spec);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems.length).toBeGreaterThanOrEqual(3);
    expect(new Set(codes(out.problems)).size).toBeGreaterThanOrEqual(3);
  });
});

describe("binding is by identity, never by label", () => {
  it("does not bind a row because its heading matches", () => {
    // R07: synchronise by explicit mappings, not label matching. Two rows can
    // share a heading; a heading can be corrected without the row changing.
    // A report that re-binds itself because someone fixed a typo is not
    // reproducible.
    const spec = bindings();
    spec.rows = spec.rows.map((r) =>
      r.rowKey === "queue_a" ? { ...r, rowKey: "Queue A" } : r,
    );
    const out = resolveBindings(workbook(), metadata(), spec);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    // The heading "Queue A" exists in the skeleton, and it still does not bind.
    expect(codes(out.problems)).toContain("unknown-row");
    expect(codes(out.problems)).toContain("unbound-row");
  });

  it("is unaffected by a heading changing, as long as the key holds", () => {
    // The other half of the same rule: renaming a heading must not break a
    // binding either.
    const wb = workbook();
    const heading = wb.sheets[0]!.rows.find((r) => r[0]?.value === "queue_a")![1]!;
    (heading as { value: string | number | boolean | null }).value = "Queue A (renamed)";
    const out = resolveBindings(wb, metadata(), bindings());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.resolution.rows[0]!.heading).toBe("Queue A (renamed)");
  });
});
