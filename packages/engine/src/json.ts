import type { FieldType } from "@gridwright/schema";
import type { Table, Value } from "./types.js";
import { EngineError } from "./types.js";
import { coerce, type LoadOptions } from "./csv.js";

/**
 * JSON loading, for the shape every "export as JSON" button produces: a
 * top-level array of row objects.
 *
 * The first object fixes the column set, exactly as a CSV's first line does.
 * A later row may omit a column — that cell reads null — and a key the first
 * row did not declare is ignored, so one stray record cannot silently widen
 * the table underneath the manifest.
 *
 * There is deliberately no streaming path here. JSON is not resumable at an
 * arbitrary byte the way delimited text is, so the whole document has to be
 * held as one string before parsing starts — which is exactly the ceiling the
 * CSV parser exists to avoid. JSON is for the convenient extract; a
 * ten-million-row one still belongs in CSV.
 */

/**
 * One cell. A JSON primitive that already matches the declared type is taken
 * as it stands; anything else goes through the same coercion the delimited
 * loader uses, so the two agree on what "" and "2024-01-05" and "yes" mean.
 */
function cell(raw: unknown, type: FieldType, table: string, column: string): Value {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") return coerce(raw, type);
  if (typeof raw === "number") return type === "number" ? raw : coerce(String(raw), type);
  if (typeof raw === "boolean") return type === "boolean" ? raw : coerce(String(raw), type);
  throw new EngineError(
    `"${table}" has a non-scalar value in column "${column}"`,
    "A table cell holds a string, number, boolean or null — flatten nested objects and arrays before loading.",
  );
}

/** Parses a JSON array of row objects into a columnar table. */
export function loadJson(name: string, text: string, o: LoadOptions = {}): Table {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new EngineError(`"${name}" is not valid JSON`, (err as Error).message);
  }

  if (!Array.isArray(parsed)) {
    throw new EngineError(
      `"${name}" must be a JSON array of row objects`,
      `Found ${parsed === null ? "null" : typeof parsed}, expected [{ "column": value, … }, …].`,
    );
  }
  if (o.maxRows !== undefined && parsed.length > o.maxRows) {
    throw new EngineError(
      `"${name}" has more than ${o.maxRows} rows`,
      "Raise the limit, or pre-aggregate the extract before loading it.",
    );
  }

  const isRow = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  const first = parsed[0];
  if (!isRow(first)) {
    throw new EngineError(
      `"${name}" has no rows to take its columns from`,
      parsed.length
        ? "Its first element is not an object, so there are no column names to read."
        : "An empty array declares no columns.",
    );
  }

  const names = Object.keys(first);
  if (!names.length) throw new EngineError(`"${name}" has no columns`);

  const types = names.map((h) => o.types?.[h] ?? "string");
  const columns: Value[][] = names.map(() => new Array(parsed.length));

  for (let r = 0; r < parsed.length; r++) {
    const row = parsed[r];
    if (!isRow(row)) {
      throw new EngineError(
        `"${name}" has a non-object at index ${r}`,
        "Every element of the array is one row, written as an object.",
      );
    }
    for (let c = 0; c < names.length; c++) {
      // Own properties only: a row carrying "__proto__" or "constructor" as a
      // column name must not reach through to Object.prototype.
      const key = names[c]!;
      columns[c]![r] = Object.hasOwn(row, key) ? cell(row[key], types[c]!, name, key) : null;
    }
  }

  const out: Record<string, Value[]> = Object.create(null);
  names.forEach((h, c) => { out[h] = columns[c]!; });
  return { name, columns: out, rowCount: parsed.length };
}

/** Loads a JSON Blob or File. Held whole — see the note at the top of this file. */
export async function loadJsonBlob(name: string, blob: Blob, o: LoadOptions = {}): Promise<Table> {
  return loadJson(name, await blob.text(), o);
}
