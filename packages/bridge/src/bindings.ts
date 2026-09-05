import type { Cell, CellRef, SheetRead, WorkbookRead } from "./xlsx.js";

/**
 * Explicit bindings from skeleton rows to a business-data view, and the
 * validation that has to pass before anything is computed.
 *
 * Two rules from the requirements shape everything here, and both are the
 * opposite of what a convenient implementation would do.
 *
 * **Nothing is matched by label.** R07 says to synchronise by explicit
 * mappings, and a label is not an identity: two queues can be called "Queue A"
 * in different quarters, a heading can be corrected without the underlying row
 * changing, and a report that re-binds itself because someone fixed a typo is
 * not reproducible. Every link in this module is by stable id, and a heading is
 * carried only so a person can read the output.
 *
 * **A conflict is refused, not resolved.** The workbook and the SQL metadata
 * both describe the metric, and which of them wins is decision D01, still open.
 * The architecture note is explicit: do not assume Excel is the master or SQL a
 * mirror; reject conflicting definitions until the source-of-truth rule is
 * agreed. So a grain, unit or additivity disagreement is an error naming both
 * sides — never a silent precedence, and never a warning that computation then
 * ignores. R07 wants those conflicts resolved *before* computation, and the
 * only honest resolution available today is to stop.
 */

// ---------------------------------------------------------------- normalized

export interface MetricDefinition {
  id: string;
  label: string;
  unit: string;
  grain: string;
  additive: boolean;
  aggregation: string;
  /** "unset" is a real answer: direction belongs to approved knowledge. */
  polarity: string;
  /** Where the authoritative definition lives. Unresolvable is recorded, not hidden. */
  definitionRef?: string;
}

export interface ViewColumn {
  name: string;
  type: string;
  role: "key" | "measure";
  unit?: string;
  domain?: string[];
}

export interface ViewDefinition {
  id: string;
  grain: string[];
  columns: ViewColumn[];
  cardinality?: string;
}

export interface MetadataSnapshot {
  source: string;
  capturedAt: string;
  version: string;
  metrics: MetricDefinition[];
  views: ViewDefinition[];
}

export type RowType = "data" | "total";

/** One configured row of the report, as the skeleton fixes it. */
export interface SkeletonRow {
  rowKey: string;
  heading: string;
  rowType: RowType;
  indent: number;
  /** Where in the workbook this row came from. */
  ref: CellRef;
}

export interface RowBinding {
  rowKey: string;
  kind: RowType;
  /** The view's own key for this row. Absent on a total. */
  viewKey?: string;
  /** Which row keys a total spans. Absent on a data row. */
  over?: string[];
}

export interface BindingSpec {
  workbook: string;
  skeletonSheet: string;
  keyColumn: string;
  view: string;
  metric: string;
  grain: string;
  unit: string;
  rows: RowBinding[];
  periods: Record<string, string>;
}

// ------------------------------------------------------------------ problems

export type ProblemCode =
  | "skeleton-unreadable"
  | "metric-unknown"
  | "view-unknown"
  | "grain-conflict"
  | "unit-conflict"
  | "additive-conflict"
  | "duplicate-row"
  | "duplicate-view-key"
  | "unbound-row"
  | "unknown-row"
  | "total-over-unknown"
  | "total-not-additive"
  | "view-missing-column"
  | "cardinality-unusable";

export interface Problem {
  code: ProblemCode;
  message: string;
  /** The workbook cell responsible, when there is one. */
  at?: CellRef;
}

export interface BoundRow {
  rowKey: string;
  heading: string;
  rowType: RowType;
  indent: number;
  viewKey?: string;
  over?: string[];
  /** Both ends of the link, so a later diagnostic can name either. */
  provenance: { skeleton: CellRef; boundBy: string };
}

