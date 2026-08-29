import type { FieldType, Manifest } from "@gridwright/schema";
import type { Table, Value } from "./types.js";
import { EngineError } from "./types.js";

/**
 * A small RFC 4180 reader. Deliberately not a dependency: the format is tiny,
 * and owning it means an unterminated quote produces a Gridwright error with a
 * line number rather than whatever a third party decided to throw.
 */
export function parseDelimited(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  let line = 1;

  // A UTF-8 BOM ahead of the header would otherwise become part of column one.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < text.length) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      if (c === "\n") line++;
      field += c; i++; continue;
    }
    if (c === '"' && field === "") { quoted = true; i++; continue; }
    if (c === delimiter) { endField(); i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { endRow(); line++; i++; continue; }
    field += c; i++;
  }
  if (quoted) throw new EngineError(`unterminated quoted field starting near line ${line}`);
  if (field !== "" || row.length) endRow();

  return rows.filter((r) => r.length > 1 || (r[0] ?? "") !== "");
}

export function coerce(raw: string, type: FieldType): Value {
  const v = raw.trim();
  if (v === "") return null;
  switch (type) {
    case "number": {
      // Tolerate thousands separators and a leading currency symbol.
      const n = Number(v.replace(/[,\s$£€]/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    case "boolean": {
      const l = v.toLowerCase();
      if (["true", "1", "yes", "y", "t"].includes(l)) return true;
      if (["false", "0", "no", "n", "f"].includes(l)) return false;
      return null;
    }
    case "date": {
      // Dates travel as ISO day strings so grouping, sorting and comparison
      // all agree without a Date object in the hot path.
      const ms = Date.parse(v);
      if (Number.isNaN(ms)) return null;
      return new Date(ms).toISOString().slice(0, 10);
    }
    default:
      return v;
  }
}

export interface LoadOptions {
  delimiter?: string;
  /** Column name -> declared type. Anything absent is loaded as a string. */
  types?: Record<string, FieldType>;
}

/** Parses delimited text into a columnar table, coercing by declared type. */
export function loadDelimited(name: string, text: string, o: LoadOptions = {}): Table {
  const rows = parseDelimited(text, o.delimiter ?? ",");
  const header = rows[0];
  if (!header || !header.length) throw new EngineError(`"${name}" has no header row`);

  const seen = new Set<string>();
  for (const h of header) {
    const key = h.trim();
    if (seen.has(key)) throw new EngineError(`"${name}" has a duplicate column "${key}"`);
    seen.add(key);
  }

  const names = header.map((h) => h.trim());
  const body = rows.slice(1);
  const columns: Record<string, Value[]> = Object.create(null);

  names.forEach((col, ci) => {
    const type = o.types?.[col] ?? "string";
    const out: Value[] = new Array(body.length);
    for (let r = 0; r < body.length; r++) out[r] = coerce(body[r]![ci] ?? "", type);
    columns[col] = out;
  });

  return { name, columns, rowCount: body.length };
}

/** Column types a manifest declares for one table, keyed by source column name. */
export function typesForTable(manifest: Manifest, table: string): Record<string, FieldType> {
  const types: Record<string, FieldType> = Object.create(null);
  for (const f of manifest.model.fields) {
    const [t, column] = f.from.split(".");
    if (t === table && column) types[column] = f.type;
  }
  return types;
}

/**
 * A manifest names fields by their own alias (`amount`), while the table holds
 * source column names (`amount` too, usually — but not always). This renames
 * source columns onto field names so the executor only ever sees field names.
 */
export function projectFields(manifest: Manifest, table: Table): Table {
  const columns: Record<string, Value[]> = Object.create(null);
  for (const f of manifest.model.fields) {
    const [t, column] = f.from.split(".");
    if (t !== table.name || !column) continue;
    const source = table.columns[column];
    if (!source) {
      throw new EngineError(
        `field "${f.name}" reads ${f.from} but "${table.name}" has no column "${column}"`,
        `available: ${Object.keys(table.columns).join(", ")}`,
      );
    }
    columns[f.name] = source;
  }
  return { name: table.name, columns, rowCount: table.rowCount };
}
