import type { FieldType, Manifest } from "@gridwright/schema";
import type { Table, Value } from "./types.js";
import { EngineError } from "./types.js";

/**
 * Delimited-text loading.
 *
 * The parser is incremental on purpose. A ten-million-row CSV is roughly a
 * gigabyte, and `file.text()` would need the whole thing as one JavaScript
 * string before parsing could even start — which is where a browser tab dies,
 * long before the engine gets a chance to be slow. Feeding chunks through a
 * resumable parser straight into column arrays means the source text is never
 * held whole.
 *
 * Owning the format is also why an unterminated quote produces a Gridwright
 * error with a line number rather than whatever a third party decided to throw.
 */

export type RowSink = (row: string[]) => void;

/**
 * A resumable RFC 4180 reader. `push` may be called with arbitrary chunk
 * boundaries — including one that splits a `""` escape or a `\r\n` pair.
 */
export class DelimitedParser {
  private field = "";
  private row: string[] = [];
  private quoted = false;
  /** Saw a quote while inside a quoted field; the next character decides. */
  private pendingQuote = false;
  /** Saw a CR inside a quoted field; the next character decides if it was CRLF. */
  private pendingCR = false;
  private started = false;
  private line = 1;

  constructor(private readonly delimiter = ",") {}

  push(chunk: string, onRow: RowSink): void {
    let i = 0;
    if (!this.started) {
      this.started = true;
      // A UTF-8 BOM would otherwise become part of column one.
      if (chunk.charCodeAt(0) === 0xfeff) i = 1;
    }
    const delimiter = this.delimiter;
    const len = chunk.length;

    while (i < len) {
      if (this.pendingQuote) {
        const c = chunk[i]!;
        this.pendingQuote = false;
        if (c === '"') { this.field += '"'; i++; continue; }
        this.quoted = false;
        // Fall through: `c` is an ordinary unquoted character this pass.
      }

      if (this.quoted) {
        // Inside quotes, copy in runs up to the next character that matters.
        const start = i;
        while (i < len) {
          const ch = chunk[i]!;
          if (ch === '"' || ch === "\r" || ch === "\n") break;
          i++;
        }
        if (i > start) {
          if (this.pendingCR) { this.field += "\r"; this.pendingCR = false; }
          this.field += chunk.slice(start, i);
        }
        if (i >= len) break;

        const c = chunk[i]!;
        if (this.pendingCR) {
          this.pendingCR = false;
          // CRLF inside a quoted field collapses to LF. Strict RFC 4180 keeps
          // the CR, but then the same logical value exported from Windows and
          // from Unix would group separately — a data bug caused by nothing but
          // the file's origin. A lone CR is still preserved.
          if (c === "\n") { this.field += "\n"; this.line++; i++; continue; }
          this.field += "\r";
        }
        if (c === '"') { this.pendingQuote = true; i++; continue; }
        if (c === "\r") { this.pendingCR = true; i++; continue; }
        this.field += "\n";
        this.line++;
        i++;
        continue;
      }

      // Unquoted: append whole runs rather than one character at a time. On a
      // large file this is most of the parse — a 360 MB CSV is 360 million
      // single-character concatenations otherwise.
      const start = i;
      while (i < len) {
        const ch = chunk[i]!;
        if (ch === delimiter || ch === "\n" || ch === "\r" || ch === '"') break;
        i++;
      }
      if (i > start) this.field += chunk.slice(start, i);
      if (i >= len) break;

      const c = chunk[i]!;
      i++;
      if (c === '"') {
        // A quote only opens a field at its start; elsewhere it is literal.
        if (this.field === "") this.quoted = true;
        else this.field += '"';
        continue;
      }
      if (c === delimiter) { this.row.push(this.field); this.field = ""; continue; }
      if (c === "\r") continue;
      // c === "\n"
      this.row.push(this.field);
      this.field = "";
      this.emit(onRow);
      this.line++;
    }
  }

  /** Flushes a trailing row and reports an unbalanced quote. */
  end(onRow: RowSink): void {
    if (this.pendingCR) { this.field += "\r"; this.pendingCR = false; }
    if (this.quoted && !this.pendingQuote) {
      throw new EngineError(`unterminated quoted field starting near line ${this.line}`);
    }
    if (this.field !== "" || this.row.length) {
      this.row.push(this.field);
      this.field = "";
      this.emit(onRow);
    }
  }

  private emit(onRow: RowSink): void {
    const row = this.row;
    this.row = [];
    // A blank trailing line is not a row.
    if (row.length > 1 || (row[0] ?? "") !== "") onRow(row);
  }
}

/** Whole-string convenience over {@link DelimitedParser}. */
export function parseDelimited(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  const parser = new DelimitedParser(delimiter);
  const sink: RowSink = (r) => rows.push(r);
  parser.push(text, sink);
  parser.end(sink);
  return rows;
}

const CURRENCY_OR_GROUPING = /[,\s$£€]/g;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const TRUE_WORDS = new Set(["true", "1", "yes", "y", "t"]);
const FALSE_WORDS = new Set(["false", "0", "no", "n", "f"]);

