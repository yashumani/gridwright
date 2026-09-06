import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx.js";
import { resolveBindings, type BindingSpec, type MetadataSnapshot } from "../src/bindings.js";
import { compileReport, type CalculatedRow, type ReportDefinition } from "../src/compile.js";
import { fillReport, type ViewRow } from "../src/fill.js";

const fixturePath = (p: string) =>
  fileURLToPath(new URL(`../../../fixtures/support-ops/${p}`, import.meta.url));
const readJson = (p: string) => JSON.parse(readFileSync(fixturePath(p), "utf8"));

/** The fixture's view, parsed straight from its CSV so the file is the input. */
function preparedView(): ViewRow[] {
  const [header, ...lines] = readFileSync(fixturePath("prepared-view.csv"), "utf8")
    .trim()
    .split(/\r?\n/);
  const columns = header!.split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? null])) as ViewRow;
  });
}

function definition(calculated?: CalculatedRow[]): ReportDefinition {
  const wb = readWorkbook("skeleton.xlsx", readFileSync(fixturePath("skeleton.xlsx")));
  const raw = readJson("sql-metadata.json");
  const metadata: MetadataSnapshot = { ...raw.snapshot, metrics: raw.metrics, views: raw.views };
  const bindings: BindingSpec = readJson("bindings.json");

  const resolved = resolveBindings(wb, metadata, bindings);
  if (!resolved.ok) throw new Error(`binding failed: ${JSON.stringify(resolved.problems)}`);
  const compiled = compileReport(wb, resolved.resolution, { calculated });
  if (!compiled.ok) throw new Error(`compile failed: ${JSON.stringify(compiled.problems)}`);
  return compiled.definition;
}

const fill = (calculated?: CalculatedRow[]) =>
  fillReport(definition(calculated), {
    rows: preparedView(),
    keyColumn: "queue_key",
    periodColumn: "period",
  });

const row = (r: ReturnType<typeof fill>, key: string) => r.rows.find((x) => x.rowKey === key)!;

describe("the golden fixture, filled end to end", () => {
  const expected = readJson("expected.json");

  it("produces every value expected.json specifies", () => {
    // The point of the whole chain: workbook -> bindings -> definition -> data,
    // checked against the numbers the delivery plan fixed in advance.
    const result = fill();
    for (const want of expected.values) {
      const got = row(result, want.rowKey);
      expect({
        rowKey: got.rowKey,
        actual: got.cells["actual"]!.value,
        comparison: got.cells["comparison"]!.value,
        variance: got.variance.value,
      }).toEqual({
        rowKey: want.rowKey,
        actual: want.actual,
        comparison: want.comparison,
        variance: want.variance,
      });
    }
  });

  it("keeps the structure expected.json specifies", () => {
    const result = fill();
    expect(result.rows.map((r) => ({
      rowKey: r.rowKey,
      heading: r.heading,
      rowType: r.kind,
      indent: r.indent,
    }))).toEqual(expected.structure.rows);
  });

  it("totals 120 against 100 for a variance of +20", () => {
    const total = row(fill(), "total");
    expect(total.cells["actual"]!.value).toBe(120);
    expect(total.cells["comparison"]!.value).toBe(100);
    expect(total.variance.value).toBe(20);
  });

  it("splits that variance +10 and +10 across the queues", () => {
    const result = fill();
    expect(row(result, "queue_a").variance.value).toBe(expected.contributions.queue_a);
    expect(row(result, "queue_b").variance.value).toBe(expected.contributions.queue_b);
    // Non-overlapping queues, so the contributions add to the total exactly.
    const parts = ["queue_a", "queue_b"].map((k) => row(result, k).variance.value ?? 0);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(expected.contributions.total);
  });

  it("says nothing about whether +20 is good", () => {
    // Polarity belongs to an approved metric definition. The fixture records
    // the arithmetic and stops, and so does this.
    expect(definition().metric.polarity).toBe("unset");
  });
});

