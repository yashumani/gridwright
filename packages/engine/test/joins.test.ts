import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseManifest, type Manifest, type RelationDef } from "@gridwright/schema";
import {
  Engine, EngineError, MemorySource, compileDataset, planJoins, planToSql, sourceFromText,
  type QueryResult, type Table, type Value,
} from "@gridwright/engine";

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const read = (f: string) => readFileSync(dir(`../../../examples/${f}`), "utf8");

const starText = read("orders-star.gw.yaml");
const csv = {
  orders: read("orders.csv"),
  customers: read("customers.csv"),
  products: read("products.csv"),
};

function star(): Manifest {
  const r = parseManifest(starText);
  if (!r.ok) throw new Error(JSON.stringify(r.issues, null, 2));
  return r.manifest;
}

const engine = () => {
  const m = star();
  return new Engine(m, sourceFromText(m, csv));
};

const col = (r: QueryResult, k: string): Value[] => r.data[k]!;
const sum = (r: QueryResult, k: string): number =>
  (col(r, k) as (number | null)[]).reduce<number>((t, v) => t + (v ?? 0), 0);

// Ground truth read straight from the fact file, with no join involved.
const factRows = csv.orders.trim().split("\n").slice(1).map((l) => l.split(","));
const TRUTH = {
  revenue: factRows.reduce((t, r) => t + Number(r[5]), 0),
  orders: factRows.length,
  units: factRows.reduce((t, r) => t + Number(r[4]), 0),
};

describe("the join does not change the fact grain", () => {
  const e = engine();

  it("totals match a straight scan of the fact table", async () => {
    const r = await e.query("totals");
    expect(col(r, "m_revenue")[0] as number).toBeCloseTo(TRUTH.revenue, 2);
    expect(col(r, "m_orders")[0]).toBe(TRUTH.orders);
    expect(col(r, "m_units")[0]).toBe(TRUTH.units);
  });

  it("re-sums to the same total however the joined dimensions slice it", async () => {
    // This is the fan-out check. A join that multiplied rows would inflate one
    // of these, and it would inflate silently.
    for (const dataset of ["by_region", "by_category", "by_month"]) {
      const r = await e.query(dataset);
      expect(sum(r, "m_revenue"), dataset).toBeCloseTo(TRUTH.revenue, 2);
    }
  });

  it("counts orders once per fact row, not once per dimension match", async () => {
    const r = await e.query("by_region");
    expect(sum(r, "m_orders")).toBe(TRUTH.orders);
  });

  it("gives shares that still sum to one across a joined dimension", async () => {
    const r = await e.query("by_region");
    expect(sum(r, "m_share")).toBeCloseTo(1, 6);
  });
});

describe("unmatched facts survive the join", () => {
  it("keeps orders whose customer is missing, under a null group", async () => {
    // The fixture deliberately contains orders for a customer id that is not in
    // the customer file. An inner join would drop them and quietly shrink the
    // totals; a left join keeps them visible as an unattributed bucket.
    const r = await engine().query("by_region");
    const regions = col(r, "d_region");
    expect(regions).toContain(null);
    const orphan = col(r, "m_revenue")[regions.indexOf(null)] as number;
    expect(orphan).toBeGreaterThan(0);
  });

  it("still reconciles to the fact total with the orphans included", async () => {
    const r = await engine().query("by_region");
    expect(sum(r, "m_revenue")).toBeCloseTo(TRUTH.revenue, 2);
  });
});

describe("joining across more than one dimension table", () => {
  it("groups by columns from two different tables at once", async () => {
    const r = await engine().query("top_products");
    // product_name comes from products, and the measure from orders.
    expect(r.columns.map((c) => c.id)).toEqual(
      expect.arrayContaining(["product", "category", "revenue", "units", "aov"]),
    );
    expect(r.rowCount).toBe(15);
    expect((col(r, "m_revenue") as number[]).every((v) => v > 0)).toBe(true);
  });

  it("only joins the tables a dataset actually reads", () => {
    // by_region needs customers; products must not be dragged in.
    const plan = compileDataset(star(), "by_region");
    expect(plan.table).toBe("orders");
    expect(plan.joins.map((j) => j.table)).toEqual(["customers"]);
  });

  it("joins both dimension tables when a dataset spans them", () => {
    const m = star();
    m.datasets["mixed"] = { dimensions: ["region", "category"], measures: ["revenue"] };
    const plan = compileDataset(m, "mixed");
    expect(plan.joins.map((j) => j.table).sort()).toEqual(["customers", "products"]);
  });

  it("needs no join when every field is on one table", () => {
    const m = star();
    m.datasets["fact_only"] = { dimensions: ["month"], measures: ["revenue", "units"] };
    const plan = compileDataset(m, "fact_only");
    expect(plan.joins).toEqual([]);
    expect(plan.table).toBe("orders");
  });
});