export interface BindingResolution {
  metric: MetricDefinition;
  view: ViewDefinition;
  rows: BoundRow[];
  /** Which metadata snapshot this resolution was made against. */
  snapshot: { source: string; capturedAt: string; version: string };
  periods: Record<string, string>;
  diagnostics: string[];
}

export type BindingOutcome =
  | { ok: true; resolution: BindingResolution }
  | { ok: false; problems: Problem[] };

// ----------------------------------------------------------------- skeleton

const text = (c: Cell | undefined): string =>
  c && c.value !== null && c.kind !== "error" ? String(c.value) : "";

/**
 * Turns the skeleton sheet into rows, from the header row down.
 *
 * The header is found by name rather than by a fixed offset: a configuration
 * author who inserts a title line above the table has not broken their report,
 * and a bridge that reads row 5 because it always read row 5 will bind the
 * wrong things without saying so.
 */
export function readSkeleton(sheet: SheetRead, keyColumn: string): SkeletonRow[] | Problem {
  const headerIndex = sheet.rows.findIndex((row) => row.some((c) => text(c) === keyColumn));
  if (headerIndex === -1) {
    return {
      code: "skeleton-unreadable",
      message: `sheet "${sheet.name}" has no header cell named "${keyColumn}"`,
    };
  }

  const header = sheet.rows[headerIndex]!;
  const columnOf = (name: string): number => header.findIndex((c) => text(c) === name);

  const keyAt = columnOf(keyColumn);
  const headingAt = columnOf("Heading");
  const typeAt = columnOf("RowType");
  const indentAt = columnOf("Indent");

  if (headingAt === -1 || typeAt === -1) {
    return {
      code: "skeleton-unreadable",
      message: `sheet "${sheet.name}" is missing a "Heading" or "RowType" column`,
      at: header[keyAt]?.ref,
    };
  }

  const rows: SkeletonRow[] = [];
  for (const row of sheet.rows.slice(headerIndex + 1)) {
    const key = text(row[keyAt]);
    // A blank key ends the table. Trailing notes below a configuration table
    // are ordinary, and reading them as rows would invent bindings.
    if (!key) continue;

    const rowType = text(row[typeAt]) === "total" ? "total" : "data";
    const indentCell = indentAt === -1 ? undefined : row[indentAt];
    rows.push({
      rowKey: key,
      heading: text(row[headingAt]),
      rowType,
      indent: typeof indentCell?.value === "number" ? indentCell.value : 0,
      ref: row[keyAt]!.ref,
    });
  }
  return rows;
}

/** Key/Value configuration rows as a map, each keeping its cell. */
export function readConfigTable(sheet: SheetRead): Map<string, { value: Cell; ref: CellRef }> {
  const out = new Map<string, { value: Cell; ref: CellRef }>();
  for (const row of sheet.rows) {
    const key = text(row[0]);
    const value = row[1];
    if (!key || !value) continue;
    out.set(key, { value, ref: row[0]!.ref });
  }
  return out;
}

// ---------------------------------------------------------------- resolution

/**
 * Validates the bindings and returns a resolution, or every problem found.
 *
 * All problems are collected rather than thrown one at a time: a configuration
 * author fixing six mistakes over six runs is a worse experience than seeing
 * six messages once, and the checks are independent enough to keep going.
 */