describe("the row the view returned nothing for", () => {
  it("is present, with its heading, and marked not available", () => {
    // R14, all the way through: Queue C survives the query returning no rows
    // for it. Never dropped, and never a zero.
    const c = row(fill(), "queue_c");
    expect(c.heading).toBe("Queue C");
    expect(c.cells["actual"]).toEqual({ value: null, availability: "not_available" });
    expect(c.cells["comparison"]).toEqual({ value: null, availability: "not_available" });
    expect(c.variance).toEqual({ value: null, availability: "not_available" });
  });

  it("contributes nothing to the total rather than contributing a zero", () => {
    // 70 + 50 = 120, not 70 + 50 + 0 dressed up as three measurements.
    const result = fill();
    expect(row(result, "total").cells["actual"]!.value).toBe(120);
    expect(row(result, "total").cells["actual"]!.availability).toBe("measured");

    // The sum alone cannot tell those apart — adding zero and adding nothing
    // both give 120. The case that can is a total whose contributors are *all*
    // absent: it must stay not available rather than becoming a measured zero,
    // which would be a number the source never reported.
    const onlyOther = fillReport(definition(), {
      rows: [{ queue_key: "queue_z", period: "actual", closed_cases: "999" }],
      keyColumn: "queue_key",
      periodColumn: "period",
    });
    expect(onlyOther.rows.find((r) => r.rowKey === "total")!.cells["actual"]).toEqual({
      value: null,
      availability: "not_available",
    });
  });

  it("keeps its own availability even when the policy supplies a number", () => {
    // Under blank_policy "zero" the value is 0, but the source still said
    // nothing — and a reader must be able to recover that.
    const def = definition();
    const zeroed: ReportDefinition = { ...def, blankPolicy: "zero" };
    const result = fillReport(zeroed, {
      rows: preparedView(),
      keyColumn: "queue_key",
      periodColumn: "period",
    });
    const c = result.rows.find((r) => r.rowKey === "queue_c")!;
    expect(c.cells["actual"]).toEqual({ value: 0, availability: "not_available" });
  });
});

describe("calculated rows are evaluated through the governed evaluator", () => {
  it("computes a configured total from the rows it names", () => {
    const result = fill([{ rowKey: "total", expr: "measure(queue_a) + measure(queue_b)" }]);
    const total = row(result, "total");
    expect(total.kind).toBe("calculated");
    expect(total.cells["actual"]!.value).toBe(120);
    expect(total.cells["comparison"]!.value).toBe(100);
    expect(total.variance.value).toBe(20);
  });

  it("computes across every period in one pass", () => {
    const result = fill([{ rowKey: "total", expr: "measure(queue_a) * 2" }]);
    expect(row(result, "total").cells["actual"]!.value).toBe(140);
    expect(row(result, "total").cells["comparison"]!.value).toBe(120);
  });

  it("yields not-available when it reads a row that has none", () => {
    // queue_c has no data, so anything derived from it is unknown rather than
    // zero — the evaluator's own null semantics, not a rule invented here.
    const result = fill([{ rowKey: "total", expr: "measure(queue_a) + measure(queue_c)" }]);
    expect(row(result, "total").cells["actual"]).toEqual({
      value: null,
      availability: "not_available",
    });
  });
});

describe("filling never changes the report's shape", () => {
  it("returns exactly the definition's rows, in its order", () => {
    const def = definition();
    const result = fillReport(def, {
      rows: preparedView(),
      keyColumn: "queue_key",
      periodColumn: "period",
    });
    expect(result.rows.map((r) => r.rowKey)).toEqual(def.rows.map((r) => r.rowKey));
  });

  it("returns the same rows when the view is empty", () => {
    const def = definition();
    const result = fillReport(def, { rows: [], keyColumn: "queue_key", periodColumn: "period" });
    expect(result.rows.map((r) => r.rowKey)).toEqual(["queue_a", "queue_b", "queue_c", "total"]);
    // Every cell not available, and the total too — it has nothing to total.
    expect(result.rows.every((r) => r.variance.availability === "not_available")).toBe(true);
    expect(result.rows.find((r) => r.rowKey === "total")!.cells["actual"]!.value).toBeNull();
  });

  it("ignores view rows for keys the report does not bind", () => {
    const def = definition();
    const result = fillReport(def, {
      rows: [...preparedView(), { queue_key: "queue_z", period: "actual", closed_cases: "999" }],
      keyColumn: "queue_key",
      periodColumn: "period",
    });
    expect(result.rows).toHaveLength(4);
    expect(row(result, "total").cells["actual"]!.value).toBe(120);
  });
});
