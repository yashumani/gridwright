import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx.js";
import { resolveBindings, type BindingSpec, type MetadataSnapshot } from "../src/bindings.js";
import { compileReport, type CalculatedRow, type ReportDefinition } from "../src/compile.js";
import { fillReport, type ViewRow } from "../src/fill.js";
import { writeWorkbook } from "./support/write-xlsx.js";
import { CONFIG_ROWS, SKELETON_ROWS } from "../../../fixtures/support-ops/skeleton.js";

/**
 * A03, calculation correctness, as one suite.
 *
 * The delivery plan lists what this scenario has to cover: missing values, zero
 * denominators, negative adjustments, period boundaries, additive/weighted/
 * period-end rules and invalid formulas — with two outcomes that matter more
 * than the list. **Undefined is never silently zero**, and **a total is
 * computed at the right grain**.
 *
 * Kept together rather than scattered through the unit tests, because an
 * acceptance scenario is a claim about the whole chain and someone should be
 * able to read the claim in one place.
 */

const fixturePath = (p: string) =>
  fileURLToPath(new URL(`../../../fixtures/support-ops/${p}`, import.meta.url));
const readJson = (p: string) => JSON.parse(readFileSync(fixturePath(p), "utf8"));

function snapshot(): MetadataSnapshot {
  const raw = readJson("sql-metadata.json");
  return { ...raw.snapshot, metrics: raw.metrics, views: raw.views };
}

/**
 * Compiles the fixture, optionally with the metric changed.
 *
 * Additivity is declared in the workbook *and* in the metadata snapshot, and
 * the bridge refuses a disagreement between them (D01 is still open, so there
 * is no authoritative side to pick). So a test that makes the metric
 * non-additive has to say so on both sides, which is what `additive` here
 * does: it rebuilds the workbook from the same source the committed fixture is
 * generated from, with that one cell changed — and drops the Total row, since
 * a total over a non-additive metric is separately and correctly refused.
 */
function build(
  options: {
    metric?: Partial<MetadataSnapshot["metrics"][number]>;
    calculated?: CalculatedRow[];
  } = {},
) {
  const nonAdditive = options.metric?.additive === false;
  const wb = nonAdditive
    ? readWorkbook("skeleton.xlsx", variantWorkbook())
    : readWorkbook("skeleton.xlsx", readFileSync(fixturePath("skeleton.xlsx")));

  const meta = snapshot();
  const metadata: MetadataSnapshot = options.metric
    ? { ...meta, metrics: meta.metrics.map((m) => ({ ...m, ...options.metric })) }
    : meta;
  const raw: BindingSpec = readJson("bindings.json");
  const bindings: BindingSpec = nonAdditive
    ? { ...raw, rows: raw.rows.filter((r) => r.kind !== "total") }
    : raw;

  const resolved = resolveBindings(wb, metadata, bindings);
  if (!resolved.ok) return { ok: false as const, problems: resolved.problems };
  return compileReport(wb, resolved.resolution, { calculated: options.calculated });
}

/** The fixture workbook with `additive` false and no Total row. */
function variantWorkbook(): Buffer {
  return writeWorkbook([
    { name: "Skeleton", rows: SKELETON_ROWS.filter((r) => r[0] !== "total") },
    { name: "Config", rows: nonAdditiveConfig() },
  ]);
}

/** The same, keeping the Total row, so the total rule can be tested on its own. */
function variantWorkbookWithTotal(): Buffer {
  return writeWorkbook([
    { name: "Skeleton", rows: SKELETON_ROWS },
    { name: "Config", rows: nonAdditiveConfig() },
  ]);
}

const nonAdditiveConfig = () =>
  CONFIG_ROWS.map((r) => (r[0] === "additive" ? [r[0]!, false, r[2]!] : r));

function definition(options: Parameters<typeof build>[0] = {}): ReportDefinition {
  const out = build(options);
  if (!out.ok) throw new Error(`compile failed: ${JSON.stringify(out.problems)}`);
  return out.definition;
}

const fill = (def: ReportDefinition, rows: ViewRow[]) =>
  fillReport(def, { rows, keyColumn: "queue_key", periodColumn: "period" });

const cell = (r: ReturnType<typeof fill>, key: string, period: string) =>
  r.rows.find((x) => x.rowKey === key)!.cells[period]!;

const view = (rows: [string, string, number | string | null][]): ViewRow[] =>
  rows.map(([queue_key, period, closed_cases]) => ({ queue_key, period, closed_cases }));

