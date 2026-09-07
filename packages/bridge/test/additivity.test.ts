import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeWorkbook } from "./support/write-xlsx.js";
import { CONFIG_ROWS, SKELETON_ROWS } from "../../../fixtures/support-ops/skeleton.js";
import { readWorkbook } from "../src/xlsx.js";
import {
  ADDITIVITY,
  normaliseMetric,
  readAdditivity,
  resolveBindings,
  type BindingSpec,
  type MetadataSnapshot,
} from "../src/bindings.js";
import { SUPPORTED_AGGREGATIONS, compileReport } from "../src/compile.js";
import { fillReport, type ViewRow } from "../src/fill.js";

/**
 * Three-valued additivity, and the `period_end` rule it unblocked.
 *
 * Reconciling with Talk2Data's registry found that a boolean cannot say what is
 * true of a backlog: it adds across queues and does not add across time. These
 * tests hold both halves of the fix — the vocabulary, and the aggregation that
 * only became answerable once the bindings could declare an ordering.
 */

const fx = (p: string) => resolve(process.cwd(), "fixtures/support-ops", p);
const readJson = (p: string) => JSON.parse(readFileSync(fx(p), "utf8"));

const snapshot = (over: Record<string, unknown> = {}): MetadataSnapshot => {
  const raw = readJson("sql-metadata.json");
  return {
    ...raw.snapshot,
    metrics: raw.metrics.map((m: Record<string, unknown>) => ({ ...m, ...over })),
    views: raw.views,
  };
};

/** The fixture workbook with the Config sheet's additive cell replaced. */
const workbookSaying = (additive: unknown, keepTotal = true) =>
  writeWorkbook([
    { name: "Skeleton", rows: keepTotal ? SKELETON_ROWS : SKELETON_ROWS.filter((r) => r[0] !== "total") },
    { name: "Config", rows: CONFIG_ROWS.map((r) => (r[0] === "additive" ? [r[0], additive, r[2]] : r)) },
  ]);

const bindings = (over: Partial<BindingSpec> = {}): BindingSpec => ({
  ...(readJson("bindings.json") as BindingSpec),
  ...over,
});

const resolveWith = (additive: unknown, meta: Record<string, unknown>, spec: Partial<BindingSpec> = {}, keepTotal = true) =>
  resolveBindings(
    readWorkbook("skeleton.xlsx", workbookSaying(additive, keepTotal)),
    snapshot(meta),
    keepTotal
      ? bindings(spec)
      : bindings({ ...spec, rows: bindings().rows.filter((r) => r.kind !== "total") }),
  );

describe("the vocabulary", () => {
  it("has three values, because a backlog needs the third", () => {
    expect([...ADDITIVITY]).toEqual(["additive", "semi_additive", "non_additive"]);
  });

  it.each([
    [true, "additive"],
    [false, "non_additive"],
    ["TRUE", "additive"],
    ["additive", "additive"],
    ["semi_additive", "semi_additive"],
    ["semi-additive", "semi_additive"],
    ["Semi Additive", "semi_additive"],
    ["NON_ADDITIVE", "non_additive"],
  ])("reads %j as %s", (input, expected) => {
    expect(readAdditivity(input)).toBe(expected);
  });

  it("returns nothing for a value it does not know", () => {
    // Not a default. Defaulting an unknown additivity to additive is exactly
    // the failure the third value exists to prevent.
    expect(readAdditivity("mostly")).toBeUndefined();
    expect(readAdditivity(3)).toBeUndefined();
    expect(readAdditivity(undefined)).toBeUndefined();
  });

  it("refuses a metric whose additivity it cannot read", () => {
    const out = normaliseMetric({ id: "m", additivity: "mostly" } as never);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problem.code).toBe("additive-conflict");
  });
});

