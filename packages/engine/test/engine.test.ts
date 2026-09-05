import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatIssues, parseManifest, validateManifest, type Manifest } from "@gridwright/schema";
import { analyzeExpression } from "@gridwright/expr";
import {
  Engine, EngineError, MemorySource, QueryCache,
  compileDataset, hashPlan, loadDelimited, parseDelimited, planToSql, projectFields,
  inferManifest, loadBundle, planToSqlParams, sniffType, sourceFromText, typesForTable,
  type QueryResult, type Table, type Value,
} from "@gridwright/engine";

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const refText = readFileSync(dir("../../../examples/sales-overview.gw.yaml"), "utf8");
const salesCsv = readFileSync(dir("../../../examples/sales.csv"), "utf8");

function manifest(): Manifest {
  const r = parseManifest(refText);
  if (!r.ok) throw new Error(JSON.stringify(r.issues, null, 2));
  return r.manifest;
}

const col = (r: QueryResult, key: string): Value[] => r.data[key]!;

describe("plan compilation", () => {
  const m = manifest();

  it("splits measures into aggregate and post tiers", () => {
    const plan = compileDataset(m, "by_region");
    expect(plan.aggregate.map((x) => x.id).sort()).toEqual(["orders", "revenue"]);
    expect(plan.post.map((x) => x.id).sort()).toEqual(["aov", "rev_share"]);
  });

  it("pulls in measures a selected measure depends on", () => {
    // by_region selects aov but not orders; orders must still be computed.
    const plan = compileDataset(m, "by_region");
    expect(plan.aggregate.some((x) => x.id === "orders")).toBe(true);
  });

  it("emits dependencies before dependents", () => {
    const plan = compileDataset(m, "by_month");
    const ids = [...plan.aggregate, ...plan.post].map((x) => x.id);
    expect(ids.indexOf("rev_mom")).toBeGreaterThan(ids.indexOf("revenue"));
  });

  it("projects only the fields the query reads", () => {
    // by_region groups one dimension and sums one column, so the plan must
    // touch exactly two of the model's five fields.
    const plan = compileDataset(m, "by_region");
    expect(plan.fields.sort()).toEqual(["amount", "region"]);

    // A dataset that measures more reads more: countIf(returned) pulls the
    // boolean in, and nothing else.
    expect(compileDataset(m, "by_channel").fields.sort())
      .toEqual(["amount", "channel", "returned"]);
  });

  it("routes a sort on a post measure to the post tier", () => {
    const custom = structuredClone(m);
    custom.datasets["by_region"]!.sort = [{ measure: "rev_share", dir: "desc" }];
    const plan = compileDataset(custom, "by_region");
    expect(plan.preSort).toEqual([]);
    expect(plan.postSort).toHaveLength(1);
  });

  it("refuses a dataset spanning two tables that nothing connects", () => {
    const custom = structuredClone(m);
    custom.source.files.push({ id: "other", path: "./o.csv", format: "csv" });
    custom.model.fields.push({ name: "extra", type: "number", from: "other.extra" });
    custom.model.measures.push({ id: "ex", label: "Extra", expr: "sum(extra)" });
    custom.datasets["by_region"]!.measures.push("ex");
    expect(() => compileDataset(custom, "by_region")).toThrow(/are not connected/);
  });

  it("hashes equal plans identically and unequal plans differently", () => {
    const a = compileDataset(m, "by_region");
    const b = compileDataset(m, "by_region");
    const c = compileDataset(m, "by_region", {
      runtimeFilters: [{ dimension: "region", op: "in", values: ["North"] }],
    });
    expect(hashPlan(a)).toBe(hashPlan(b));
    expect(hashPlan(a)).not.toBe(hashPlan(c));
  });
});

// A hand-checkable fixture: every expected number below is computable by eye.
const tiny: Table = {
  name: "sales",
  rowCount: 6,
  columns: {
    region: ["N", "N", "S", "S", "S", "E"],
    channel: ["Web", "Shop", "Web", "Web", "Shop", "Web"],
    order_date: ["2024-01-05", "2024-01-20", "2024-02-11", "2024-02-14", "2024-03-02", "2024-03-30"],
    amount: [100, 200, 50, 150, 400, 300],
    returned: [false, true, false, false, true, false],
  },
};

const tinyManifest = (over: Partial<Manifest> = {}): Manifest => ({
  gridwright: 1,
  source: { kind: "file", files: [{ id: "sales", path: "./s.csv" }] },
  model: {
    fields: [
      { name: "region", type: "string", from: "sales.region" },
      { name: "channel", type: "string", from: "sales.channel" },
      { name: "order_date", type: "date", from: "sales.order_date" },
      { name: "amount", type: "number", from: "sales.amount" },
      { name: "returned", type: "boolean", from: "sales.returned" },
    ],
    dimensions: [
      { id: "region", field: "region" },
      { id: "channel", field: "channel" },
      { id: "month", field: "order_date", grain: "month" },
    ],
    measures: [
      { id: "revenue", expr: "sum(amount)" },
      { id: "orders", expr: "count()" },
      { id: "aov", expr: "measure(revenue) / measure(orders)" },
      { id: "run", expr: "runningSum(measure(revenue))" },
      { id: "share", expr: "pctOfTotal(measure(revenue))" },
    ],
  },
  datasets: {
    by_region: { dimensions: ["region"], measures: ["revenue", "orders", "aov"], sort: [{ measure: "revenue", dir: "desc" }] },
    by_month: { dimensions: ["month"], measures: ["revenue", "run"], sort: [{ dimension: "month", dir: "asc" }] },
    totals: { measures: ["revenue", "orders"] },
  },
  panels: [],
  ...over,
});

const tinyEngine = (m = tinyManifest()) =>
  new Engine(m, MemorySource.fromTables([tiny]), { cache: false });

