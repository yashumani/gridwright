import { createRequire } from "node:module";
import type { MetadataSnapshot, ViewDefinition } from "./bindings.js";
import type { ViewRow } from "./fill.js";

/**
 * `node:sqlite` is loaded at call time rather than imported at the top.
 *
 * Two reasons, one practical and one architectural. Vite's list of Node
 * builtins predates `node:sqlite`, so a static import gets its prefix stripped
 * and the bundler hunts for a package called "sqlite" that does not exist.
 * And an adapter nobody has configured should not make merely importing this
 * module fail — the driver is needed when a connection is opened, not when the
 * types are read.
 */
type SqliteDatabase = {
  prepare(sql: string): { get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
  exec(sql: string): void;
  close(): void;
};

type SqliteModule = {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;
};

let sqlite: SqliteModule | undefined;
function loadSqlite(): SqliteModule {
  if (!sqlite) {
    sqlite = createRequire(import.meta.url)("node:sqlite") as SqliteModule;
  }
  return sqlite;
}

/**
 * A read-only connector for SQL configuration metadata and prepared views.
 *
 * **This module is deliberately not reachable from the package index.** It is
 * exported as `@gridwright/bridge/sql` and loads `node:sqlite`, so a browser
 * bundle that imports `@gridwright/bridge` cannot pull it in even by accident —
 * which is how "no browser credentials" is enforced rather than promised. A
 * connection is opened by server-side code from a handle it already holds; no
 * connection string, path or credential is ever accepted from a request.
 *
 * Two safety properties do the real work, and they are different in kind.
 *
 * **Values are parameters.** Row keys and period names come from configuration
 * and, in a running system, ultimately from a user's scope. They are bound, so
 * a key containing `'; DROP TABLE …` is a key that matches nothing rather than
 * a statement.
 *
 * **Identifiers are allowlisted.** SQL cannot parameterise a table or column
 * name, so the only safe source for one is a catalogue this code already
 * trusts. Every identifier used here is looked up in the approved metadata
 * snapshot and re-checked against a strict pattern before it reaches a query.
 * A caller cannot name a view or column the snapshot does not define, which is
 * the difference between an allowlist and an escape function.
 *
 * The connection is opened read-only, and every statement is checked to be a
 * single SELECT. Belt and braces on purpose: the open mode is the guarantee,
 * and the check is what catches a change to this file that quietly loses it.
 */

/** A plain identifier. Anything else — quotes, spaces, dots — is refused. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface SqlLimits {
  /** Most rows a single read may return. */
  maxRows: number;
  /** Most keys a single read may ask for. */
  maxKeys: number;
}

export const DEFAULT_SQL_LIMITS: SqlLimits = { maxRows: 100_000, maxKeys: 1_000 };

export class SqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqlError";
  }
}

function requireIdentifier(name: string, what: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new SqlError(`${what} "${name}" is not a plain identifier`);
  }
  return name;
}

/** Refuses anything that is not one read. */
function requireSingleSelect(sql: string): void {
  const trimmed = sql.trim();
  if (!/^select\s/i.test(trimmed)) {
    throw new SqlError("only SELECT statements may be run through this connector");
  }
  // A trailing semicolon is fine; a second statement after one is not.
  if (/;\s*\S/.test(trimmed)) {
    throw new SqlError("only one statement may be run through this connector");
  }
}

export interface ReadViewRequest {
  /** Must name a view the metadata snapshot defines. */
  view: string;
  /** Column holding the row key, e.g. `queue_key`. */
  keyColumn: string;
  /** Column holding the period, e.g. `period`. */
  periodColumn: string;
  /** Measure column to read. */
  measureColumn: string;
  /** Row keys wanted. Bound as parameters. */
  keys: readonly string[];
  /** Period values wanted. Bound as parameters. */
  periods: readonly string[];
}

/**
 * Reads configuration metadata and prepared views from an already-open,
 * read-only database handle.
 */
export class SqlConfigurationSource {
  private readonly db: SqliteDatabase;
  private readonly limits: SqlLimits;

