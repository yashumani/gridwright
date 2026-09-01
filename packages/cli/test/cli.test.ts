import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDataPath, runCli, validateFile } from "gridwright";

const EXAMPLES = fileURLToPath(new URL("../../../examples/", import.meta.url));
const REF = join(EXAMPLES, "sales-overview.gw.yaml");

const run = (...argv: string[]) => runCli(argv);
const text = (lines: string[]) => lines.join("\n");

async function scratch(name: string, body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gridwright-"));
  const path = join(dir, name);
  await writeFile(path, body, "utf8");
  return path;
}

describe("validate", () => {
  it("accepts the reference manifest", async () => {
    const r = await run("validate", REF);
    expect(r.code, text(r.err)).toBe(0);
    expect(text(r.out)).toContain("✓");
    expect(text(r.out)).toContain("4 datasets");
  });

  it("runs every dataset with --data", async () => {
    const r = await run("validate", REF, "--data");
    expect(r.code, text(r.err)).toBe(0);
    for (const name of ["totals", "by_region", "by_month", "by_channel"]) {
      expect(text(r.out)).toContain(name);
    }
    expect(text(r.out)).toMatch(/\d+ rows? in \d+ms/);
  });

  it("says data was not checked when it was not", async () => {
    const r = await run("validate", REF);
    expect(text(r.out)).toContain("--data");
  });

  it("reports a bad expression against the measure that carries it", async () => {
    const body = (await readFile(REF, "utf8")).replace('expr: "sum(amount)"', 'expr: "sum(amount"');
    const path = await scratch("bad.gw.yaml", body);
    const r = await run("validate", path);
    expect(r.code).toBe(1);
    expect(text(r.err)).toMatch(/model\.measures\[0\]\.expr/);
  });

  it("catches an expression that mixes the two tiers", async () => {
    const body = (await readFile(REF, "utf8"))
      .replace('expr: "sum(amount)"', 'expr: "sum(amount) / measure(orders)"');
    const path = await scratch("mixed.gw.yaml", body);
    const r = await run("validate", path);
    expect(r.code).toBe(1);
    expect(text(r.err)).toMatch(/cannot mix raw aggregates/);
  });

  it("validates panel props against the panel's own schema", async () => {
    const body = (await readFile(REF, "utf8")).replace(
      "props: { measure: revenue, caption: All channels }",
      "props: { measure: 7 }",
    );
    const path = await scratch("props.gw.yaml", body);
    const r = await run("validate", path);
    expect(r.code).toBe(1);
    expect(text(r.err)).toMatch(/panels\[0\]\.props\.measure/);
  });

  it("names a missing data file under --data instead of throwing", async () => {
    const body = (await readFile(REF, "utf8")).replace("./sales.csv", "./nope.csv");
    const path = await scratch("missing.gw.yaml", body);
    const r = await run("validate", path, "--data");
    expect(r.code).toBe(1);
    expect(text(r.err)).toMatch(/could not read "\.\/nope\.csv"/);
  });

  it("reports a column the data does not have", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gridwright-"));
    await writeFile(join(dir, "sales.csv"), "order_date,region,channel,amount\n2024-01-01,N,Web,10\n");
    const path = join(dir, "m.gw.yaml");
    await writeFile(path, await readFile(REF, "utf8"));
    const r = await run("validate", path, "--data");
    expect(r.code).toBe(1);
    // `returned` is declared by the manifest but absent from this file.
    expect(text(r.err)).toMatch(/returned/);
  });

  it("exits 2 when the path is missing", async () => {
    const r = await run("validate");
    expect(r.code).toBe(2);
  });
});

describe("explain", () => {
  it("emits SQL for every dataset", async () => {
    const r = await run("explain", REF);
    const sql = text(r.out);
    expect(r.code).toBe(0);
    expect(sql).toContain("-- by_region");
    expect(sql).toContain("GROUP BY");
    expect(sql).toContain("WITH grouped AS (");
  });

  it("emits SQL for one named dataset", async () => {
    const r = await run("explain", REF, "by_channel");
    expect(text(r.out)).toContain("-- by_channel");
    expect(text(r.out)).not.toContain("-- by_region");
  });

  it("shows the grain in the group by", async () => {
    const r = await run("explain", REF, "by_month");
    expect(text(r.out)).toContain("date_trunc('month'");
  });
});