describe("execution", () => {
  it("groups and aggregates", async () => {
    const r = await tinyEngine().query("by_region");
    expect(col(r, "d_region")).toEqual(["S", "N", "E"]); // revenue desc: 600, 300, 300 -> stable
    expect(col(r, "m_revenue")).toEqual([600, 300, 300]);
    expect(col(r, "m_orders")).toEqual([3, 2, 1]);
  });

  it("computes composed measures after aggregation", async () => {
    const r = await tinyEngine().query("by_region");
    expect(col(r, "m_aov")).toEqual([200, 150, 300]);
  });

  it("returns a single row when no dimensions are selected", async () => {
    const r = await tinyEngine().query("totals");
    expect(r.rowCount).toBe(1);
    expect(col(r, "m_revenue")).toEqual([1200]);
    expect(col(r, "m_orders")).toEqual([6]);
  });

  it("buckets dates by grain", async () => {
    const r = await tinyEngine().query("by_month");
    expect(col(r, "d_month")).toEqual(["2024-01-01", "2024-02-01", "2024-03-01"]);
    expect(col(r, "m_revenue")).toEqual([300, 200, 700]);
  });

  it("runs window functions in the declared sort order", async () => {
    // The whole point of sorting before the post tier: a running total must
    // accumulate in month order, not in whatever order groups were discovered.
    const r = await tinyEngine().query("by_month");
    expect(col(r, "m_run")).toEqual([300, 500, 1200]);
  });

  it("sorts nulls last under either direction", async () => {
    const withNulls: Table = {
      name: "sales", rowCount: 3,
      columns: { region: ["A", "B", "C"], amount: [5, null, 10], channel: ["", "", ""], order_date: ["2024-01-01", "2024-01-01", "2024-01-01"], returned: [false, false, false] },
    };
    const e = new Engine(tinyManifest(), MemorySource.fromTables([withNulls]), { cache: false });
    for (const dir of ["asc", "desc"] as const) {
      const m = tinyManifest();
      m.datasets["by_region"]!.sort = [{ measure: "revenue", dir }];
      const r = await new Engine(m, MemorySource.fromTables([withNulls]), { cache: false }).query("by_region");
      expect(col(r, "d_region").at(-1), dir).toBe("B");
    }
    expect(e).toBeTruthy();
  });

  it("keeps values of different types in different groups", async () => {
    const mixed: Table = {
      name: "sales", rowCount: 2,
      columns: { region: ["1", 1 as unknown as string], amount: [10, 20], channel: ["", ""], order_date: ["2024-01-01", "2024-01-01"], returned: [false, false] },
    };
    const r = await new Engine(tinyManifest(), MemorySource.fromTables([mixed]), { cache: false }).query("by_region");
    expect(r.rowCount).toBe(2);
  });

  it("reports a missing column with the columns that do exist", async () => {
    const broken: Table = { name: "sales", rowCount: 1, columns: { region: ["N"] }, };
    await expect(
      new Engine(tinyManifest(), MemorySource.fromTables([broken]), { cache: false }).query("by_region"),
    ).rejects.toThrow(EngineError);
  });
});

