import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  LATEST_VERSION, formatIssues, manifestJsonSchema, migrate, parseManifest, validateManifest,
} from "@gridwright/schema";

const REF = fileURLToPath(new URL("../../../examples/sales-overview.gw.yaml", import.meta.url));
const refText = readFileSync(REF, "utf8");

/** Deep clone of the reference manifest, for mutation in the rejection corpus. */
function good(): any {
  const r = parseManifest(refText);
  if (!r.ok) throw new Error("reference manifest is invalid:\n" + formatIssues(r.issues));
  return structuredClone(r.manifest);
}

describe("reference manifest", () => {
  it("parses and validates", () => {
    const r = parseManifest(refText);
    expect(r.ok, r.ok ? "" : formatIssues(r.issues)).toBe(true);
  });

  it("round-trips through JSON without loss", () => {
    const m = good();
    const r = validateManifest(JSON.parse(JSON.stringify(m)));
    expect(r.ok).toBe(true);
    expect(r.ok && r.manifest).toEqual(m);
  });

  it("exposes every declared panel type and dataset", () => {
    const m = good();
    expect(Object.keys(m.datasets))
      .toEqual(["totals", "by_region", "by_month", "by_channel", "region_channel"]);
    expect(m.panels.map((p: any) => p.type).sort()).toEqual(
      ["bar", "kpi", "kpi", "kpi", "kpi", "line", "table"].sort(),
    );
  });
});

/**
 * The rejection corpus. Each case names the path the error must point at —
 * a validator that rejects for the wrong reason is not much better than one
 * that accepts.
 */
const REJECTIONS: Array<[name: string, mutate: (m: any) => void, path: string]> = [
  ["unknown top-level key", (m) => { m.nope = 1; }, "nope"],
  ["missing version", (m) => { delete m.gridwright; }, "gridwright"],
  ["future version", (m) => { m.gridwright = 99; }, "gridwright"],
  ["non-integer version", (m) => { m.gridwright = 1.5; }, "gridwright"],
  ["missing source", (m) => { delete m.source; }, "source"],
  ["empty file list", (m) => { m.source.files = []; }, "source.files"],
  ["duplicate file id", (m) => { m.source.files.push({ ...m.source.files[0] }); }, "source.files"],
  ["field references unknown table", (m) => { m.model.fields[0].from = "ghost.col"; }, "model.fields[0].from"],
  ["malformed field.from", (m) => { m.model.fields[0].from = "no-dot"; }, "model.fields[0].from"],
  ["duplicate field name", (m) => { m.model.fields.push({ ...m.model.fields[0] }); }, "model.fields"],
  ["bad identifier", (m) => { m.model.fields[0].name = "9lives"; }, "model.fields[0].name"],
  ["unknown field type", (m) => { m.model.fields[0].type = "money"; }, "model.fields[0].type"],
  ["dimension on unknown field", (m) => { m.model.dimensions[0].field = "ghost"; }, "model.dimensions[0].field"],
  ["grain on non-date field", (m) => { m.model.dimensions[0].grain = "month"; }, "model.dimensions[0].grain"],
  ["duplicate dimension id", (m) => { m.model.dimensions.push({ ...m.model.dimensions[0] }); }, "model.dimensions"],
  ["dimension/measure id clash", (m) => { m.model.measures[0].id = "region"; }, "model.measures"],
  ["empty measure expression", (m) => { m.model.measures[0].expr = ""; }, "model.measures[0].expr"],
  ["dataset selects unknown measure", (m) => { m.datasets.by_region.measures = ["ghost"]; }, "datasets.by_region.measures[0]"],
  ["dataset selects unknown dimension", (m) => { m.datasets.by_region.dimensions = ["ghost"]; }, "datasets.by_region.dimensions[0]"],
  ["sort on unselected measure", (m) => { m.datasets.by_region.sort = [{ measure: "returns" }]; }, "datasets.by_region.sort[0].measure"],
  ["sort with neither key", (m) => { m.datasets.by_region.sort = [{ dir: "asc" }]; }, "datasets.by_region.sort[0]"],
  ["negative limit", (m) => { m.datasets.by_region.limit = -5; }, "datasets.by_region.limit"],
  ["panel on unknown dataset", (m) => { m.panels[0].dataset = "ghost"; }, "panels[0].dataset"],
  ["panel overflows the grid", (m) => { m.panels[0].layout.w = 20; }, "panels[0].layout"],
  ["duplicate panel id", (m) => { m.panels.push({ ...m.panels[0] }); }, "panels"],
  ["panel type not kebab-case", (m) => { m.panels[0].type = "KPI"; }, "panels[0].type"],
  ["missing panel layout", (m) => { delete m.panels[0].layout; }, "panels[0].layout"],
  ["interaction on unknown panel", (m) => { m.interactions[0].on = "ghost.rowClick"; }, "interactions[0].on"],
  ["interaction with empty actions", (m) => { m.interactions[0].do = []; }, "interactions[0].do"],
  ["unknown action verb", (m) => { m.interactions[0].do = [{ action: "drop" }]; }, "interactions[0].do[0].action"],
  ["filter on dimension the panel cannot emit", (m) => { m.interactions[0].do[0].dimension = "channel"; }, "interactions[0].do[0].dimension"],
  ["bad hex colour", (m) => { m.theme = { colors: ["rebeccapurple"] }; }, "theme.colors[0]"],
  // Four- and eight-digit hex carry alpha, which the palette maths cannot
  // represent; five and seven digits are not a colour in any notation. All
  // of these used to validate and then throw when the palette was measured.
  ["hex colour with alpha", (m) => { m.theme = { colors: ["#1234"] }; }, "theme.colors[0]"],
  ["eight-digit hex colour", (m) => { m.theme = { colors: ["#12345678"] }; }, "theme.colors[0]"],
  ["five-digit hex colour", (m) => { m.theme = { colors: ["#12345"] }; }, "theme.colors[0]"],
  ["reserved dimension id", (m) => { m.model.dimensions[0].id = "__proto__"; }, "model.dimensions[0].id"],
  ["reserved measure id", (m) => { m.model.measures[0].id = "constructor"; }, "model.measures[0].id"],
  ["reserved dataset key", (m) => {
    // Plain assignment would set the prototype instead of adding a key; both
    // JSON.parse and the YAML parser create a real own property here, so the
    // corpus has to reproduce that rather than the assignment.
    Object.defineProperty(m.datasets, "__proto__", {
      value: { measures: ["revenue"] }, enumerable: true, configurable: true, writable: true,
    });
  }, "datasets.__proto__"],
];