describe("introspection commands", () => {
  it("lists every expression function with its stage and arity", async () => {
    const r = await run("functions");
    const out = text(r.out);
    for (const name of ["sum", "countDistinct", "lag", "runningSum", "pctOfTotal", "dateTrunc"]) {
      expect(out).toContain(name);
    }
    expect(out).toContain("aggregate");
    expect(out).toContain("window");
    expect(out).toContain("measure");
  });

  it("lists the registered panel types", async () => {
    const r = await run("panels");
    for (const t of ["kpi", "table", "bar", "line"]) expect(text(r.out)).toContain(t);
  });

  it("emits the manifest JSON Schema", async () => {
    const r = await run("schema");
    const parsed = JSON.parse(text(r.out));
    expect(parsed.$schema).toContain("2020-12");
    expect(parsed.properties.panels).toBeTruthy();
  });

  it("writes the schema to a file with --out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gridwright-"));
    const target = join(dir, "schema.json");
    const r = await run("schema", "--out", target);
    expect(r.code).toBe(0);
    expect(JSON.parse(await readFile(target, "utf8")).type).toBe("object");
  });
});

describe("shell behaviour", () => {
  it("prints usage with no arguments", async () => {
    const r = await run();
    expect(r.code).toBe(0);
    expect(text(r.out)).toContain("Usage:");
  });

  it("prints a version", async () => {
    expect(text((await run("--version")).out)).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exits 2 on an unknown command and shows usage", async () => {
    const r = await run("frobnicate");
    expect(r.code).toBe(2);
    expect(text(r.err)).toContain('unknown command "frobnicate"');
  });
});

describe("validateFile as a library call", () => {
  it("returns a structured report rather than printing", async () => {
    const report = await validateFile(REF, { withData: true });
    expect(report.ok).toBe(true);
    expect(report.datasets.map((d) => d.name)).toContain("by_region");
    expect(report.manifest?.model.measures.length).toBeGreaterThan(0);
  });
});

describe("a manifest cannot read outside its own directory", () => {
  // The manifest is untrusted input, so `--data` must not turn a declared
  // path into an arbitrary file read. It would not even be a quiet one: the
  // loader reports the columns it found, and the first line of whatever it
  // opened is that list.
  it("refuses to climb out with ..", () => {
    expect(() => resolveDataPath("/srv/dash", "../../../../etc/passwd"))
      .toThrow(/leaves that directory/);
    expect(() => resolveDataPath("/srv/dash", "../secrets.csv"))
      .toThrow(/leaves that directory/);
  });

  it("refuses an absolute path", () => {
    expect(() => resolveDataPath("/srv/dash", "/etc/passwd")).toThrow(/leaves that directory/);
  });

  it("still allows a sibling file and a subdirectory", () => {
    expect(resolveDataPath("/srv/dash", "./sales.csv")).toBe("/srv/dash/sales.csv");
    expect(resolveDataPath("/srv/dash", "data/sales.csv")).toBe("/srv/dash/data/sales.csv");
    // Climbing out and back in lands inside, so it is allowed.
    expect(resolveDataPath("/srv/dash", "sub/../sales.csv")).toBe("/srv/dash/sales.csv");
  });

  it("reports the refusal as an issue rather than throwing at the caller", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gridwright-"));
    const manifest = [
      "gridwright: 1",
      "source: { kind: file, files: [{ id: t, path: ../../../../etc/passwd }] }",
      "model:",
      "  fields: [{ name: qty, type: number, from: t.qty }]",
      "  dimensions: []",
      "  measures: [{ id: total, expr: \"sum(qty)\" }]",
      "datasets: { totals: { measures: [total] } }",
      "panels: []",
    ].join("\n");
    const file = join(dir, "evil.gw.yaml");
    await writeFile(file, manifest, "utf8");

    const report = await validateFile(file, { withData: true });
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.message).join("\n")).toMatch(/leaves that directory/);
  });
});