describe("filters", () => {
  const run = (filters: any[], dataset = "by_region") =>
    tinyEngine().query(dataset, { filters });

  it("narrows on the grouped dimension", async () => {
    const r = await run([{ dimension: "region", op: "in", values: ["N"] }]);
    expect(col(r, "d_region")).toEqual(["N"]);
    expect(col(r, "m_revenue")).toEqual([300]);
  });

  it("narrows on a dimension the dataset does not group by", async () => {
    // This is the cross-filter case: clicking a channel must move the region panel.
    const r = await run([{ dimension: "channel", op: "eq", value: "Web" }]);
    // Web rows only: E=300, S=50+150=200, N=100, sorted by revenue desc.
    expect(col(r, "d_region")).toEqual(["E", "S", "N"]);
    expect(col(r, "m_revenue")).toEqual([300, 200, 100]);
  });

  it("matches the bucketed value when filtering a grained dimension", async () => {
    const r = await run([{ dimension: "month", op: "eq", value: "2024-03-01" }], "by_month");
    expect(col(r, "d_month")).toEqual(["2024-03-01"]);
    expect(col(r, "m_revenue")).toEqual([700]);
  });

  it("supports every comparison operator", async () => {
    const cases: Array<[any, number]> = [
      [{ dimension: "region", op: "eq", value: "N" }, 1],
      [{ dimension: "region", op: "ne", value: "N" }, 2],
      [{ dimension: "region", op: "in", values: ["N", "S"] }, 2],
      [{ dimension: "region", op: "in", values: [] }, 0],
      [{ dimension: "region", op: "gt", value: "N" }, 1],
      [{ dimension: "region", op: "gte", value: "N" }, 2],
      [{ dimension: "region", op: "lt", value: "N" }, 1],
      [{ dimension: "region", op: "lte", value: "N" }, 2],
      [{ dimension: "region", op: "between", from: "E", to: "N" }, 2],
    ];
    for (const [f, expected] of cases) {
      const r = await run([f]);
      expect(r.rowCount, JSON.stringify(f)).toBe(expected);
    }
  });

  it("ANDs multiple filters", async () => {
    const r = await run([
      { dimension: "region", op: "eq", value: "S" },
      { dimension: "channel", op: "eq", value: "Web" },
    ]);
    expect(col(r, "m_revenue")).toEqual([200]);
  });

  it("recomputes post measures against the filtered total", async () => {
    const m = tinyManifest();
    m.datasets["by_region"]!.measures = ["revenue", "share"];
    const e = new Engine(m, MemorySource.fromTables([tiny]), { cache: false });
    const all = await e.query("by_region");
    expect((col(all, "m_share") as number[]).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    const filtered = await e.query("by_region", {
      filters: [{ dimension: "region", op: "in", values: ["N", "S"] }],
    });
    // Shares must re-base on the filtered set, not the original total.
    expect((col(filtered, "m_share") as number[]).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe("limits", () => {
  it("truncates and reports the untruncated group count", async () => {
    const m = tinyManifest();
    m.datasets["by_region"]!.limit = 2;
    const r = await tinyEngine(m).query("by_region");
    expect(r.rowCount).toBe(2);
    expect(r.truncated).toBe(true);
    expect(r.totalGroups).toBe(3);
  });

  it("does not flag truncation when everything fits", async () => {
    const r = await tinyEngine().query("by_region");
    expect(r.truncated).toBe(false);
  });
});

describe("cache", () => {
  it("serves a repeated query without re-executing", async () => {
    const e = new Engine(tinyManifest(), MemorySource.fromTables([tiny]));
    await e.query("by_region");
    await e.query("by_region");
    expect(e.getStats()).toEqual({ queries: 1, cacheHits: 1 });
  });

  it("misses when the filters differ", async () => {
    const e = new Engine(tinyManifest(), MemorySource.fromTables([tiny]));
    await e.query("by_region");
    await e.query("by_region", { filters: [{ dimension: "region", op: "eq", value: "N" }] });
    expect(e.getStats().queries).toBe(2);
  });

  it("evicts least-recently-used entries past the ceiling", () => {
    const c = new QueryCache(2);
    c.set("a", {} as QueryResult);
    c.set("b", {} as QueryResult);
    c.get("a");            // 'a' is now the most recent
    c.set("c", {} as QueryResult);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBeDefined();
    expect(c.size).toBe(2);
  });
});

describe("delimited loading", () => {
  it("reads quoted fields, embedded delimiters and newlines", () => {
    const rows = parseDelimited('a,b\n"x,1","line\nbreak"\n');
    expect(rows[1]).toEqual(["x,1", "line\nbreak"]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseDelimited('a\n"say ""hi"""\n')[1]).toEqual(['say "hi"']);
  });

  it("strips a UTF-8 BOM from the header", () => {
    expect(parseDelimited("﻿id,name\n1,x\n")[0]).toEqual(["id", "name"]);
  });

  it("rejects an unterminated quote with a line number", () => {
    expect(() => parseDelimited('a\n"oops\n')).toThrow(/unterminated quoted field/);
  });

  it("rejects duplicate column names", () => {
    expect(() => loadDelimited("t", "a,a\n1,2\n")).toThrow(/duplicate column/);
  });

  it("coerces by declared type", () => {
    const t = loadDelimited("t", "n,b,d,s\n\"1,234.5\",yes,2024-03-05,hello\n", {
      types: { n: "number", b: "boolean", d: "date", s: "string" },
    });
    expect(t.columns["n"]).toEqual([1234.5]);
    expect(t.columns["b"]).toEqual([true]);
    expect(t.columns["d"]).toEqual(["2024-03-05"]);
    expect(t.columns["s"]).toEqual(["hello"]);
  });

  it("turns blanks and unparseable values into null, not NaN", () => {
    const t = loadDelimited("t", "n,d\n,notadate\n", { types: { n: "number", d: "date" } });
    expect(t.columns["n"]).toEqual([null]);
    expect(t.columns["d"]).toEqual([null]);
  });

  it("renames source columns onto manifest field names", () => {
    const m = tinyManifest();
    // A manifest whose fields are exactly what this two-column file provides.
    m.model.fields = [
      { name: "region", type: "string", from: "sales.RegionCode" },
      { name: "amount", type: "number", from: "sales.Total" },
    ];
    const raw = loadDelimited("sales", "RegionCode,Total\nN,10\n", { types: { Total: "number" } });
    const projected = projectFields(m, raw);
    expect(projected.columns["region"]).toEqual(["N"]);
    expect(projected.columns["amount"]).toEqual([10]);
    expect(projected.columns["RegionCode"]).toBeUndefined();
  });

  it("names the missing column when a field points at nothing", () => {
    expect(() => projectFields(tinyManifest(), loadDelimited("sales", "x\n1\n")))
      .toThrow(/has no column/);
  });

  it("derives types for a table from the manifest", () => {
    expect(typesForTable(tinyManifest(), "sales")["amount"]).toBe("number");
  });
});

describe("sql emission", () => {
  const m = manifest();

  it("emits a grouped query for a purely aggregate dataset", () => {
    const sql = planToSql(compileDataset(m, "by_channel"));
    expect(sql).toContain('GROUP BY "sales"."channel"');
    expect(sql).toContain('sum("sales"."amount")');
    expect(sql).not.toContain("WITH grouped");
  });

  it("wraps post measures in an outer pass", () => {
    const sql = planToSql(compileDataset(m, "by_region"));
    expect(sql).toContain("WITH grouped AS (");
    expect(sql).toContain("FROM grouped");
  });

  it("applies grain in both the projection and the group by", () => {
    const sql = planToSql(compileDataset(m, "by_month"));
    expect(sql).toContain(`date_trunc('month', "sales"."order_date")`);
  });

  it("parameterises filter values through the literal escaper", () => {
    const plan = compileDataset(m, "by_region", {
      runtimeFilters: [{ dimension: "region", op: "eq", value: "O'Brien" }],
    });
    expect(planToSql(plan)).toContain("'O''Brien'");
  });

  it("emits FALSE for an empty IN list rather than invalid SQL", () => {
    const plan = compileDataset(m, "by_region", {
      runtimeFilters: [{ dimension: "region", op: "in", values: [] }],
    });
    expect(planToSql(plan)).toContain("WHERE FALSE");
  });

  it("orders nulls last, matching the executor", () => {
    expect(planToSql(compileDataset(m, "by_channel"))).toContain("NULLS LAST");
  });

  it("gives every window frame its own ORDER BY", () => {
    // A subquery's ORDER BY does not propagate into an outer window, so
    // `over ()` here would make a running total non-deterministic on a real
    // backend even though the in-process executor gets it right.
    const sql = planToSql(compileDataset(m, "by_month"));
    expect(sql).not.toContain("over ()");
    expect(sql).toMatch(/sum\("m_revenue"\) over \(order by "d_month"/);
    expect(sql).toMatch(/lag\("m_revenue", 1\) over \(order by "d_month"/);
  });

  it("leaves whole-partition windows unordered", () => {
    // pctOfTotal spans the partition; an ORDER BY there would change its meaning.
    const custom = structuredClone(m);
    custom.datasets["by_region"]!.sort = [];
    const sql = planToSql(compileDataset(custom, "by_region"));
    expect(sql).toContain("over ()");
  });
});

describe("end to end on the reference manifest", () => {
  const m = manifest();
  const source = sourceFromText(m, { sales: salesCsv });
  const engine = new Engine(m, source);

  it("runs every dataset the manifest declares", async () => {
    const results = await engine.queryAll(Object.keys(m.datasets));
    for (const [name, r] of Object.entries(results)) {
      expect(r.rowCount, name).toBeGreaterThan(0);
    }
  });

  it("agrees with a straight scan of the source data", async () => {
    const rows = salesCsv.trim().split("\n").slice(1).map((l) => l.split(","));
    const expected = rows.reduce((t, r) => t + Number(r[4]), 0);
    const r = await engine.query("totals");
    expect(col(r, "m_revenue")[0]).toBeCloseTo(expected, 2);
    expect(col(r, "m_orders")[0]).toBe(rows.length);
  });

  it("keeps a running total monotonic across months", async () => {
    const r = await engine.query("by_month");
    const run = col(r, "m_rev_run") as number[];
    for (let i = 1; i < run.length; i++) expect(run[i]!).toBeGreaterThanOrEqual(run[i - 1]!);
  });

  it("produces shares that sum to one", async () => {
    const r = await engine.query("by_region");
    expect((col(r, "m_rev_share") as number[]).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe("performance", () => {
  it("groups a million rows on 2 dimensions and 4 measures inside the budget", async () => {
    const n = 1_000_000;
    const regions = ["North", "South", "East", "West", "Central"];
    const channels = ["Online", "Retail", "Partner", "Direct"];
    const region: Value[] = new Array(n);
    const channel: Value[] = new Array(n);
    const amount: Value[] = new Array(n);
    const returned: Value[] = new Array(n);
    const order_date: Value[] = new Array(n);
    for (let i = 0; i < n; i++) {
      region[i] = regions[i % 5]!;
      channel[i] = channels[i % 4]!;
      amount[i] = (i % 977) + 1;
      returned[i] = i % 13 === 0;
      order_date[i] = "2024-01-01";
    }
    const big: Table = { name: "sales", rowCount: n, columns: { region, channel, amount, returned, order_date } };

    const m = tinyManifest();
    m.model.measures.push({ id: "returns", expr: "countIf(returned)" });
    m.datasets["wide"] = {
      dimensions: ["region", "channel"],
      measures: ["revenue", "orders", "aov", "returns"],
      sort: [{ measure: "revenue", dir: "desc" }],
    };
    const e = new Engine(m, MemorySource.fromTables([big]));

    const cold = Date.now();
    const first = await e.query("wide");
    const coldMs = Date.now() - cold;

    const warm = Date.now();
    await e.query("wide");
    const warmMs = Date.now() - warm;

    expect(first.rowCount).toBe(20);
    expect(warmMs).toBeLessThan(500);
    // Reported for visibility; the cold path is the one worth watching.
    expect(coldMs).toBeLessThan(20_000);
    console.log(`      1M rows: cold ${coldMs}ms, warm ${warmMs}ms, ${first.totalGroups} groups`);
  }, 60_000);
});

describe("loading a dropped bundle", () => {
  const manifestText = readFileSync(dir("../../../examples/sales-overview.gw.yaml"), "utf8");
  const load = (files: Array<{ name: string; text: string }>) => loadBundle(manifestText, files);

  it("matches a data file to the table by its declared path", () => {
    const r = load([{ name: "sales.csv", text: salesCsv }]);
    expect(r.ok, r.ok ? "" : JSON.stringify(r.issues)).toBe(true);
  });

  it("ignores directories in the declared path", () => {
    // A dropped File has a bare name; the manifest says "./sales.csv".
    const r = load([{ name: "/home/me/Downloads/sales.csv", text: salesCsv }]);
    expect(r.ok).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(load([{ name: "SALES.CSV", text: salesCsv }]).ok).toBe(true);
  });

  it("accepts a sole unmatched file for a sole table", () => {
    const r = load([{ name: "export-2024.csv", text: salesCsv }]);
    expect(r.ok, r.ok ? "" : JSON.stringify(r.issues)).toBe(true);
  });

  it("names the file it wanted when nothing matches", () => {
    const r = load([]);
    expect(r.ok).toBe(false);
    expect(r.ok || r.issues[0]!.message).toMatch(/no file supplied for table "sales"/);
  });

  it("reports an invalid manifest instead of throwing", () => {
    const r = loadBundle("gridwright: 1\nnope: true\n", []);
    expect(r.ok).toBe(false);
    expect(r.ok || r.issues.length).toBeGreaterThan(0);
  });

  it("reports a bad measure expression at load time", () => {
    const broken = manifestText.replace('expr: "sum(amount)"', 'expr: "sum(amount"');
    const r = loadBundle(broken, [{ name: "sales.csv", text: salesCsv }]);
    expect(r.ok).toBe(false);
    expect(r.ok || r.issues.some((i) => /model\.measures/.test(i.path))).toBe(true);
  });

  it("returns a ready engine that answers queries", async () => {
    const r = load([{ name: "sales.csv", text: salesCsv }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const result = await r.engine.query("by_region");
    expect(result.rowCount).toBe(5);
  });

  it("surfaces a column mismatch with the columns the file has", () => {
    const r = load([{ name: "sales.csv", text: "order_date,region\n2024-01-01,N\n" }]);
    expect(r.ok).toBe(false);
    expect(r.ok || r.issues[0]!.message).toMatch(/has no column/);
  });
});

describe("untrusted manifest input", () => {
  const manifestText = readFileSync(dir("../../../examples/sales-overview.gw.yaml"), "utf8");

  it("keeps markup in a title as data, never as structure", () => {
    const evil = manifestText.replace("title: Sales overview", 'title: "<img src=x onerror=alert(1)>"');
    const r = loadBundle(evil, [{ name: "sales.csv", text: salesCsv }]);
    expect(r.ok).toBe(true);
    // The string survives verbatim; escaping is the renderer's job and React
    // does it by construction. What matters here is that it is never parsed.
    expect(r.ok && r.manifest.title).toBe("<img src=x onerror=alert(1)>");
  });

  it("refuses a filter value that would break out of a SQL literal", () => {
    const m = manifest();
    const plan = compileDataset(m, "by_region", {
      runtimeFilters: [{ dimension: "region", op: "eq", value: "'; DROP TABLE sales; --" }],
    });
    const sql = planToSql(plan);
    expect(sql).toContain("'''; DROP TABLE sales; --'");
    expect(sql).not.toMatch(/;\s*DROP TABLE sales;\s*--'?\s*$/);
  });

  it("refuses an injected identifier at the compiler, before SQL is ever emitted", () => {
    const m = manifest();
    m.model.dimensions[0]!.field = 'region" ; drop table t; --';
    expect(() => compileDataset(m, "by_region")).toThrow(/unknown field/);
  });

  it("still refuses it at the emitter, for a plan that skipped the compiler", () => {
    // The two layers are independent on purpose: a caller building a plan by
    // hand must not be able to reach the query text with a raw identifier.
    const plan = compileDataset(manifest(), "by_region");
    const evil = 'region" ; drop table t; --';
    const tampered = {
      ...plan,
      dimensions: [{ ...plan.dimensions[0]!, field: evil }],
      fieldMap: { ...plan.fieldMap, [evil]: { table: "sales", column: evil } },
    };
    expect(() => planToSql(tampered)).toThrow(/unsafe SQL identifier/);
  });

  it("refuses an unsafe table name too", () => {
    const plan = compileDataset(manifest(), "by_region");
    expect(() => planToSql({ ...plan, table: 'sales"; drop table t; --' }))
      .toThrow(/unsafe SQL identifier/);
  });

  it("caps the result at the cell ceiling even when the manifest asks for more", async () => {
    const wide: Table = {
      name: "sales", rowCount: 5,
      columns: {
        region: ["a", "b", "c", "d", "e"], amount: [1, 2, 3, 4, 5],
        channel: ["", "", "", "", ""], order_date: Array(5).fill("2024-01-01"), returned: Array(5).fill(false),
      },
    };
    const tm = tinyManifest();
    tm.datasets["by_region"]!.limit = 100_000;
    const r = await new Engine(tm, MemorySource.fromTables([wide]), { cache: false }).query("by_region");
    expect(r.rowCount).toBe(5);
    expect(r.truncated).toBe(false);
  });
});

// Every case below is one a review caught and the suite did not. They are
// grouped together so it stays obvious what each is guarding.
describe("regressions", () => {
  it("returns a totals row even when the filters match nothing", async () => {
    // An aggregate query with no GROUP BY yields one row in SQL whatever the
    // WHERE says. Returning none instead makes every KPI vanish the moment a
    // cross-filter excludes the last record.
    const r = await tinyEngine().query("totals", {
      filters: [{ dimension: "region", op: "in", values: ["nowhere"] }],
    });
    expect(r.rowCount).toBe(1);
    expect(col(r, "m_orders")).toEqual([0]);
    expect(col(r, "m_revenue")).toEqual([null]); // sum of nothing, as in SQL
  });

  it("returns a totals row for an empty source", async () => {
    const empty: Table = {
      name: "sales", rowCount: 0,
      columns: { region: [], channel: [], order_date: [], amount: [], returned: [] },
    };
    const e = new Engine(tinyManifest(), MemorySource.fromTables([empty]), { cache: false });
    const r = await e.query("totals");
    expect(r.rowCount).toBe(1);
    expect(col(r, "m_orders")).toEqual([0]);
  });

  it("applies a dimension's grain to a filter the dataset does not group by", () => {
    // `month` is a dimension id, not a column: filtering it has to truncate
    // order_date. Emitting a bare "month" would name a column nothing has.
    const plan = compileDataset(tinyManifest(), "by_region", {
      runtimeFilters: [{ dimension: "month", op: "eq", value: "2024-02-01" }],
    });
    const sql = planToSql(plan);
    const where = sql.slice(sql.indexOf("WHERE"));
    expect(where).toContain(`date_trunc('month', "sales"."order_date") = '2024-02-01'`);
    expect(where).not.toMatch(/"month"/);
  });

  it("restates the display order on the outer query", () => {
    // ORDER BY inside a CTE does not bind the query that reads it, so a
    // month-sorted line dataset with a window measure would otherwise come
    // back in whatever order the backend liked.
    const sql = planToSql(compileDataset(tinyManifest(), "by_month"));
    const outer = sql.slice(sql.lastIndexOf("FROM grouped"));
    expect(outer).toContain(`ORDER BY "d_month" ASC NULLS LAST`);
  });

  it("keeps a post measure out of the select list that defines what it reads", () => {
    // `double_aov` reads `aov`, which is itself a post measure. A sibling
    // alias is not visible to its neighbours, so the two need separate passes.
    const m = tinyManifest();
    m.model.measures.push({ id: "double_aov", expr: "measure(aov) * 2" });
    m.datasets["by_region"]!.measures.push("double_aov");

    const sql = planToSql(compileDataset(m, "by_region"));
    const cte = sql.slice(sql.indexOf("post_1 AS ("), sql.lastIndexOf("SELECT *,"));
    const final = sql.slice(sql.lastIndexOf("SELECT *,"));

    expect(cte).toContain(`AS "m_aov"`);
    expect(final).toContain(`AS "m_double_aov"`);
    // The dependency is defined one pass earlier, never beside its dependent.
    expect(final).not.toContain(`AS "m_aov"`);
    expect(final).toContain(`"m_aov"`);
  });

  it("computes a post measure that reads another post measure", async () => {
    const m = tinyManifest();
    m.model.measures.push({ id: "double_aov", expr: "measure(aov) * 2" });
    m.datasets["by_region"]!.measures.push("double_aov");
    const r = await tinyEngine(m).query("by_region");
    expect(col(r, "m_aov")).toEqual([200, 150, 300]);
    expect(col(r, "m_double_aov")).toEqual([400, 300, 600]);
  });
});

describe("json sources", () => {
  const jsonManifest = (): Manifest => {
    const m = tinyManifest();
    m.source.files = [{ id: "sales", path: "./s.json", format: "json" }];
    return m;
  };

  const rows = [
    { region: "N", channel: "Web",  order_date: "2024-01-05", amount: 100, returned: false },
    { region: "N", channel: "Shop", order_date: "2024-01-20", amount: 200, returned: true },
    { region: "S", channel: "Web",  order_date: "2024-02-11", amount: 50,  returned: false },
  ];

  it("parses a declared json table instead of reading it as csv", async () => {
    const m = jsonManifest();
    const source = sourceFromText(m, { sales: JSON.stringify(rows) });
    const r = await new Engine(m, source, { cache: false }).query("by_region");
    expect(col(r, "d_region")).toEqual(["N", "S"]);
    expect(col(r, "m_revenue")).toEqual([300, 50]);
  });

  it("keeps json's own types rather than restringifying them", async () => {
    const m = jsonManifest();
    const source = sourceFromText(m, { sales: JSON.stringify(rows) });
    const r = await new Engine(m, source, { cache: false }).query("totals");
    expect(col(r, "m_revenue")).toEqual([350]);
  });

  it("reads a column the first row declared but a later row omits as blank", async () => {
    const m = jsonManifest();
    const partial = [rows[0], { region: "S", order_date: "2024-02-11", amount: 50 }];
    const source = sourceFromText(m, { sales: JSON.stringify(partial) });
    const r = await new Engine(m, source, { cache: false }).query("by_region");
    expect(r.rowCount).toBe(2);
  });

  it("names the column when a cell holds something a table cannot", () => {
    const m = jsonManifest();
    const bad = [{ ...rows[0], region: { nested: true } }];
    expect(() => sourceFromText(m, { sales: JSON.stringify(bad) }))
      .toThrow(/non-scalar value in column "region"/);
  });

  it("says so plainly when the document is not an array of rows", () => {
    const m = jsonManifest();
    expect(() => sourceFromText(m, { sales: '{"rows": []}' }))
      .toThrow(/must be a JSON array of row objects/);
    expect(() => sourceFromText(m, { sales: "{oops" })).toThrow(/is not valid JSON/);
  });
});

describe("bound parameters", () => {
  // planToSql escapes for ANSI, which is right for Postgres, DuckDB and
  // SQLite and wrong for a backend that also honours backslash escapes.
  // Binding is what makes the adapter seam safe on every backend.
  const m = manifest();

  it("replaces every filter value with a placeholder", () => {
    const plan = compileDataset(m, "by_channel", {
      runtimeFilters: [{ dimension: "region", op: "in", values: ["North", "South"] }],
    });
    const { sql, params } = planToSqlParams(plan);
    expect(sql).toContain("IN (?, ?)");
    expect(sql).not.toContain("North");
    expect(params).toEqual(["North", "South"]);
  });

  it("binds a value that ANSI escaping would not contain on MySQL", () => {
    // A trailing backslash: `'north\'` leaves the string open where backslash
    // is an escape character, and everything after it is read as SQL.
    const evil = "north\\";
    const plan = compileDataset(m, "by_channel", {
      runtimeFilters: [{ dimension: "region", op: "eq", value: evil }],
    });
    expect(planToSql(plan)).toContain(`'north\\'`);

    const { sql, params } = planToSqlParams(plan);
    expect(sql).toContain(`= ?`);
    expect(sql).not.toContain("north");
    expect(params).toEqual([evil]);
  });

  it("binds constants written inside a measure expression too", () => {
    const custom = structuredClone(m);
    custom.model.measures.push({ id: "scaled", expr: "sum(amount) * 1000" });
    custom.datasets["by_channel"]!.measures.push("scaled");
    const { sql, params } = planToSqlParams(compileDataset(custom, "by_channel"));
    expect(params).toContain(1000);
    expect(sql).not.toMatch(/\b1000\b/);
  });

  it("keeps NULL a keyword rather than binding it", () => {
    // A bound NULL compares as unknown; `IS NULL` is the only form that works.
    const plan = compileDataset(m, "by_channel", {
      runtimeFilters: [{ dimension: "region", op: "eq", value: null }],
    });
    const { sql, params } = planToSqlParams(plan);
    expect(sql).toContain("IS NULL");
    expect(params).toEqual([]);
  });

  it("emits the same query shape as the readable form", () => {
    const plan = compileDataset(m, "by_month");
    const bound = planToSqlParams(plan).sql;
    const readable = planToSql(plan);
    // Same structure; only the constants differ.
    expect(bound.split("\n").length).toBe(readable.split("\n").length);
    expect(bound).toContain("WITH grouped AS (");
    expect(bound).toContain("GROUP BY");
  });
});

describe("inferring a manifest from bare data", () => {
  // The path for somebody who has a spreadsheet and has never heard of the
  // manifest format. Every guess below is one a wrong answer would make
  // visibly silly, which is why it is pinned.
  const csv = readFileSync(dir("../../../examples/sales.csv"), "utf8");
  const table = () => loadDelimited("sales", csv);

  it("sniffs a column's type from its values", () => {
    expect(sniffType(["2024-01-05", "2024-02-11"])).toBe("date");
    expect(sniffType(["1200.50", "980"])).toBe("number");
    expect(sniffType(["true", "no", "Y"])).toBe("boolean");
    expect(sniffType(["North", "South"])).toBe("string");
    expect(sniffType([null, "", null])).toBe("string");
  });

  it("does not read a bare number as a date", () => {
    // Date.parse("2024") succeeds, which would turn a count column into a
    // timeline and a bar chart into nonsense.
    expect(sniffType(["2024", "1999", "5"])).toBe("number");
  });

  it("reads 0/1 as a number, because from values alone it cannot be a flag", () => {
    // "true"/"yes" are unambiguous; digits are not. A quantity column that
    // happens to hold only 0 and 1 would be destroyed by guessing boolean —
    // the measure disappears — whereas summing a flag still counts its trues.
    // So the ambiguous case takes the recoverable side.
    expect(sniffType(["1", "0", "1"])).toBe("number");
    expect(sniffType(["true", "false"])).toBe("boolean");
    expect(sniffType(["yes", "N"])).toBe("boolean");
  });

  it("does not turn an identifier made of digits into a number", () => {
    // Both of these lose data with no error anywhere, which is what makes them
    // worse than a file that simply refuses to load.
    //
    // A ZIP code, SKU or account number written 00123 is 123 once it is a
    // number, and the leading zeros are gone from every row, chart and export.
    expect(sniffType(["00123", "00456"])).toBe("string");
    expect(sniffType(["007"])).toBe("string");
    // Past 2^53 the parse itself is lossy: 9007199254740993 comes back as
    // ...992, so the number on screen is not the number in the file — and two
    // ids one apart can land on the same value and merge into a single row.
    expect(sniffType(["9007199254740993", "9007199254740994"])).toBe("string");
    // Number() also accepts these; a spreadsheet cell holding them does not
    // mean a quantity.
    expect(sniffType(["0x10", "0x20"])).toBe("string");
    expect(sniffType(["Infinity"])).toBe("string");
    expect(sniffType(["1_000"])).toBe("string");
  });

  it("still reads the numbers a person actually types", () => {
    // The guard above must not cost the ordinary cases.
    expect(sniffType(["0", "1", "2"])).toBe("number");
    expect(sniffType(["0.5", "0.25"])).toBe("number");        // a leading zero before a point is a decimal
    expect(sniffType(["-500", "+12"])).toBe("number");
    expect(sniffType(["1.50", "980"])).toBe("number");
    expect(sniffType([" 42 ", "7"])).toBe("number");
    expect(sniffType(["1e3", "2.5e-2"])).toBe("number");
    expect(sniffType([String(Number.MAX_SAFE_INTEGER)])).toBe("number");
  });

  it("reads a number column that has gaps written as words", () => {
    // Real exports write "no value" a dozen ways. Typing the column as text
    // because of them turns every chart it could have drawn into a list of
    // strings — and these coerce to null regardless, so only the type changes.
    expect(sniffType(["10", "NA", "30"])).toBe("number");
    expect(sniffType(["10", "n/a", "30"])).toBe("number");
    expect(sniffType(["10", "NULL", "30"])).toBe("number");
    expect(sniffType(["10", "NaN", "30"])).toBe("number");
    expect(sniffType(["10", "-", "30"])).toBe("number");
    // With nothing but markers there is no evidence to type on.
    expect(sniffType(["NA", "NULL", "-"])).toBe("string");
  });

  it("keeps a count whole when the column has gaps written as words", () => {
    // Found by dropping a real-shaped export on the playground and reading the
    // tile: a units column carrying a few NAs summed to "11,720.00". Typing it
    // as a number is right; formatting it as money because "NA" is not a whole
    // number is not, and the two rules have to agree about what a blank is.
    const t = loadDelimited(
      "orders",
      "region,units,revenue\nNorth,10,12.50\nSouth,NA,8.25\nEast,30,4.00\n",
    );
    const { manifest } = inferManifest(t);
    const fmt = (id: string) => manifest.model.measures.find((m) => m.id === id)?.format;
    expect(fmt("total_units")).toBe("#,##0");
    // And a column that genuinely has decimals still keeps them.
    expect(fmt("total_revenue")).toBe("#,##0.00");
  });

  it("reads an identifier header the way a person wrote it", () => {
    // The test ran against the raw header with an underscore-only pattern, so
    // `Order ID` and `orderId` fell through and were summed — producing exactly
    // the large, confident, meaningless number the rule exists to prevent.
    const t = loadDelimited(
      "sales",
      "Order ID,orderId,Customer Id,amount\n101,55,7,10\n102,56,8,20\n103,57,9,30\n",
    );
    const { manifest, notes } = inferManifest(t);
    const summed = manifest.model.measures.map((m) => m.expr).join(" ");
    for (const id of ["Order_ID", "orderId", "Customer_Id"]) {
      expect(summed).not.toContain(`sum(${id})`);
    }
    expect(summed).toContain("sum(amount)");
    expect(notes.join(" ")).toContain("rather than");
  });

  it("skips a header a manifest cannot name, rather than emitting one that fails", () => {
    // `from` is held to "table.column" with a strict column pattern, so a
    // header like `Order-ID` produced a reference the schema rejects: the whole
    // inferred dashboard failed to validate and could not be reopened from its
    // own export.
    const t = loadDelimited("sales", "Order-ID,2026 Sales,region,amount\nA,1,North,10\nB,2,South,20\n");
    const { manifest, notes } = inferManifest(t);

    expect(manifest.model.fields.map((f) => f.from)).toEqual(["sales.region", "sales.amount"]);
    expect(notes.join(" ")).toContain("Order-ID");

    const check = validateManifest(manifest, {
      checkExpression: (e) => analyzeExpression(e).issues,
    });
    expect(check.ok, check.ok ? "" : formatIssues(check.issues)).toBe(true);
  });

  it("says so rather than throwing something opaque when no header is usable", () => {
    const t = loadDelimited("sales", "Order-ID,2026 Sales\nA,1\n");
    expect(() => inferManifest(t)).toThrow(/no columns a manifest can name/);
  });

  it("produces a manifest that validates and runs", async () => {
    const { manifest } = inferManifest(table());
    const check = validateManifest(JSON.parse(JSON.stringify(manifest)), {
      checkExpression: (e) => analyzeExpression(e).issues,
    });
    expect(check.ok, check.ok ? "" : formatIssues(check.issues)).toBe(true);

    const engine = new Engine(manifest, sourceFromText(manifest, { sales: csv }), { cache: false });
    for (const name of Object.keys(manifest.datasets)) {
      expect((await engine.query(name)).rowCount).toBeGreaterThan(0);
    }
  });

  it("refuses to sum a column that identifies a row", () => {
    // sum(order_id) is a large, confident, meaningless number.
    const { manifest, notes } = inferManifest(table());
    expect(manifest.model.measures.map((m) => m.expr)).not.toContain("sum(order_id)");
    expect(manifest.model.measures.map((m) => m.expr)).toContain("sum(amount)");
    expect(notes.join(" ")).toContain("order_id");
  });

  it("skips a column with a distinct value per row", () => {
    // A legal dimension and a useless chart: one bar per row.
    const wide: Table = {
      name: "t", rowCount: 4,
      columns: {
        email: ["a@x", "b@x", "c@x", "d@x"],
        team: ["red", "red", "blue", "blue"],
        spend: [1, 2, 3, 4],
      },
    };
    const { manifest } = inferManifest(wide);
    const fields = manifest.model.dimensions.map((d) => d.field);
    expect(fields).toContain("team");
    expect(fields).not.toContain("email");
  });

  it("leads with the date, because change over time is the chart people look for", () => {
    const { manifest } = inferManifest(table());
    expect(manifest.model.dimensions[0]!.field).toBe("order_date");
    expect(manifest.model.dimensions[0]!.grain).toBe("month");
    expect(manifest.panels.find((p) => p.type === "line")).toBeTruthy();
  });

  it("lays panels out without leaving a hole in the grid", () => {
    const { manifest } = inferManifest(table());
    const rows = new Map<number, number>();
    for (const p of manifest.panels) {
      rows.set(p.layout.y, (rows.get(p.layout.y) ?? 0) + p.layout.w);
    }
    // Every occupied row is either full width or a tidy pair; none is a lone
    // half-width panel with a gap beside it.
    for (const [y, width] of rows) {
      expect(width, `row ${y} spans ${width} of 12`).toBeLessThanOrEqual(12);
    }
    const ys = [...rows.keys()].sort((a, b) => a - b);
    expect(ys[0]).toBe(0);
    // The KPI row in particular fills its width. Two KPIs at a quarter each
    // leaves half the screen blank, which reads as a dashboard that broke.
    expect(rows.get(0)).toBe(12);
  });

  it("spreads however many KPIs there are across the full row", () => {
    const two: Table = {
      name: "t", rowCount: 4,
      columns: { team: ["a", "a", "b", "b"], spend: [1, 2, 3, 4] },
    };
    const kpis = inferManifest(two).manifest.panels.filter((p) => p.type === "kpi");
    expect(kpis).toHaveLength(2);
    expect(kpis.map((p) => p.layout.w)).toEqual([6, 6]);
    expect(kpis.map((p) => p.layout.x)).toEqual([0, 6]);
  });

  it("makes legal identifiers out of awkward column names", () => {
    const awkward: Table = {
      name: "t", rowCount: 2,
      columns: {
        "Order Date": ["2024-01-01", "2024-02-01"],
        "amount (£)": [1, 2],
        "__proto__": ["a", "b"],
      },
    };
    const { manifest } = inferManifest(awkward);
    for (const f of manifest.model.fields) {
      expect(f.name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
      expect(["__proto__", "constructor", "prototype"]).not.toContain(f.name);
    }
    // The original column is still what gets read from the file.
    expect(manifest.model.fields.map((f) => f.from)).toContain("t.Order Date");
  });

  it("points the manifest at the file the data actually came from", () => {
    // A table id has to be a legal identifier, so "support-tickets.csv" becomes
    // `support_tickets`. Writing the path from the id would name a file nobody
    // has — and the manifest's whole claim is that saving it beside the data
    // reopens the dashboard.
    const t: Table = { name: "support_tickets", rowCount: 2, columns: { team: ["a", "b"] } };
    const { manifest } = inferManifest(t, { path: "support-tickets.csv" });
    expect(manifest.source.files[0]!.path).toBe("./support-tickets.csv");
    expect(manifest.source.files[0]!.id).toBe("support_tickets");

    // With nothing supplied, the id is the only name available.
    expect(inferManifest(t).manifest.source.files[0]!.path).toBe("./support_tickets.csv");
  });

  it("still produces something when nothing is groupable", () => {
    const flat: Table = { name: "t", rowCount: 2, columns: { note: ["a", "b"] } };
    const { manifest, notes } = inferManifest(flat);
    expect(manifest.model.dimensions).toEqual([]);
    expect(manifest.panels.length).toBeGreaterThan(0);
    expect(notes.join(" ")).toMatch(/totals only/i);
  });
});