describe("A03 · missing values are never silently zero", () => {
  it("leaves a queue the view said nothing about not available", () => {
    const r = fill(definition(), view([["queue_a", "actual", 70]]));
    expect(cell(r, "queue_b", "actual")).toEqual({ value: null, availability: "not_available" });
  });

  it("distinguishes a measured zero from no measurement", () => {
    // The distinction the whole availability model exists for: a queue that
    // closed nothing is not a queue nobody asked about.
    const r = fill(definition(), view([["queue_a", "actual", 0]]));
    expect(cell(r, "queue_a", "actual")).toEqual({ value: 0, availability: "measured" });
    expect(cell(r, "queue_b", "actual").availability).toBe("not_available");
  });

  it("keeps a total not available when nothing under it was measured", () => {
    const r = fill(definition(), view([]));
    expect(cell(r, "total", "actual")).toEqual({ value: null, availability: "not_available" });
  });

  it("treats a blank cell in the view as no measurement, not as zero", () => {
    const r = fill(definition(), view([["queue_a", "actual", null], ["queue_a", "comparison", 60]]));
    expect(cell(r, "queue_a", "actual").availability).toBe("not_available");
    expect(cell(r, "queue_a", "comparison").value).toBe(60);
  });
});

describe("A03 · zero denominators", () => {
  it("refuses a rule that divides by a literal zero, before any data", () => {
    const out = build({ calculated: [{ rowKey: "total", expr: "measure(queue_a) / 0" }] });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems.map((p) => p.code)).toContain("division-by-zero");
  });

  it("yields not available when a denominator turns out to be zero in the data", () => {
    // Not Infinity, and not zero. A ratio over nothing is a number nobody has.
    const def = definition({
      calculated: [{ rowKey: "total", expr: "measure(queue_a) / measure(queue_b)" }],
    });
    const r = fill(def, view([["queue_a", "actual", 70], ["queue_b", "actual", 0]]));
    expect(cell(r, "total", "actual")).toEqual({ value: null, availability: "not_available" });
  });

  it("yields not available when the denominator was never measured", () => {
    const def = definition({
      calculated: [{ rowKey: "total", expr: "measure(queue_a) / measure(queue_c)" }],
    });
    const r = fill(def, view([["queue_a", "actual", 70]]));
    expect(cell(r, "total", "actual").availability).toBe("not_available");
  });

  it("still divides when the denominator is real", () => {
    const def = definition({
      calculated: [{ rowKey: "total", expr: "measure(queue_a) / measure(queue_b)" }],
    });
    const r = fill(def, view([["queue_a", "actual", 70], ["queue_b", "actual", 35]]));
    expect(cell(r, "total", "actual")).toEqual({ value: 2, availability: "measured" });
  });
});

describe("A03 · negative adjustments", () => {
  it("carries a negative measurement through a total", () => {
    // A reversal is a real number, not a data error to be clipped at zero.
    const r = fill(
      definition(),
      view([["queue_a", "actual", 70], ["queue_b", "actual", -20]]),
    );
    expect(cell(r, "total", "actual").value).toBe(50);
  });

  it("produces a negative variance without editorialising it", () => {
    const r = fill(
      definition(),
      view([["queue_a", "actual", 40], ["queue_a", "comparison", 60]]),
    );
    const row = r.rows.find((x) => x.rowKey === "queue_a")!;
    expect(row.variance).toEqual({ value: -20, availability: "measured" });
    // Polarity belongs to approved knowledge; the fixture's is unset, so
    // nothing here decides whether -20 is bad.
    expect(definition().metric.polarity).toBe("unset");
  });

  it("lets contributions of opposite sign cancel exactly", () => {
    const r = fill(
      definition(),
      view([["queue_a", "actual", 25], ["queue_b", "actual", -25]]),
    );
    expect(cell(r, "total", "actual")).toEqual({ value: 0, availability: "measured" });
  });
});

describe("A03 · period boundaries", () => {
  it("ignores a view row for a period the report does not ask for", () => {
    // A view that happens to return last year's rows must not fold them into
    // this year's column.
    const r = fill(
      definition(),
      view([["queue_a", "actual", 70], ["queue_a", "prior_year", 999]]),
    );
    expect(cell(r, "queue_a", "actual").value).toBe(70);
    expect(cell(r, "total", "actual").value).toBe(70);
  });

  it("keeps each period's arithmetic separate", () => {
    const r = fill(
      definition(),
      view([
        ["queue_a", "actual", 70],
        ["queue_a", "comparison", 60],
        ["queue_b", "actual", 50],
        ["queue_b", "comparison", 40],
      ]),
    );
    expect(cell(r, "total", "actual").value).toBe(120);
    expect(cell(r, "total", "comparison").value).toBe(100);
    expect(r.rows.find((x) => x.rowKey === "total")!.variance.value).toBe(20);
  });

  it("computes a variance only where both periods were measured", () => {
    const r = fill(definition(), view([["queue_a", "actual", 70]]));
    expect(r.rows.find((x) => x.rowKey === "queue_a")!.variance).toEqual({
      value: null,
      availability: "not_available",
    });
  });
});