describe("cross-filtering reaches through the join", () => {
  it("narrows a product-grouped dataset by a customer attribute", async () => {
    const e = engine();
    const all = await e.query("top_products");
    const filtered = await e.query("top_products", {
      filters: [{ dimension: "region", op: "eq", value: "North" }],
    });
    expect(sum(filtered, "m_revenue")).toBeLessThan(sum(all, "m_revenue"));
    expect(sum(filtered, "m_revenue")).toBeGreaterThan(0);
  });

  it("splits the fact total exactly across a joined dimension's values", async () => {
    const e = engine();
    const byRegion = await e.query("by_region");
    const values = col(byRegion, "d_region").filter((v): v is string => v !== null);

    let recombined = 0;
    for (const v of values) {
      const part = await e.query("totals", {
        filters: [{ dimension: "region", op: "eq", value: v }],
      });
      recombined += (col(part, "m_revenue")[0] as number) ?? 0;
    }
    const orphan = col(byRegion, "m_revenue")[col(byRegion, "d_region").indexOf(null)] as number;
    expect(recombined + orphan).toBeCloseTo(TRUTH.revenue, 2);
  });
});

describe("fan-out is refused, not silently computed", () => {
  it("refuses a dataset that would have to walk one-to-many", () => {
    // Customers and products share no grain: reaching one from the other means
    // going out through the fact table and back, multiplying rows on the way.
    const m = star();
    m.model.measures.push({ id: "cost", label: "Cost", expr: "sum(unit_cost)" });
    m.datasets["bad"] = { dimensions: ["region"], measures: ["cost"] };
    expect(() => compileDataset(m, "bad")).toThrow(EngineError);
    expect(() => compileDataset(m, "bad")).toThrow(/multiplying rows/);
  });

  it("explains the consequence rather than just refusing", () => {
    const m = star();
    m.model.measures.push({ id: "cost", label: "Cost", expr: "sum(unit_cost)" });
    m.datasets["bad"] = { dimensions: ["region"], measures: ["cost"] };
    try {
      compileDataset(m, "bad");
      expect.unreachable("should have refused");
    } catch (err) {
      expect((err as EngineError).detail).toMatch(/double-count/);
    }
  });

  it("allows the same tables once a fact-table field anchors the grain", () => {
    // Adding a measure over the fact table makes `orders` a valid base, and
    // every dimension is then reachable many-to-one.
    const m = star();
    m.datasets["fine"] = { dimensions: ["region", "category"], measures: ["revenue"] };
    expect(() => compileDataset(m, "fine")).not.toThrow();
  });

  it("refuses tables nothing connects", () => {
    const m = star();
    m.source.files.push({ id: "loose", path: "./loose.csv" });
    m.source.relations = m.source.relations ?? [];
    m.model.fields.push({ name: "loose_val", type: "number", from: "loose.val" });
    m.model.measures.push({ id: "lv", label: "Loose", expr: "sum(loose_val)" });
    m.datasets["broken"] = { dimensions: ["region"], measures: ["lv"] };
    expect(() => compileDataset(m, "broken")).toThrow(/are not connected/);
  });
});

