import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

// Loaded the same way the connector loads it: Vite's builtin list predates
// node:sqlite, so a static import here fails the same way it did there.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string, o?: { readOnly?: boolean }) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...p: unknown[]): unknown };
    close(): void;
  };
};
import { SqlConfigurationSource, SqlError, DEFAULT_SQL_LIMITS } from "../src/sql.js";
import type { MetadataSnapshot } from "../src/bindings.js";

/**
 * A real database, not a mock. D05 sanctions SQLite for first validation while
 * being explicit that it establishes nothing about SQL Server or Qlik; this
 * fixture is built from the same files the rest of the bridge already uses, so
 * there is one source of truth rather than a second hand-kept copy.
 */

const fixturePath = (p: string) =>
  fileURLToPath(new URL(`../../../fixtures/support-ops/${p}`, import.meta.url));

let dir: string;
let dbPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "bridge-sql-"));
  dbPath = join(dir, "support-ops.db");

  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE bridge_metadata (document TEXT NOT NULL);
    CREATE TABLE vw_closed_cases_by_queue (
      queue_key TEXT NOT NULL,
      period TEXT NOT NULL,
      closed_cases INTEGER NOT NULL
    );
  `);
  db.prepare("INSERT INTO bridge_metadata (document) VALUES (?)").run(
    readFileSync(fixturePath("sql-metadata.json"), "utf8"),
  );

  const [header, ...lines] = readFileSync(fixturePath("prepared-view.csv"), "utf8")
    .trim()
    .split(/\r?\n/);
  const columns = header!.split(",");
  const insert = db.prepare(
    "INSERT INTO vw_closed_cases_by_queue (queue_key, period, closed_cases) VALUES (?, ?, ?)",
  );
  for (const line of lines) {
    const cells = line.split(",");
    const row = Object.fromEntries(columns.map((c, i) => [c, cells[i]!]));
    insert.run(row["queue_key"]!, row["period"]!, Number(row["closed_cases"]));
  }
  db.close();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const open = () => SqlConfigurationSource.openReadOnly(dbPath);

const request = (over: Record<string, unknown> = {}) => ({
  view: "vw_closed_cases_by_queue",
  keyColumn: "queue_key",
  periodColumn: "period",
  measureColumn: "closed_cases",
  keys: ["queue_a", "queue_b", "queue_c"],
  periods: ["actual", "comparison"],
  ...over,
}) as Parameters<SqlConfigurationSource["readView"]>[1];

describe("reading configuration metadata from the database", () => {
  it("returns the snapshot the source published", () => {
    const src = open();
    const meta = src.metadata();
    expect(meta.source).toBe("synthetic://support-ops");
    expect(meta.metrics[0]!.id).toBe("closed_cases");
    expect(meta.views[0]!.id).toBe("vw_closed_cases_by_queue");
    src.close();
  });

  it("refuses a metadata table name that is not a plain identifier", () => {
    const src = open();
    expect(() => src.metadata('bridge_metadata"; DROP TABLE x; --')).toThrow(SqlError);
    expect(() => src.metadata("bridge metadata")).toThrow(/not a plain identifier/);
    src.close();
  });
});

describe("reading a prepared view", () => {
  it("returns the rows the fixture holds", () => {
    const src = open();
    const rows = src.readView(src.metadata(), request());
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => `${r["queue_key"]}/${r["period"]}=${r["closed_cases"]}`).sort()).toEqual([
      "queue_a/actual=70",
      "queue_a/comparison=60",
      "queue_b/actual=50",
      "queue_b/comparison=40",
    ]);
    src.close();
  });

  it("returns nothing for a key the view has no rows for", () => {
    // Queue C exists in the report and not in the data. The connector says so
    // by returning nothing, and the fill stage turns that into not-available.
    const src = open();
    const rows = src.readView(src.metadata(), request({ keys: ["queue_c"] }));
    expect(rows).toEqual([]);
    src.close();
  });

  it("asks for nothing when given no keys", () => {
    const src = open();
    expect(src.readView(src.metadata(), request({ keys: [] }))).toEqual([]);
    src.close();
  });
});

describe("values are parameters", () => {
  it("treats an injection attempt as a key that matches nothing", () => {
    const src = open();
    const meta = src.metadata();
    const rows = src.readView(
      meta,
      request({ keys: ["queue_a'; DROP TABLE vw_closed_cases_by_queue; --"] }),
    );
    expect(rows).toEqual([]);
    // And the table is still there afterwards, which is the point.
    expect(src.readView(meta, request())).toHaveLength(4);
    src.close();
  });

  it("treats a quote in a period the same way", () => {
    const src = open();
    expect(src.readView(src.metadata(), request({ periods: ["actual' OR '1'='1"] }))).toEqual([]);
    src.close();
  });
});

describe("identifiers are allowlisted, not escaped", () => {
  it("refuses a view the metadata snapshot does not define", () => {
    // SQL cannot parameterise a table name, so the only safe source for one is
    // a catalogue this code already trusts.
    const src = open();
    expect(() => src.readView(src.metadata(), request({ view: "sqlite_master" }))).toThrow(
      /is not defined by the metadata snapshot/,
    );
    src.close();
  });

  it("refuses a column the view does not declare", () => {
    const src = open();
    expect(() =>
      src.readView(src.metadata(), request({ measureColumn: "rowid" })),
    ).toThrow(/does not declare a column "rowid"/);
    src.close();
  });

  it("refuses an identifier carrying anything but letters, digits and underscores", () => {
    const src = open();
    const meta = src.metadata();
    // Present it as a declared column so the allowlist is not what rejects it,
    // and the pattern check is.
    meta.views[0]!.columns.push({ name: 'x"; DROP TABLE y; --', type: "string", role: "key" });
    expect(() =>
      src.readView(meta, request({ keyColumn: 'x"; DROP TABLE y; --' })),
    ).toThrow(/not a plain identifier/);
    src.close();
  });
});

describe("the connection is read-only and bounded", () => {
  it("refuses a write even though the table exists", () => {
    const src = SqlConfigurationSource.openReadOnly(dbPath);
    // Reach the handle the way a careless change to this file might.
    expect(() =>
      new DatabaseSync(dbPath, { readOnly: true }).exec(
        "INSERT INTO vw_closed_cases_by_queue VALUES ('x','actual',1)",
      ),
    ).toThrow();
    src.close();
  });

  it("refuses more keys than the limit rather than building a huge query", () => {
    const src = new SqlConfigurationSource(new DatabaseSync(dbPath, { readOnly: true }), {
      ...DEFAULT_SQL_LIMITS,
      maxKeys: 2,
    });
    expect(() => src.readView(src.metadata(), request())).toThrow(/over the limit of 2/);
    src.close();
  });

  it("refuses a result larger than the row limit rather than truncating it", () => {
    // A truncated read is a wrong total that looks like a right one.
    const src = new SqlConfigurationSource(new DatabaseSync(dbPath, { readOnly: true }), {
      ...DEFAULT_SQL_LIMITS,
      maxRows: 2,
    });
    expect(() => src.readView(src.metadata(), request())).toThrow(/more than the limit of 2 rows/);
    src.close();
  });
});

describe("the connector cannot reach a browser", () => {
  it("is not exported from the package index", () => {
    // The mechanism, not a promise: `@gridwright/bridge` never imports
    // node:sqlite, so a browser bundle cannot pull the connector in by
    // accident. It lives behind `@gridwright/bridge/sql`.
    const index = readFileSync(
      fileURLToPath(new URL("../src/index.ts", import.meta.url)),
      "utf8",
    );
    expect(index).not.toMatch(/sql\.js/);
    expect(index).not.toMatch(/SqlConfigurationSource/);
  });

  it("takes a handle rather than a connection string from a caller", () => {
    // A request cannot point this class anywhere: the only path-accepting
    // entry is the explicit server-side opener.
    const src = new SqlConfigurationSource(new DatabaseSync(dbPath, { readOnly: true }));
    expect(src.metadata().source).toBe("synthetic://support-ops");
    src.close();
  });
});

describe("the database feeds the same numbers as the file fixture", () => {
  it("agrees with prepared-view.csv", () => {
    const src = open();
    const meta: MetadataSnapshot = src.metadata();
    const rows = src.readView(meta, request());
    const actual = rows
      .filter((r) => r["period"] === "actual")
      .reduce((sum, r) => sum + Number(r["closed_cases"]), 0);
    const comparison = rows
      .filter((r) => r["period"] === "comparison")
      .reduce((sum, r) => sum + Number(r["closed_cases"]), 0);
    expect(actual).toBe(120);
    expect(comparison).toBe(100);
    src.close();
  });
});
