import { describe, expect, it } from "vitest";
import type { Manifest } from "@gridwright/schema";
import { Engine, MemorySource, type QueryResult, type Value } from "@gridwright/engine";

/**
 * Scale and cache-correctness.
 *
 * The executor caches join indexes and dimension encodings across queries,
 * because neither depends on the filters and cross-filtering changes only the
 * filters. Caching derived state is a classic source of stale answers, so the
 * correctness half of this file matters more than the timings.
 */

const REGIONS = ["North", "South", "East", "West", "Central"];
const CHANNELS = ["Online", "Retail", "Partner", "Direct"];

function fixture(n: number) {
  const region: Value[] = new Array(n);
  const channel: Value[] = new Array(n);
  const amount: Value[] = new Array(n);
  const returned: Value[] = new Array(n);
  const day: Value[] = new Array(n);
  for (let i = 0; i < n; i++) {
    region[i] = REGIONS[i % 5]!;
    channel[i] = CHANNELS[i % 4]!;
    amount[i] = i % 37 === 0 ? null : (i % 977) + 0.5;
    returned[i] = i % 13 === 0;
    day[i] = `2024-${String((i % 12) + 1).padStart(2, "0")}-15`;
  }
  return { name: "t", rowCount: n, columns: { region, channel, amount, returned, day } };
}

const manifest: Manifest = {
  gridwright: 1,
  source: { kind: "file", files: [{ id: "t", path: "./t.csv" }] },
  model: {
    fields: [
      { name: "region", type: "string", from: "t.region" },
      { name: "channel", type: "string", from: "t.channel" },
      { name: "amount", type: "number", from: "t.amount" },
      { name: "returned", type: "boolean", from: "t.returned" },
      { name: "day", type: "date", from: "t.day" },
    ],
    dimensions: [
      { id: "region", field: "region" },
      { id: "channel", field: "channel" },
      { id: "month", field: "day", grain: "month" },
      { id: "quarter", field: "day", grain: "quarter" },
      { id: "rawday", field: "day" },
    ],
    measures: [
      { id: "revenue", expr: "sum(amount)" },
      { id: "orders", expr: "count()" },
      { id: "returns", expr: "countIf(returned)" },
      { id: "net", expr: "sum(if(returned, 0, amount))" },
    ],
  },
  datasets: {
    wide: { dimensions: ["region", "channel"], measures: ["revenue", "orders", "returns"] },
    totals: { measures: ["revenue", "orders", "net"] },
    by_month: { dimensions: ["month"], measures: ["revenue"] },
    by_quarter: { dimensions: ["quarter"], measures: ["revenue"] },
    by_day: { dimensions: ["rawday"], measures: ["revenue"] },
  },
  panels: [],
};

const col = (r: QueryResult, k: string): Value[] => r.data[k]!;
const sum = (r: QueryResult, k: string): number =>
  (col(r, k) as (number | null)[]).reduce<number>((t, v) => t + (v ?? 0), 0);

/** Engine result cache off, so every call does real work through the executor. */
const engineOver = (table: ReturnType<typeof fixture>) =>
  new Engine(manifest, MemorySource.fromTables([table]), { cache: false });