describe("rejection corpus", () => {
  it("has at least 20 cases", () => {
    expect(REJECTIONS.length).toBeGreaterThanOrEqual(20);
  });

  it.each(REJECTIONS)("rejects: %s", (_name, mutate, path) => {
    const m = good();
    mutate(m);
    const r = validateManifest(m);
    expect(r.ok, "expected rejection but the manifest validated").toBe(false);
    if (r.ok) return;
    const paths = r.issues.map((i) => i.path);
    expect(paths, `issues were:\n${formatIssues(r.issues)}`).toContain(path);
  });
});

describe("filter values", () => {
  // Both executors answer "this dimension is blank"; a manifest has to be able
  // to write it, in a scalar and inside an `in` list alike.
  const withFilters = (filters: unknown): string =>
    refText.replace(
      "  by_channel:\n    dimensions: [channel]",
      `  by_channel:\n    filters: ${JSON.stringify(filters)}\n    dimensions: [channel]`,
    );

  it("accepts a null equality filter", () => {
    const r = parseManifest(withFilters([{ dimension: "region", op: "eq", value: null }]));
    expect(r.ok, r.ok ? "" : formatIssues(r.issues)).toBe(true);
    expect(r.ok && (r.manifest.datasets["by_channel"]!.filters as any)[0].value).toBe(null);
  });

  it("accepts a null inside an in-list", () => {
    const r = parseManifest(
      withFilters([{ dimension: "region", op: "in", values: ["North", null] }]),
    );
    expect(r.ok, r.ok ? "" : formatIssues(r.issues)).toBe(true);
  });

  it("still rejects a value that is neither scalar nor null", () => {
    const r = parseManifest(withFilters([{ dimension: "region", op: "eq", value: { a: 1 } }]));
    expect(r.ok).toBe(false);
  });
});

