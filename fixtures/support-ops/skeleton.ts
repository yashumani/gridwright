// Imported with an explicit .ts extension: these fixture files are run by
// `node --experimental-strip-types` and are outside every tsconfig, so there is
// no build step to rewrite a ".js" specifier into the file that actually exists.
import type { CellValue, SheetSpec } from "../../packages/bridge/test/support/write-xlsx.ts";

/**
 * The synthetic support-operations skeleton, as data.
 *
 * The workbook is generated from this rather than committed only as bytes, so
 * a reviewer can see what is in it without opening Excel and a diff shows what
 * changed. `skeleton.xlsx` is built from exactly these rows.
 *
 * Two sheets, because the requirement separates them: a *skeleton* that fixes
 * the shape of the report, and a *configuration* table that names the metric
 * and its rules. R10 reads both as configuration; neither is data.
 */

/**
 * Sheet 1 — the report skeleton.
 *
 * Row order, headings and the Total row are the deliverable. R14: every one of
 * these survives to the rendered report whatever the query returns, which is
 * why Queue C is here at all.
 */
export const SKELETON_ROWS: CellValue[][] = [
  ["Report", "Closed cases by queue"],
  ["Version", "0.1"],
  [],
  ["RowKey", "Heading", "RowType", "Indent"],
  ["queue_a", "Queue A", "data", 1],
  ["queue_b", "Queue B", "data", 1],
  // Configured, and the view returns nothing for it. Present in the output or
  // the bridge has failed.
  ["queue_c", "Queue C", "data", 1],
  ["total", "Total", "total", 0],
];

/**
 * Sheet 2 — the metric configuration.
 *
 * `Additive` is declared, not inferred. R08 forbids a metric inheriting sum
 * behaviour because a chart could display it, and the only way to honour that
 * is for the configuration to say so and the bridge to refuse to guess.
 *
 * `Polarity` is `unset` on purpose. The fixture computes +20; whether +20 is
 * good belongs to an approved metric definition this fixture does not have.
 */
export const CONFIG_ROWS: CellValue[][] = [
  ["Key", "Value", "Note"],
  ["metric_id", "closed_cases", "Matches sql-metadata.json"],
  ["metric_label", "Closed cases", ""],
  ["grain", "queue", "One row per queue"],
  ["unit", "cases", "Counts, not currency"],
  ["additive", true, "Declared, never inferred"],
  ["polarity", "unset", "Direction is not this fixture's to assert"],
  ["comparison", "prior_period", ""],
  ["blank_policy", "not_available", "A missing row is not a zero"],
];

export const SHEETS: SheetSpec[] = [
  { name: "Skeleton", rows: SKELETON_ROWS },
  { name: "Config", rows: CONFIG_ROWS },
];

/** Where the skeleton's own header row sits, 1-based, for binding by address. */
export const SKELETON_HEADER_ROW = 4;
