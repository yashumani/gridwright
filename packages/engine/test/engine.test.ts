import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseManifest, type Manifest } from "@gridwright/schema";
import {
  Engine, EngineError, MemorySource, QueryCache,
  compileDataset, hashPlan, loadDelimited, parseDelimited, planToSql, projectFields,
  sourceFromText, typesForTable,
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
    const plan = compileDataset(m, "by_channel");
    expect(plan.fields.sort()).toEqual(["amount", "channel"]);
  });

  it("routes a sort on a post measure to the post tier", () => {
    const custom = structuredClone(m);
    custom.datasets["by_region"]!.sort = [{ measure: "rev_share", dir: "desc" }];
    const plan = compileDataset(custom, "by_region");
    expect(plan.preSort).toEqual([]);
    expect(plan.postSort).toHaveLength(1);
  });

  it("refuses a dataset spanning two tables", () => {
    const custom = structuredClone(m);
    custom.source.files.push({ id: "other", path: "./o.csv", format: "csv" });
    custom.model.fields.push({ name: "extra", type: "number", from: "other.extra" });
    custom.model.measures.push({ id: "ex", label: "Extra", expr: "sum(extra)" });
    custom.datasets["by_region"]!.measures.push("ex");
    expect(() => compileDataset(custom, "by_region")).toThrow(/reads from/);
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
    expect(sql).toContain('GROUP BY "channel"');
    expect(sql).toContain('sum("amount")');
    expect(sql).not.toContain("WITH grouped");
  });

  it("wraps post measures in an outer pass", () => {
    const sql = planToSql(compileDataset(m, "by_region"));
    expect(sql).toContain("WITH grouped AS (");
    expect(sql).toContain("FROM grouped");
  });

  it("applies grain in both the projection and the group by", () => {
    const sql = planToSql(compileDataset(m, "by_month"));
    expect(sql).toContain(`date_trunc('month', "order_date")`);
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