describe("cached derived state stays correct", () => {
  const table = fixture(20_000);
  const e = engineOver(table);

  it("gives the same answer on a repeat query", async () => {
    const first = await e.query("wide");
    const second = await e.query("wide");
    expect(second.data).toEqual(first.data);
  });

  it("does not leak a previous filter into the next query", async () => {
    const all = await e.query("totals");
    await e.query("totals", { filters: [{ dimension: "region", op: "eq", value: "North" }] });
    const again = await e.query("totals");
    expect(again.data).toEqual(all.data);
  });

  it("narrows and widens repeatedly without drifting", async () => {
    const baseline = sum(await e.query("wide"), "m_revenue");
    for (const region of REGIONS) {
      const part = await e.query("wide", {
        filters: [{ dimension: "region", op: "eq", value: region }],
      });
      expect(part.rowCount).toBe(4);
      expect(sum(part, "m_revenue")).toBeLessThan(baseline);
    }
    expect(sum(await e.query("wide"), "m_revenue")).toBeCloseTo(baseline, 6);
  });

  it("splits the total exactly across a dimension's values", async () => {
    const total = (col(await e.query("totals"), "m_revenue")[0] as number);
    let recombined = 0;
    for (const region of REGIONS) {
      const part = await e.query("totals", {
        filters: [{ dimension: "region", op: "eq", value: region }],
      });
      recombined += col(part, "m_revenue")[0] as number;
    }
    expect(recombined).toBeCloseTo(total, 6);
  });

  it("keeps encodings of the same field at different grains apart", async () => {
    // month, quarter and raw day all read `day`; a cache keyed only on the
    // field would hand one of them another's buckets.
    const months = await e.query("by_month");
    const quarters = await e.query("by_quarter");
    const days = await e.query("by_day");
    expect(months.rowCount).toBe(12);
    expect(quarters.rowCount).toBe(4);
    expect(days.rowCount).toBe(12);
    expect(col(months, "d_month")).toContain("2024-03-01");
    expect(col(quarters, "d_quarter")).toEqual(
      ["2024-01-01", "2024-04-01", "2024-07-01", "2024-10-01"].sort(),
    );
    // Each grain re-sums to the same revenue.
    expect(sum(months, "m_revenue")).toBeCloseTo(sum(quarters, "m_revenue"), 6);
  });

  it("survives clearing the derived indexes mid-flight", async () => {
    const source = MemorySource.fromTables([table]);
    const fresh = new Engine(manifest, source, { cache: false });
    const before = await fresh.query("wide");
    source.clearDerived();
    const after = await fresh.query("wide");
    expect(after.data).toEqual(before.data);
  });

  it("agrees with a straight scan of the source columns", async () => {
    const r = await e.query("totals");
    const amounts = table.columns.amount as (number | null)[];
    const truth = amounts.reduce<number>((t, v) => t + (v ?? 0), 0);
    expect(col(r, "m_revenue")[0] as number).toBeCloseTo(truth, 6);
    expect(col(r, "m_orders")[0]).toBe(table.rowCount);
  });

  it("computes a non-trivial aggregate the same way as the fast path", async () => {
    // `net` wraps a conditional, so it takes the general evaluator while
    // `revenue` takes the direct-column path. They must agree on the same data.
    const r = await e.query("totals");
    const amounts = table.columns.amount as (number | null)[];
    const flags = table.columns.returned as boolean[];
    const truth = amounts.reduce<number>((t, v, i) => t + (flags[i] ? 0 : v ?? 0), 0);
    expect(col(r, "m_net")[0] as number).toBeCloseTo(truth, 6);
  });
});

describe("scale", () => {
  it("groups five million rows and cross-filters inside the budget", async () => {
    const n = 5_000_000;
    const e = engineOver(fixture(n));

    const cold0 = Date.now();
    const first = await e.query("wide");
    const cold = Date.now() - cold0;

    // The path a user hammers: same shape, different filter each time. Join
    // indexes and encodings are already built, so only filter, group and
    // aggregate re-run.
    const filter0 = Date.now();
    for (const region of REGIONS) {
      await e.query("wide", { filters: [{ dimension: "region", op: "eq", value: region }] });
    }
    const perFilter = (Date.now() - filter0) / REGIONS.length;

    expect(first.rowCount).toBe(20);
    expect(first.totalGroups).toBe(20);
    expect(cold).toBeLessThan(15_000);
    expect(perFilter).toBeLessThan(3_000);
    console.log(
      `      ${n / 1e6}M rows: ${cold}ms cold, ${Math.round(perFilter)}ms per cross-filter`,
    );
  }, 120_000);
});