describe("a snapshot written the old way still works", () => {
  it("reads additive: true as additive", () => {
    const out = resolveWith(true, { additive: true, additivity: undefined });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.resolution.metric.additivity).toBe("additive");
  });

  it("does not call TRUE and \"additive\" a disagreement", () => {
    // Two spellings of one fact. Reporting that as a D01 conflict would be
    // this bridge inventing a disagreement.
    const out = resolveWith(true, { additive: undefined, additivity: "additive" });
    expect(out.ok).toBe(true);
  });

  it("still refuses a real disagreement", () => {
    const out = resolveWith(true, { additive: undefined, additivity: "non_additive" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems.map((p) => p.code)).toContain("additive-conflict");
  });

  it("refuses a workbook value that is not in the vocabulary", () => {
    const out = resolveWith("mostly", { additivity: "additive" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems[0]!.message).toContain("mostly");
  });
});

describe("semi-additive is not non-additive", () => {
  it("may be totalled across rows, which is what semi-additive means", () => {
    // A backlog totals correctly across queues within a period. Refusing that
    // was the boolean's fault, not the metric's.
    const out = resolveWith("semi_additive", { additive: undefined, additivity: "semi_additive" });
    expect(out.ok, JSON.stringify(!out.ok && out.problems)).toBe(true);
  });

  it("is still refused a Total when the metric is non-additive", () => {
    const out = resolveWith("non_additive", { additive: undefined, additivity: "non_additive" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems.map((p) => p.code)).toContain("total-not-additive");
  });

  it("cannot be aggregated by sum, which would add it across time", () => {
    const out = resolveWith("non_additive", { additive: undefined, additivity: "non_additive", aggregation: "sum" }, {}, false);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const compiled = compileReport(
      readWorkbook("skeleton.xlsx", workbookSaying("non_additive", false)),
      out.resolution,
      {},
    );
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.problems.map((p) => p.code)).toContain("aggregation-unsupported");
  });
});

describe("period_end, once the bindings can say which row is last", () => {
  it("is now one of the rules this bridge implements", () => {
    expect([...SUPPORTED_AGGREGATIONS]).toContain("period_end");
  });

  it("is refused without an ordering column", () => {
    // A prepared view arrives in whatever order the query returned, and "the
    // last one" from an unordered set is an arbitrary one.
    const out = resolveWith("semi_additive", { additive: undefined, additivity: "semi_additive", aggregation: "period_end" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const compiled = compileReport(
      readWorkbook("skeleton.xlsx", workbookSaying("semi_additive")),
      out.resolution,
      {},
    );
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.problems.map((p) => p.message).join(" ")).toContain("orderColumn");
  });

  it("takes the last reading when the bindings declare one", () => {
    const out = resolveWith(
      "semi_additive",
      { additive: undefined, additivity: "semi_additive", aggregation: "period_end" },
      { orderColumn: "as_of" },
    );
    expect(out.ok, JSON.stringify(!out.ok && out.problems)).toBe(true);
    if (!out.ok) return;

    const compiled = compileReport(
      readWorkbook("skeleton.xlsx", workbookSaying("semi_additive")),
      out.resolution,
      {},
    );
    expect(compiled.ok, JSON.stringify(!compiled.ok && compiled.problems)).toBe(true);
    if (!compiled.ok) return;

    // Three readings of one backlog. A sum would say 180; the answer is 40.
    const rows: ViewRow[] = [
      { queue_key: "queue_a", period: "actual", closed_cases: "70", as_of: "2026-08-10" },
      { queue_key: "queue_a", period: "actual", closed_cases: "70", as_of: "2026-08-20" },
      { queue_key: "queue_a", period: "actual", closed_cases: "40", as_of: "2026-08-31" },
    ];
    const filled = fillReport(compiled.definition, {
      rows,
      keyColumn: "queue_key",
      periodColumn: "period",
    });
    const a = filled.rows.find((r) => r.rowKey === "queue_a")!;
    expect(a.cells["actual"]!.value).toBe(40);
  });

  it("does not depend on the order the rows arrived in", () => {
    const out = resolveWith(
      "semi_additive",
      { additive: undefined, additivity: "semi_additive", aggregation: "period_end" },
      { orderColumn: "as_of" },
    );
    if (!out.ok) throw new Error("resolve failed");
    const compiled = compileReport(readWorkbook("skeleton.xlsx", workbookSaying("semi_additive")), out.resolution, {});
    if (!compiled.ok) throw new Error("compile failed");

    const rows: ViewRow[] = [
      { queue_key: "queue_a", period: "actual", closed_cases: "40", as_of: "2026-08-31" },
      { queue_key: "queue_a", period: "actual", closed_cases: "70", as_of: "2026-08-10" },
    ];
    const filled = fillReport(compiled.definition, { rows, keyColumn: "queue_key", periodColumn: "period" });
    expect(filled.rows.find((r) => r.rowKey === "queue_a")!.cells["actual"]!.value).toBe(40);
  });

  it("keeps each period's last reading separate", () => {
    const out = resolveWith(
      "semi_additive",
      { additive: undefined, additivity: "semi_additive", aggregation: "period_end" },
      { orderColumn: "as_of" },
    );
    if (!out.ok) throw new Error("resolve failed");
    const compiled = compileReport(readWorkbook("skeleton.xlsx", workbookSaying("semi_additive")), out.resolution, {});
    if (!compiled.ok) throw new Error("compile failed");

    const rows: ViewRow[] = [
      { queue_key: "queue_a", period: "actual", closed_cases: "40", as_of: "2026-08-31" },
      { queue_key: "queue_a", period: "actual", closed_cases: "70", as_of: "2026-08-01" },
      { queue_key: "queue_a", period: "comparison", closed_cases: "55", as_of: "2026-07-31" },
      { queue_key: "queue_a", period: "comparison", closed_cases: "90", as_of: "2026-07-01" },
    ];
    const filled = fillReport(compiled.definition, { rows, keyColumn: "queue_key", periodColumn: "period" });
    const a = filled.rows.find((r) => r.rowKey === "queue_a")!;
    expect(a.cells["actual"]!.value).toBe(40);
    expect(a.cells["comparison"]!.value).toBe(55);
  });
});
