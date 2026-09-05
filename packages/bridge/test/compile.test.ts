import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readWorkbook, type WorkbookRead } from "../src/xlsx.js";
import { resolveBindings, type BindingSpec, type MetadataSnapshot } from "../src/bindings.js";
import { compileReport, type CalculatedRow } from "../src/compile.js";
import { writeWorkbook } from "./support/write-xlsx.js";

const fixturePath = (p: string) =>
  fileURLToPath(new URL(`../../../fixtures/support-ops/${p}`, import.meta.url));
const readJson = (p: string) => JSON.parse(readFileSync(fixturePath(p), "utf8"));

const workbook = () => readWorkbook("skeleton.xlsx", readFileSync(fixturePath("skeleton.xlsx")));
const metadata = (): MetadataSnapshot => {
  const raw = readJson("sql-metadata.json");
  return { ...raw.snapshot, metrics: raw.metrics, views: raw.views };
};
const bindings = (): BindingSpec => readJson("bindings.json");

/** Resolve the fixture, then compile it. Throws if the binding stage fails. */
function compile(o: { calculated?: CalculatedRow[]; workbook?: WorkbookRead } = {}) {
  const wb = o.workbook ?? workbook();
  const resolved = resolveBindings(wb, metadata(), bindings());
  if (!resolved.ok) throw new Error(`binding failed: ${JSON.stringify(resolved.problems)}`);
  return compileReport(wb, resolved.resolution, { calculated: o.calculated });
}

const codes = (problems: { code: string }[]) => problems.map((p) => p.code);

describe("the compiled definition", () => {
  it("carries every configured row, in the skeleton's order", () => {
    const out = compile();
    if (!out.ok) throw new Error(JSON.stringify(out.problems));
    expect(out.definition.rows.map((r) => r.rowKey)).toEqual([
      "queue_a",
      "queue_b",
      "queue_c",
      "total",
    ]);
    expect(out.definition.rows.map((r) => r.heading)).toEqual([
      "Queue A",
      "Queue B",
      "Queue C",
      "Total",
    ]);
  });

  it("keeps the row the view will return nothing for", () => {
    // R14 in the definition rather than the render: Queue C is compiled in
    // before any query has run, so nothing downstream can drop it for being
    // empty.
    const out = compile();
    if (!out.ok) throw new Error("expected a definition");
    const queueC = out.definition.rows.find((r) => r.rowKey === "queue_c");
    expect(queueC).toMatchObject({ kind: "data", viewKey: "queue_c", heading: "Queue C" });
  });

  it("separates what is read from what is derived", () => {
    const out = compile();
    if (!out.ok) throw new Error("expected a definition");
    expect(out.definition.rows.map((r) => r.kind)).toEqual(["data", "data", "data", "total"]);
    expect(out.definition.rows[3]).toMatchObject({
      kind: "total",
      over: ["queue_a", "queue_b", "queue_c"],
    });
  });

  it("asks the source only for the rows that read it", () => {
    // A total is derived from rows already being fetched. Querying it as well
    // would be a second, unreconciled answer to the same question.
    const out = compile();
    if (!out.ok) throw new Error("expected a definition");
    expect(out.definition.execution).toMatchObject({
      view: "vw_closed_cases_by_queue",
      metric: "closed_cases",
      grain: "queue",
      keys: ["queue_a", "queue_b", "queue_c"],
      periods: { actual: "actual", comparison: "comparison" },
    });
  });

  it("traces every row back to the cell that configured it", () => {
    const out = compile();
    if (!out.ok) throw new Error("expected a definition");
    expect(out.definition.provenance["queue_c"]).toMatchObject({
      skeleton: { workbook: "skeleton.xlsx", sheet: "Skeleton", address: "A7" },
      boundBy: "vw_closed_cases_by_queue.queue_key=queue_c",
    });
    expect(out.definition.provenance["total"]!.boundBy).toBe("configured total");
    // Every row, not just the interesting ones.
    expect(Object.keys(out.definition.provenance).sort()).toEqual([
      "queue_a",
      "queue_b",
      "queue_c",
      "total",
    ]);
  });

  it("records the metadata snapshot the definition was compiled against", () => {
    const out = compile();
    if (!out.ok) throw new Error("expected a definition");
    expect(out.definition.snapshot.version).toBe("0.1");
    expect(out.definition.snapshot.source).toBe("synthetic://support-ops");
  });

  it("is deterministic — the same configuration compiles to the same definition", () => {
    // R13 says deterministically, so this is the requirement, not a nicety.
    const a = compile();
    const b = compile();
    if (!a.ok || !b.ok) throw new Error("expected definitions");
    expect(JSON.stringify(a.definition)).toBe(JSON.stringify(b.definition));
  });
});