export function coerce(raw: string, type: FieldType): Value {
  if (raw === "") return null;
  // Only pay for trim() when there is something to trim.
  const first = raw.charCodeAt(0);
  const last = raw.charCodeAt(raw.length - 1);
  const v = first <= 32 || last <= 32 ? raw.trim() : raw;
  if (v === "") return null;
  switch (type) {
    case "number": {
      // The overwhelmingly common case is a plain number; only fall back to
      // stripping separators and currency symbols when that fails.
      const direct = Number(v);
      if (Number.isFinite(direct)) return direct;
      const n = Number(v.replace(CURRENCY_OR_GROUPING, ""));
      return Number.isFinite(n) ? n : null;
    }
    case "boolean": {
      // The exact spellings first: `[...].includes(x)` would allocate an array
      // for every row, and toLowerCase a string.
      if (v === "true" || v === "false") return v === "true";
      const l = v.toLowerCase();
      if (TRUE_WORDS.has(l)) return true;
      if (FALSE_WORDS.has(l)) return false;
      return null;
    }
    case "date": {
      // Dates travel as ISO day strings so grouping, sorting and comparison
      // all agree without a Date object in the hot path. Most date columns are
      // already in that form, and parsing ten million of them into Date objects
      // just to format them back is the single most expensive thing a load can
      // do — so recognise the shape and pass it straight through.
      if (ISO_DAY.test(v)) return v;
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
  /** Refuse a file with more rows than this, rather than exhausting memory. */
  maxRows?: number;
}

/**
 * Accumulates rows straight into per-column arrays.
 *
 * Collecting rows first and transposing afterwards would hold every cell as a
 * separate string — worse than the source text it replaces.
 */
class TableBuilder {
  private names: string[] = [];
  private columns: Value[][] = [];
  private types: FieldType[] = [];
  private rows = 0;

  constructor(private readonly name: string, private readonly o: LoadOptions) {}

  addRow(row: string[]): void {
    if (!this.names.length) {
      this.names = row.map((h) => h.trim());
      const seen = new Set<string>();
      for (const h of this.names) {
        if (seen.has(h)) throw new EngineError(`"${this.name}" has a duplicate column "${h}"`);
        seen.add(h);
      }
      this.types = this.names.map((h) => this.o.types?.[h] ?? "string");
      this.columns = this.names.map(() => []);
      return;
    }

    this.rows++;
    if (this.o.maxRows !== undefined && this.rows > this.o.maxRows) {
      throw new EngineError(
        `"${this.name}" has more than ${this.o.maxRows} rows`,
        "Raise the limit, or pre-aggregate the extract before loading it.",
      );
    }
    for (let c = 0; c < this.names.length; c++) {
      this.columns[c]!.push(coerce(row[c] ?? "", this.types[c]!));
    }
  }

  finish(): Table {
    if (!this.names.length) throw new EngineError(`"${this.name}" has no header row`);
    const columns: Record<string, Value[]> = Object.create(null);
    this.names.forEach((h, c) => { columns[h] = this.columns[c]!; });
    return { name: this.name, columns, rowCount: this.rows };
  }
}

/** Parses delimited text into a columnar table, coercing by declared type. */
export function loadDelimited(name: string, text: string, o: LoadOptions = {}): Table {
  const builder = new TableBuilder(name, o);
  const parser = new DelimitedParser(o.delimiter ?? ",");
  const sink: RowSink = (r) => builder.addRow(r);
  parser.push(text, sink);
  parser.end(sink);
  return builder.finish();
}

/**
 * Streaming load. The source text is never held whole, so file size is bounded
 * by the parsed columns rather than by the raw bytes.
 */
export async function loadDelimitedStream(
  name: string,
  chunks: AsyncIterable<string>,
  o: LoadOptions = {},
): Promise<Table> {
  const builder = new TableBuilder(name, o);
  const parser = new DelimitedParser(o.delimiter ?? ",");
  const sink: RowSink = (r) => builder.addRow(r);
  for await (const chunk of chunks) parser.push(chunk, sink);
  parser.end(sink);
  return builder.finish();
}

/** Decodes a Blob or File as UTF-8 text chunks without buffering the whole thing. */
export async function* blobChunks(blob: Blob): AsyncGenerator<string> {
  const reader = blob.stream().pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Streams a File or Blob straight into a table. The browser upload path. */
export function loadBlob(name: string, blob: Blob, o: LoadOptions = {}): Promise<Table> {
  return loadDelimitedStream(name, blobChunks(blob), o);
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
 * Checks that every column a manifest claims actually exists in the loaded
 * data, including join keys.
 *
 * Worth doing eagerly: without it the first sign of a typo'd column is a panel
 * that fails at query time, long after the user could connect it to the file
 * they picked.
 */
export function verifyColumns(manifest: Manifest, tables: readonly Table[]): void {
  const byName = new Map(tables.map((t) => [t.name, t]));

  const check = (ref: string, what: string): void => {
    const dot = ref.indexOf(".");
    const table = ref.slice(0, dot);
    const column = ref.slice(dot + 1);
    const t = byName.get(table);
    if (!t) throw new EngineError(`${what} names table "${table}", which was not loaded`);
    if (!(column in t.columns)) {
      throw new EngineError(
        `${what} reads ${ref} but "${table}" has no column "${column}"`,
        `available: ${Object.keys(t.columns).join(", ")}`,
      );
    }
  };

  for (const f of manifest.model.fields) check(f.from, `field "${f.name}"`);
  for (const r of manifest.source.relations ?? []) {
    check(r.left, "relation");
    check(r.right, "relation");
  }
}

/**
 * A manifest names fields by their own alias (`amount`), while the table holds
 * source column names. This renames source columns onto field names.
 *
 * Retained for single-table callers that want a pre-projected table; the
 * executor resolves fields through the plan and does not need it.
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