describe("A03 · a metric is combined by its own rule, never by habit", () => {
  it("adds duplicate view rows for an additive metric", () => {
    const r = fill(
      definition(),
      view([["queue_a", "actual", 40], ["queue_a", "actual", 30]]),
    );
    expect(cell(r, "queue_a", "actual").value).toBe(70);
  });

  it("takes the maximum for a metric declared max, rather than summing", () => {
    // The defect this closes: the bridge folded every duplicate row by adding,
    // whatever the metric said. A peak backlog of 70 and 50 is 70, not 120 —
    // and 120 is the kind of wrong number that looks perfectly reasonable.
    const def = definition({ metric: { aggregation: "max", additive: false } });
    const r = fill(def, view([["queue_a", "actual", 70], ["queue_a", "actual", 50]]));
    expect(cell(r, "queue_a", "actual").value).toBe(70);
  });

  it("takes the minimum for a metric declared min", () => {
    const def = definition({ metric: { aggregation: "min", additive: false } });
    const r = fill(def, view([["queue_a", "actual", 70], ["queue_a", "actual", 50]]));
    expect(cell(r, "queue_a", "actual").value).toBe(50);
  });

  it("refuses a rule this bridge does not implement rather than summing it", () => {
    // A03: a non-additive metric must not inherit sum behaviour. An average
    // needs the weights it was taken over and a period-end reading needs to
    // know which row is last; neither survives a prepared view, so neither is
    // guessed at.
    for (const aggregation of ["average", "period_end", "median", "distinct_count"]) {
      const out = build({ metric: { aggregation, additive: false } });
      expect(out.ok, `${aggregation} should be refused`).toBe(false);
      if (out.ok) continue;
      expect(out.problems.map((p) => p.code)).toContain("aggregation-unsupported");
      expect(out.problems.map((p) => p.message).join(" ")).toContain(aggregation);
    }
  });

  it("refuses a metric that is non-additive and summed at the same time", () => {
    // The configuration contradicts itself: summing is additive. Refusing is
    // the only answer that does not pick a winner silently.
    const out = build({ metric: { aggregation: "sum", additive: false } });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems.map((p) => p.code)).toContain("aggregation-unsupported");
  });

  it("refuses to total a non-additive metric across rows", () => {
    // The other half of the same rule, enforced a stage earlier: a Total row
    // over a metric that does not add is refused at binding time. Both sources
    // say non-additive here, so the refusal is about the total and not about
    // the two of them disagreeing.
    const wb = readWorkbook("skeleton.xlsx", variantWorkbookWithTotal());
    const meta = snapshot();
    const metadata: MetadataSnapshot = {
      ...meta,
      metrics: meta.metrics.map((m) => ({ ...m, additive: false, aggregation: "max" })),
    };
    const resolved = resolveBindings(wb, metadata, readJson("bindings.json") as BindingSpec);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.problems.map((p) => p.code)).toContain("total-not-additive");
  });
});

describe("A03 · invalid formulas are refused, not approximated", () => {
  it("refuses an expression that does not parse", () => {
    const out = build({ calculated: [{ rowKey: "total", expr: "1 +" }] });
    expect(out.ok).toBe(false);
  });

  it("refuses a reference to a row that does not exist", () => {
    const out = build({ calculated: [{ rowKey: "total", expr: "measure(queue_z)" }] });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems.map((p) => p.code)).toContain("reference-unknown");
  });

  it("refuses a calculation configured for a row the skeleton does not have", () => {
    const out = build({ calculated: [{ rowKey: "not_a_row", expr: "measure(queue_a)" }] });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems.map((p) => p.code)).toContain("unknown-row");
  });

  it("refuses a rule that depends on itself", () => {
    const out = build({ calculated: [{ rowKey: "total", expr: "measure(total) + 1" }] });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems.map((p) => p.code)).toContain("dependency-cycle");
  });
});

describe("A03 · a total is computed at the right grain", () => {
  it("totals the rows configured under it and no others", () => {
    const r = fill(
      definition(),
      view([
        ["queue_a", "actual", 70],
        ["queue_b", "actual", 50],
        ["queue_z", "actual", 999],
      ]),
    );
    expect(cell(r, "total", "actual").value).toBe(120);
  });

  it("does not double-count a queue that appears twice in the view", () => {
    // Folded once at the source, then totalled once. 40 + 30 + 50 = 120, and
    // the total must not see 40, 30 and 50 as three contributors twice over.
    const r = fill(
      definition(),
      view([
        ["queue_a", "actual", 40],
        ["queue_a", "actual", 30],
        ["queue_b", "actual", 50],
      ]),
    );
    expect(cell(r, "queue_a", "actual").value).toBe(70);
    expect(cell(r, "total", "actual").value).toBe(120);
  });

  it("refuses a binding whose grain disagrees with the metric's", () => {
    const wb = readWorkbook("skeleton.xlsx", readFileSync(fixturePath("skeleton.xlsx")));
    const meta = snapshot();
    const metadata: MetadataSnapshot = {
      ...meta,
      metrics: meta.metrics.map((m) => ({ ...m, grain: "agent" })),
    };
    const resolved = resolveBindings(wb, metadata, readJson("bindings.json") as BindingSpec);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.problems.map((p) => p.code)).toContain("grain-conflict");
  });
});