  /**
   * `db` is supplied by server-side code that opened it. Taking a handle rather
   * than a path or a connection string means this class has no way to be
   * pointed somewhere by a request.
   */
  constructor(db: SqliteDatabase, limits: SqlLimits = DEFAULT_SQL_LIMITS) {
    this.db = db;
    this.limits = limits;
  }

  /** Opens a database file read-only. The only place a path is accepted. */
  static openReadOnly(path: string, limits: SqlLimits = DEFAULT_SQL_LIMITS): SqlConfigurationSource {
    const { DatabaseSync } = loadSqlite();
    return new SqlConfigurationSource(new DatabaseSync(path, { readOnly: true }), limits);
  }

  /**
   * Reads the configuration metadata snapshot.
   *
   * The metadata lives in the database as JSON in a single-row table, so the
   * snapshot the bridge validates against is the one the source published —
   * not a copy that has to be kept in step by hand.
   */
  metadata(table = "bridge_metadata", column = "document"): MetadataSnapshot {
    requireIdentifier(table, "metadata table");
    requireIdentifier(column, "metadata column");

    const sql = `SELECT ${column} AS document FROM ${table} LIMIT 1`;
    requireSingleSelect(sql);

    const row = this.db.prepare(sql).get() as { document?: string } | undefined;
    if (!row?.document) throw new SqlError(`no configuration metadata in ${table}`);

    const parsed = JSON.parse(row.document) as {
      snapshot: { source: string; capturedAt: string; version: string };
      metrics: MetadataSnapshot["metrics"];
      views: MetadataSnapshot["views"];
    };
    return { ...parsed.snapshot, metrics: parsed.metrics, views: parsed.views };
  }

  /**
   * Reads a prepared view, bounded and parameterised.
   *
   * Every identifier is checked against `snapshot` first: the view must be one
   * it defines, and each column must be one that view declares. A caller
   * cannot reach a table the catalogue does not know about.
   */
  readView(snapshot: MetadataSnapshot, request: ReadViewRequest): ViewRow[] {
    const view = snapshot.views.find((v) => v.id === request.view);
    if (!view) {
      throw new SqlError(`view "${request.view}" is not defined by the metadata snapshot`);
    }
    if (request.keys.length > this.limits.maxKeys) {
      throw new SqlError(
        `asked for ${request.keys.length} keys, over the limit of ${this.limits.maxKeys}`,
      );
    }
    if (request.keys.length === 0 || request.periods.length === 0) return [];

    const column = (name: string): string => {
      requireIdentifier(name, "column");
      if (!view.columns.some((c) => c.name === name)) {
        throw new SqlError(`view "${view.id}" does not declare a column "${name}"`);
      }
      return name;
    };

    const table = requireIdentifier(view.id, "view");
    const key = column(request.keyColumn);
    const period = column(request.periodColumn);
    const measure = column(request.measureColumn);

    // Placeholders are generated from the *counts*, never from the values.
    const keyMarks = request.keys.map(() => "?").join(", ");
    const periodMarks = request.periods.map(() => "?").join(", ");

    // One more than the limit, so exceeding it is detectable rather than
    // silently truncated into a wrong total.
    const sql =
      `SELECT ${key}, ${period}, ${measure} FROM ${table} ` +
      `WHERE ${key} IN (${keyMarks}) AND ${period} IN (${periodMarks}) ` +
      `LIMIT ${this.limits.maxRows + 1}`;
    requireSingleSelect(sql);

    const rows = this.db
      .prepare(sql)
      .all(...request.keys, ...request.periods) as ViewRow[];

    if (rows.length > this.limits.maxRows) {
      throw new SqlError(
        `view "${view.id}" returned more than the limit of ${this.limits.maxRows} rows`,
      );
    }
    return rows.map((r) => ({ ...r }));
  }

  close(): void {
    this.db.close();
  }
}

/** Re-exported so a caller can name the type without importing node:sqlite. */
export type { ViewDefinition };
export type { SqliteDatabase };