describe("the blank policy", () => {
  it("is taken from configuration", () => {
    const out = compile();
    if (!out.ok) throw new Error("expected a definition");
    expect(out.definition.blankPolicy).toBe("not_available");
  });

  /** The fixture's Config sheet, with blank_policy replaced or removed. */
  function withPolicy(value: string | null): WorkbookRead {
    const skeleton = workbook().sheets[0]!;
    const rows = skeleton.rows.map((r) => r.map((c) => (c.value === null ? null : c.value)));
    const config: (string | number | boolean | null)[][] = [
      ["Key", "Value"],
      ["grain", "queue"],
      ["unit", "cases"],
      ["additive", true],
      ...(value === null ? [] : [["blank_policy", value] as (string | null)[]]),
    ];
    return readWorkbook(
      "skeleton.xlsx",
      writeWorkbook([
        { name: "Skeleton", rows: rows as (string | number | boolean | null)[][] },
        { name: "Config", rows: config },
      ]),
    );
  }

  it("refuses an undeclared policy rather than guessing", () => {
    // A row with no data and a row measuring zero are different claims about
    // the business. R14 wants the choice declared.
    const out = compile({ workbook: withPolicy(null) });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("blank-policy-missing");
  });

  it("refuses a policy it does not recognise, naming the cell", () => {
    const out = compile({ workbook: withPolicy("whatever_looks_right") });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    const p = out.problems.find((x) => x.code === "blank-policy-unknown")!;
    expect(p.message).toMatch(/not one of not_available, zero, blank/);
    expect(p.at?.sheet).toBe("Config");
  });

  it("accepts zero, and says out loud what it costs", () => {
    const out = compile({ workbook: withPolicy("zero") });
    if (!out.ok) throw new Error(JSON.stringify(out.problems));
    expect(out.definition.blankPolicy).toBe("zero");
    expect(out.definition.diagnostics.join(" ")).toMatch(/read as measured zeros/);
  });
});

describe("calculated rows", () => {
  it("resolves what a calculation reads, and when it can be evaluated", () => {
    const out = compile({
      calculated: [{ rowKey: "total", expr: "measure(queue_a) + measure(queue_b)" }],
    });
    if (!out.ok) throw new Error(JSON.stringify(out.problems));
    const total = out.definition.rows.find((r) => r.rowKey === "total")!;
    expect(total.kind).toBe("calculated");
    expect(total.expr).toBe("measure(queue_a) + measure(queue_b)");
    expect(total.dependsOn!.sort()).toEqual(["queue_a", "queue_b"]);
    // Dependencies come first in the evaluation order.
    const order = out.definition.evaluationOrder;
    expect(order.indexOf("queue_a")).toBeLessThan(order.indexOf("total"));
    expect(order.indexOf("queue_b")).toBeLessThan(order.indexOf("total"));
  });

  it("records a calculated row's provenance as its formula", () => {
    const out = compile({
      calculated: [{ rowKey: "total", expr: "measure(queue_a) + measure(queue_b)" }],
    });
    if (!out.ok) throw new Error("expected a definition");
    expect(out.definition.provenance["total"]!.boundBy).toBe(
      "calculated: measure(queue_a) + measure(queue_b)",
    );
  });

  it("refuses a calculation for a row the skeleton does not have", () => {
    const out = compile({ calculated: [{ rowKey: "queue_z", expr: "measure(queue_a)" }] });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("unknown-row");
  });
});

describe("diagnostics T08 requires", () => {
  it("reports a dependency cycle instead of looping", () => {
    const out = compile({
      calculated: [
        { rowKey: "queue_a", expr: "measure(queue_b)" },
        { rowKey: "queue_b", expr: "measure(queue_a)" },
      ],
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("dependency-cycle");
    expect(out.problems.find((p) => p.code === "dependency-cycle")!.message).toMatch(
      /queue_a -> queue_b -> queue_a|queue_b -> queue_a -> queue_b/,
    );
  });

  it("reports a row referencing itself", () => {
    const out = compile({ calculated: [{ rowKey: "total", expr: "measure(total)" }] });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("dependency-cycle");
  });

  it("reports a reference to a row that does not exist", () => {
    const out = compile({ calculated: [{ rowKey: "total", expr: "measure(queue_zzz)" }] });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("reference-unknown");
  });

  it("fails an unsupported rule explicitly rather than skipping the row", () => {
    // R13. Skipping it with a warning would produce a report quietly missing a
    // line somebody configured — the failure hardest to notice downstream.
    const out = compile({ calculated: [{ rowKey: "total", expr: "queue_a ?? fallback(" }] });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("rule-unsupported");
  });

  it("refuses a literal division by zero", () => {
    const out = compile({
      calculated: [{ rowKey: "total", expr: "measure(queue_a) / 0" }],
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(codes(out.problems)).toContain("division-by-zero");
  });
});

describe("no raw code from metadata", () => {
  /**
   * R15: no raw JavaScript or unrestricted SQL from metadata. The expression
   * system is a parser over a fixed grammar and never an evaluator, so these
   * are syntax errors rather than payloads — but the guarantee is worth a test,
   * because it is the kind that quietly stops holding.
   */
  const attempts = [
    "process.exit(1)",
    "require('fs').readFileSync('/etc/passwd')",
    "globalThis.fetch('http://example.com')",
    "(() => 1)()",
    "1; DROP TABLE cases; --",
    "SELECT * FROM users",
    "measure(queue_a); process.env.TOKEN",
  ];

  for (const expr of attempts) {
    it(`refuses ${JSON.stringify(expr.slice(0, 34))}`, () => {
      const out = compile({ calculated: [{ rowKey: "total", expr }] });
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.problems.length).toBeGreaterThan(0);
    });
  }
});