describe("the join planner", () => {
  const relations: RelationDef[] = [
    { left: "f.a_id", right: "a.id", cardinality: "many-to-one" },
    { left: "f.b_id", right: "b.id", cardinality: "many-to-one" },
    { left: "a.c_id", right: "c.id", cardinality: "many-to-one" },
  ];
  const order = ["f", "a", "b", "c"];

  it("returns the single table unchanged", () => {
    expect(planJoins(relations, ["a"], { fileOrder: order })).toEqual({ base: "a", steps: [] });
  });

  it("chains a two-hop path", () => {
    const plan = planJoins(relations, ["f", "c"], { fileOrder: order });
    expect(plan.base).toBe("f");
    expect(plan.steps.map((s) => s.table)).toEqual(["a", "c"]);
    // Each step must hang off something already joined.
    expect(plan.steps[1]!.fromTable).toBe("a");
  });

  it("drops hops nothing needs", () => {
    const plan = planJoins(relations, ["f", "b"], { fileOrder: order });
    expect(plan.steps.map((s) => s.table)).toEqual(["b"]);
  });

  it("picks a base that reaches everything by safe edges only", () => {
    const plan = planJoins(relations, ["a", "f"], { fileOrder: order });
    expect(plan.base).toBe("f");
  });

  it("treats one-to-one as safe in both directions", () => {
    const oneToOne: RelationDef[] = [{ left: "a.id", right: "b.id", cardinality: "one-to-one" }];
    expect(planJoins(oneToOne, ["b", "a"], { fileOrder: ["a", "b"] }).steps).toHaveLength(1);
  });

  it("defaults an unspecified cardinality to many-to-one", () => {
    const implied: RelationDef[] = [{ left: "f.a_id", right: "a.id" }];
    expect(planJoins(implied, ["f", "a"], { fileOrder: ["f", "a"] }).base).toBe("f");
    expect(() => planJoins(implied, ["a", "f"], { fileOrder: ["a", "f"] })).not.toThrow();
  });

  it("is deterministic, so a plan hash stays a usable cache key", () => {
    const a = planJoins(relations, ["f", "c", "b"], { fileOrder: order });
    const b = planJoins(relations, ["b", "c", "f"], { fileOrder: order });
    expect(a).toEqual(b);
  });
});

describe("join key handling", () => {
  const tables = (): Table[] => [
    {
      name: "f", rowCount: 4,
      columns: { key: ["1", "2", "2", null], amount: [10, 20, 30, 40] },
    },
    {
      name: "d", rowCount: 3,
      columns: { key: ["1", "2", "3"], label: ["one", "two", "three"] },
    },
  ];

  const joined = (over: Partial<Manifest> = {}): Manifest => ({
    gridwright: 1,
    source: {
      kind: "file",
      files: [{ id: "f", path: "./f.csv" }, { id: "d", path: "./d.csv" }],
      relations: [{ left: "f.key", right: "d.key", cardinality: "many-to-one" }],
    },
    model: {
      fields: [
        { name: "amount", type: "number", from: "f.amount" },
        { name: "label", type: "string", from: "d.label" },
      ],
      dimensions: [{ id: "label", field: "label" }],
      measures: [{ id: "total", expr: "sum(amount)" }, { id: "n", expr: "count()" }],
    },
    datasets: { by_label: { dimensions: ["label"], measures: ["total", "n"] } },
    panels: [],
    ...over,
  });

  const run = (t = tables()) =>
    new Engine(joined(), MemorySource.fromTables(t), { cache: false }).query("by_label");

  it("attaches the dimension label to every matching fact row", async () => {
    const r = await run();
    const map = new Map(col(r, "d_label").map((k, i) => [k, col(r, "m_total")[i]]));
    expect(map.get("one")).toBe(10);
    expect(map.get("two")).toBe(50);
  });

  it("keeps a fact row whose key is null", async () => {
    const r = await run();
    expect(col(r, "d_label")).toContain(null);
    expect(sum(r, "m_total")).toBe(100);
  });

  it("does not invent rows for dimension values with no facts", async () => {
    const r = await run();
    // "three" exists in the dimension table but no fact references it.
    expect(col(r, "d_label")).not.toContain("three");
  });

  it("does not match across types", async () => {
    const t = tables();
    t[1]!.columns["key"] = [1 as unknown as string, 2 as unknown as string, "3"];
    const r = await run(t);
    // Numeric 1 must not match the string "1".
    expect(col(r, "d_label").every((v) => v === null)).toBe(true);
  });

  it("names a join key that does not exist in the data", async () => {
    const t = tables();
    delete t[1]!.columns["key"];
    await expect(run(t)).rejects.toThrow(/join key "d\.key" does not exist/);
  });
});