describe("relations", () => {
  const twice = (a: string, b: string): string => [
    "gridwright: 1",
    "source:",
    "  kind: file",
    "  files: [{ id: orders, path: ./o.csv }, { id: customers, path: ./c.csv }]",
    "  relations:",
    `    - { left: ${a}, right: ${b}, cardinality: many-to-one }`,
    `    - { left: ${a}, right: ${b}, cardinality: many-to-one }`,
    "model:",
    "  fields: [{ name: amount, type: number, from: orders.amount }]",
    "  dimensions: []",
    "  measures: [{ id: total, expr: \"sum(amount)\" }]",
    "datasets: { totals: { measures: [total] } }",
    "panels: []",
  ].join("\n");

  it("names both tables when two relations connect the same pair", () => {
    const r = parseManifest(twice("orders.customer_id", "customers.customer_id"));
    expect(r.ok).toBe(false);
    const messages = r.ok ? [] : r.issues.map((i) => i.message);
    expect(messages.join("\n")).toContain("(customers and orders)");
  });

  it("names the pair the same way whichever side is declared first", () => {
    // The report is order-independent, so the two declarations dedupe rather
    // than being reported as two different pairs.
    const flipped = parseManifest(twice("customers.customer_id", "orders.customer_id"));
    const messages = flipped.ok ? [] : flipped.issues.map((i) => i.message);
    expect(messages.filter((m) => m.includes("same pair of tables"))).toHaveLength(1);
    expect(messages.join("\n")).toContain("(customers and orders)");
  });
});

describe("input hardening", () => {
  it("rejects a manifest over the size ceiling", () => {
    const r = parseManifest("gridwright: 1\n# " + "x".repeat(600_000));
    expect(r.ok).toBe(false);
    expect(r.ok || r.issues[0]!.message).toMatch(/byte limit/);
  });

  it("rejects non-object roots", () => {
    for (const input of ["- a\n- b", "42", '"text"']) {
      expect(parseManifest(input).ok).toBe(false);
    }
  });

  it("reports a parse error rather than throwing", () => {
    const r = parseManifest("gridwright: 1\n  bad: [indent");
    expect(r.ok).toBe(false);
    expect(r.ok || r.issues[0]!.message).toMatch(/could not parse/);
  });

  it("caps YAML alias expansion", () => {
    // A billion-laughs style payload must not hang the validator.
    const bomb = [
      "gridwright: 1",
      "a: &a [x, x, x, x, x, x, x, x, x]",
      "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]",
      "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]",
      "d: [*c, *c, *c, *c, *c, *c, *c, *c, *c]",
    ].join("\n");
    const r = parseManifest(bomb);
    expect(r.ok).toBe(false);
  });

  it("rejects a __proto__ key arriving through the YAML parser", () => {
    const text = refText.replace("datasets:\n", "datasets:\n  __proto__: { measures: [revenue] }\n");
    const r = parseManifest(text);
    expect(r.ok).toBe(false);
    expect(r.ok || r.issues.some((i) => /reserved name/.test(i.message))).toBe(true);
  });

  it("does not let an object-internal name satisfy a required property", () => {
    // `"constructor" in {}` is true; the shape check must use own-property tests.
    const r = validateManifest({ gridwright: 1, constructor: "x" });
    expect(r.ok).toBe(false);
    expect(r.ok || r.issues.some((i) => i.path === "source")).toBe(true);
  });

  it("accepts unknown props on panels — the registry owns that shape", () => {
    const m = good();
    m.panels[0].props = { anything: { nested: true }, count: 3 };
    expect(validateManifest(m).ok).toBe(true);
  });
});

describe("migrations", () => {
  it("passes a current-version manifest through untouched", () => {
    const m = good();
    const r = migrate(m);
    expect(r.from).toBe(LATEST_VERSION);
    expect(r.to).toBe(LATEST_VERSION);
    expect(r.applied).toEqual([]);
    expect(r.issues).toEqual([]);
  });

  it("refuses a manifest from the future with an actionable message", () => {
    const r = migrate({ gridwright: LATEST_VERSION + 1 });
    expect(r.issues[0]!.message).toMatch(/upgrade Gridwright/);
  });
});

describe("json schema mirror", () => {
  it("emits a draft 2020-12 object schema", () => {
    const s = manifestJsonSchema() as any;
    expect(s.$schema).toContain("2020-12");
    expect(s.type).toBe("object");
    expect(s.required).toContain("source");
    expect(s.properties.panels.type).toBe("array");
    expect(s.additionalProperties).toBe(false);
  });
});