export function resolveBindings(
  workbook: WorkbookRead,
  metadata: MetadataSnapshot,
  spec: BindingSpec,
): BindingOutcome {
  const problems: Problem[] = [];
  const diagnostics: string[] = [];

  const sheet = workbook.sheets.find((s) => s.name === spec.skeletonSheet);
  if (!sheet) {
    return {
      ok: false,
      problems: [
        {
          code: "skeleton-unreadable",
          message: `workbook "${workbook.workbook}" has no sheet named "${spec.skeletonSheet}"`,
        },
      ],
    };
  }

  const skeletonOrProblem = readSkeleton(sheet, spec.keyColumn);
  if (!Array.isArray(skeletonOrProblem)) return { ok: false, problems: [skeletonOrProblem] };
  const skeleton = skeletonOrProblem;

  // --- the metric and the view exist, by id ---------------------------------
  const metric = metadata.metrics.find((m) => m.id === spec.metric);
  const view = metadata.views.find((v) => v.id === spec.view);

  if (!metric) {
    problems.push({
      code: "metric-unknown",
      message: `bindings name metric "${spec.metric}", which the metadata snapshot does not define`,
    });
  }
  if (!view) {
    problems.push({
      code: "view-unknown",
      message: `bindings name view "${spec.view}", which the metadata snapshot does not define`,
    });
  }
  if (!metric || !view) return { ok: false, problems };

  if (!metric.definitionRef || metric.definitionRef.endsWith("unavailable")) {
    // R07 wants definitions traceable to approved knowledge. None is wired
    // yet; saying so beats implying one exists.
    diagnostics.push(
      `metric "${metric.id}" has no resolvable approved definition (${metric.definitionRef ?? "none"}); traceability is not established`,
    );
  }

  // --- the workbook and the metadata agree, or nothing proceeds -------------
  const configSheet = workbook.sheets.find((s) => s.name === "Config");
  if (configSheet) {
    const config = readConfigTable(configSheet);

    const conflict = (
      key: string,
      fromMetadata: string | boolean,
      code: ProblemCode,
    ): void => {
      const entry = config.get(key);
      if (!entry) return;
      const fromWorkbook = entry.value.value;
      if (fromWorkbook === null) return;
      if (String(fromWorkbook) !== String(fromMetadata)) {
        problems.push({
          code,
          message:
            `${key} disagrees: the workbook says ${JSON.stringify(fromWorkbook)}, ` +
            `the metadata snapshot says ${JSON.stringify(fromMetadata)}. ` +
            `Which source is authoritative is decision D01 and still open, so this is refused rather than resolved.`,
          at: entry.value.ref,
        });
      }
    };

    conflict("grain", metric.grain, "grain-conflict");
    conflict("unit", metric.unit, "unit-conflict");
    conflict("additive", metric.additive, "additive-conflict");
  }

  // --- the bindings agree with the metric ----------------------------------
  if (spec.grain !== metric.grain) {
    problems.push({
      code: "grain-conflict",
      message: `bindings declare grain "${spec.grain}"; metric "${metric.id}" is defined at grain "${metric.grain}"`,
    });
  }
  if (spec.unit !== metric.unit) {
    problems.push({
      code: "unit-conflict",
      message: `bindings declare unit "${spec.unit}"; metric "${metric.id}" is defined in "${metric.unit}"`,
    });
  }

  // --- the view can actually answer at this grain --------------------------
  const measureColumn = view.columns.find((c) => c.name === metric.id && c.role === "measure");
  if (!measureColumn) {
    problems.push({
      code: "view-missing-column",
      message: `view "${view.id}" has no measure column named "${metric.id}"`,
    });
  } else if (measureColumn.unit && measureColumn.unit !== metric.unit) {
    problems.push({
      code: "unit-conflict",
      message: `view "${view.id}" reports "${metric.id}" in "${measureColumn.unit}"; the metric is defined in "${metric.unit}"`,
    });
  }

  const keyColumns = view.columns.filter((c) => c.role === "key").map((c) => c.name);
  // The view has to be keyed at least by the binding's grain, or a row cannot
  // be identified in it at all.
  const grainKey = keyColumns.find((k) => k === `${spec.grain}_key` || k === spec.grain);
  if (!grainKey) {
    problems.push({
      code: "cardinality-unusable",
      message:
        `view "${view.id}" is keyed by [${keyColumns.join(", ")}], which does not identify a row at grain "${spec.grain}"`,
    });
  }
  if (view.grain.length > 0 && !view.grain.every((g) => keyColumns.includes(g))) {
    problems.push({
      code: "cardinality-unusable",
      message: `view "${view.id}" declares grain [${view.grain.join(", ")}] but does not key every part of it`,
    });
  }

  // --- the bindings themselves ---------------------------------------------
  const bySkeletonKey = new Map(skeleton.map((r) => [r.rowKey, r]));
  const seenRowKeys = new Set<string>();
  const viewKeyOwners = new Map<string, string>();
  const bound: BoundRow[] = [];

  for (const binding of spec.rows) {
    if (seenRowKeys.has(binding.rowKey)) {
      problems.push({
        code: "duplicate-row",
        message: `row "${binding.rowKey}" is bound more than once`,
        at: bySkeletonKey.get(binding.rowKey)?.ref,
      });
      continue;
    }
    seenRowKeys.add(binding.rowKey);

    const row = bySkeletonKey.get(binding.rowKey);
    if (!row) {
      problems.push({
        code: "unknown-row",
        message: `bindings name row "${binding.rowKey}", which the skeleton does not contain`,
      });
      continue;
    }

    if (binding.kind === "total") {
      if (!metric.additive) {
        // R08: a non-additive metric does not become summable because a row is
        // labelled Total.
        problems.push({
          code: "total-not-additive",
          message: `row "${binding.rowKey}" totals metric "${metric.id}", which is declared non-additive`,
          at: row.ref,
        });
      }
      for (const over of binding.over ?? []) {
        if (!bySkeletonKey.has(over)) {
          problems.push({
            code: "total-over-unknown",
            message: `total "${binding.rowKey}" spans row "${over}", which the skeleton does not contain`,
            at: row.ref,
          });
        }
      }
      bound.push({
        rowKey: row.rowKey,
        heading: row.heading,
        rowType: row.rowType,
        indent: row.indent,
        over: binding.over ?? [],
        provenance: { skeleton: row.ref, boundBy: "configured total" },
      });
      continue;
    }

    const viewKey = binding.viewKey;
    if (!viewKey) {
      problems.push({
        code: "unbound-row",
        message: `data row "${binding.rowKey}" has no view key`,
        at: row.ref,
      });
      continue;
    }
    const owner = viewKeyOwners.get(viewKey);
    if (owner !== undefined) {
      // Two report rows reading the same view row double-counts into any total
      // over both, and the total is the number people quote.
      problems.push({
        code: "duplicate-view-key",
        message: `rows "${owner}" and "${binding.rowKey}" both bind view key "${viewKey}"`,
        at: row.ref,
      });
      continue;
    }
    viewKeyOwners.set(viewKey, binding.rowKey);

    bound.push({
      rowKey: row.rowKey,
      heading: row.heading,
      rowType: row.rowType,
      indent: row.indent,
      viewKey,
      provenance: { skeleton: row.ref, boundBy: `${view.id}.${grainKey ?? "?"}=${viewKey}` },
    });
  }

  // Every configured row needs a binding. R14 keeps the skeleton whatever the
  // data does, which only holds if the bridge knows about every row.
  for (const row of skeleton) {
    if (!seenRowKeys.has(row.rowKey)) {
      problems.push({
        code: "unbound-row",
        message: `skeleton row "${row.rowKey}" has no binding`,
        at: row.ref,
      });
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  // Bound rows come back in the skeleton's order, not the bindings file's:
  // the skeleton fixes the report's shape (R14), and a reordered bindings file
  // is not a reordered report.
  const order = new Map(skeleton.map((r, i) => [r.rowKey, i]));
  bound.sort((a, b) => (order.get(a.rowKey) ?? 0) - (order.get(b.rowKey) ?? 0));

  return {
    ok: true,
    resolution: {
      metric,
      view,
      rows: bound,
      snapshot: {
        source: metadata.source,
        capturedAt: metadata.capturedAt,
        version: metadata.version,
      },
      periods: spec.periods,
      diagnostics,
    },
  };
}