describe("emitted SQL", () => {
  it("uses LEFT JOIN so facts are never dropped", () => {
    const sql = planToSql(compileDataset(star(), "by_region"));
    expect(sql).toContain('LEFT JOIN "customers" ON "orders"."customer_id" = "customers"."customer_id"');
    expect(sql).not.toContain("INNER JOIN");
  });

  it("qualifies every column with its table", () => {
    const sql = planToSql(compileDataset(star(), "by_region"));
    expect(sql).toContain('"customers"."region"');
    expect(sql).toContain('sum("orders"."amount")');
  });

  it("emits only the joins the dataset needs", () => {
    const sql = planToSql(compileDataset(star(), "by_region"));
    expect(sql).not.toContain('"products"');
  });

  it("emits both joins when a dataset spans two dimension tables", () => {
    const sql = planToSql(compileDataset(star(), "top_products"));
    expect(sql).toContain('LEFT JOIN "products"');
    expect(sql).toContain('GROUP BY "products"."product_name", "products"."category"');
  });

  it("qualifies a filter on a dimension the dataset does not group by", () => {
    const plan = compileDataset(star(), "by_category", {
      runtimeFilters: [{ dimension: "region", op: "eq", value: "North" }],
    });
    const sql = planToSql(plan);
    expect(sql).toContain('"customers"."region" = \'North\'');
    expect(sql).toContain('LEFT JOIN "customers"');
  });
});

describe("load-time validation", () => {
  it("names a column the data does not have, before any query runs", () => {
    const m = star();
    expect(() => sourceFromText(m, { ...csv, customers: "customer_id,name\nC001,x\n" }))
      .toThrow(/has no column "region"/);
  });

  it("names a missing join key at load time too", () => {
    // Every declared field column is present here; only the join key is gone,
    // so this isolates the relation check from the field check.
    const m = star();
    expect(() =>
      sourceFromText(m, { ...csv, products: "product_name,category,unit_cost\nx,y,1\n" }),
    ).toThrow(/relation reads products\.product_id/);
  });
});

describe("performance with joins", () => {
  it("hash-joins a large fact table without going quadratic", async () => {
    const n = 400_000;
    const dims = 5_000;
    const key: Value[] = new Array(n);
    const amount: Value[] = new Array(n);
    for (let i = 0; i < n; i++) {
      key[i] = `K${i % dims}`;
      amount[i] = (i % 97) + 1;
    }
    const dKey: Value[] = new Array(dims);
    const dLabel: Value[] = new Array(dims);
    for (let i = 0; i < dims; i++) {
      dKey[i] = `K${i}`;
      dLabel[i] = `Label ${i % 50}`;
    }

    const m: Manifest = {
      gridwright: 1,
      source: {
        kind: "file",
        files: [{ id: "f", path: "./f.csv" }, { id: "d", path: "./d.csv" }],
        relations: [{ left: "f.key", right: "d.key", cardinality: "many-to-one" }],
      },
      model: {
        fields: [
          { name: "amount", type: "number", from: "f.amount" },
          { name: "label", type: "string", from: "d.label" },
        ],
        dimensions: [{ id: "label", field: "label" }],
        measures: [{ id: "total", expr: "sum(amount)" }],
      },
      datasets: { by_label: { dimensions: ["label"], measures: ["total"] } },
      panels: [],
    };
    const source = MemorySource.fromTables([
      { name: "f", rowCount: n, columns: { key, amount } },
      { name: "d", rowCount: dims, columns: { key: dKey, label: dLabel } },
    ]);

    const started = Date.now();
    const r = await new Engine(m, source, { cache: false }).query("by_label");
    const ms = Date.now() - started;

    expect(r.rowCount).toBe(50);
    // Every fact row must be accounted for exactly once.
    expect(sum(r, "m_total")).toBe((amount as number[]).reduce((a, b) => a + b, 0));
    expect(ms).toBeLessThan(5_000);
    console.log(`      400k facts joined to 5k dimension rows in ${ms}ms`);
  }, 30_000);
});
