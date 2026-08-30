export * from "./types.js";
export * from "./compile.js";
export * from "./memory-source.js";
export * from "./csv.js";
export * from "./sql.js";
export * from "./engine.js";
export * from "./join.js";
export * from "./json.js";
export * from "./bundle.js";

import { loadDelimited, typesForTable, verifyColumns } from "./csv.js";
import { loadJson } from "./json.js";
import { MemorySource } from "./memory-source.js";
import type { Manifest } from "@gridwright/schema";
import type { Table } from "./types.js";

/** Text for each table id named in `source.files`. */
export type TableText = Record<string, string>;

/**
 * The one-call path from a manifest plus raw file text to a queryable source.
 * Delimiter follows the declared format, and columns are renamed onto field
 * names so nothing downstream has to know the source layout.
 */
export function sourceFromText(manifest: Manifest, text: TableText): MemorySource {
  const tables: Table[] = manifest.source.files.map((file) => {
    const raw = text[file.id];
    if (raw === undefined) {
      throw new Error(`no data supplied for table "${file.id}" (${file.path})`);
    }
    // Columns keep their source names: with joins in play the plan resolves
    // each field to its own table, so renaming here would only hide which
    // table a column came from.
    const types = typesForTable(manifest, file.id);
    if (file.format === "json") return loadJson(file.id, raw, { types });
    return loadDelimited(file.id, raw, {
      delimiter: file.format === "tsv" ? "\t" : ",",
      types,
    });
  });
  verifyColumns(manifest, tables);
  return MemorySource.fromTables(tables);
}
