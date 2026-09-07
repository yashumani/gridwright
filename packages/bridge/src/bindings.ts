import { describeFinding, scanText, type Finding } from "@gridwright/contracts";
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

/**
 * Additive, semi-additive, non-additive.
 *
 * `semi_additive` is the one worth naming: additive across dimensions, not
 * across time. A queue backlog totals correctly across queues within a period
 * and is meaningless summed across periods.
 */
export const ADDITIVITY = ["additive", "semi_additive", "non_additive"] as const;
export type Additivity = (typeof ADDITIVITY)[number];

/**
 * Reads an additivity from a workbook cell or a metadata field.
 *
 * A boolean is the older spelling and still means what it meant. Anything the
 * vocabulary does not contain returns `undefined` and is refused by the caller
 * rather than defaulting — defaulting an unknown additivity to `additive` is
 * the exact failure this type exists to prevent.
 */
export function readAdditivity(value: unknown): Additivity | undefined {
  if (value === true) return "additive";
  if (value === false) return "non_additive";
  if (typeof value !== "string") return undefined;
  const normalised = value.trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (normalised === "true") return "additive";
  if (normalised === "false") return "non_additive";
  return (ADDITIVITY as readonly string[]).includes(normalised)
    ? (normalised as Additivity)
    : undefined;
}

/**
 * A metric as a snapshot may still spell it, before normalisation.
 *
 * `additive: true` was the only spelling until the three-valued vocabulary
 * arrived. Snapshots written against the old one keep working, because
 * refusing them would make a vocabulary change into a migration nobody asked
 * for — and because a boolean genuinely does mean one of the three.
 */
export interface RawMetricDefinition extends Omit<MetricDefinition, "additivity"> {
  additivity?: unknown;
  /** The older spelling. `true` reads as additive, `false` as non-additive. */
  additive?: unknown;
}

/**
 * Normalises a metric's additivity from whichever field the snapshot used.
 *
 * Returns the problem rather than a default when neither field is readable.
 * Defaulting an unknown additivity to `additive` is precisely the failure the
 * three-valued type exists to prevent.
 */
export function normaliseMetric(
  raw: RawMetricDefinition,
): { ok: true; metric: MetricDefinition } | { ok: false; problem: Problem } {
  const additivity = readAdditivity(raw.additivity ?? raw.additive);
  if (additivity === undefined) {
    return {
      ok: false,
      problem: {
        code: "additive-conflict",
        message:
          `metric "${raw.id}" declares additivity ${JSON.stringify(raw.additivity ?? raw.additive)}, ` +
          `which is not one of ${ADDITIVITY.join(", ")} (or TRUE/FALSE)`,
      },
    };
  }
  const { additive: _legacy, ...rest } = raw;
  return { ok: true, metric: { ...(rest as Omit<MetricDefinition, "additivity">), additivity } };
}

export interface MetricDefinition {
  id: string;
  label: string;
  unit: string;
  grain: string;
  /**
   * How the metric behaves under aggregation.
   *
   * Three values, not two, because a boolean cannot say the thing that is
   * actually true of a backlog: it adds across queues and it does not add
   * across time. Reconciling with Talk2Data's registry — whose `additivity` has
   * had three values all along — is what surfaced that; a boolean forced
   * `SEMI_ADDITIVE` to round to one of the wrong answers, and rounding it *up*
   * lets a year-to-date total be the sum of twelve month-end readings.
   *
   * A workbook may still declare `TRUE` or `FALSE`, which read as `additive`
   * and `non_additive`. Saying `semi_additive` needs the word.
   */
  additivity: Additivity;
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
  /**
   * Metrics as the snapshot holds them, before normalisation.
   *
   * Typed loosely on purpose: a snapshot published against the older
   * `additive: true` spelling is still a valid snapshot, and `resolveBindings`
   * normalises it. Requiring the new field here would make a vocabulary change
   * into a migration every publisher has to do first.
   */
  metrics: RawMetricDefinition[];
  views: ViewDefinition[];
}

export type RowType = "data" | "total";

/** One configured row of the report, as the skeleton fixes it. */
export interface SkeletonRow {
  rowKey: string;
  heading: string;
  rowType: RowType;
  indent: number;
  /** Where in the workbook this row came from — the key cell. */
  ref: CellRef;
  /**
   * The heading's own cell.
   *
   * Separate from `ref` because a diagnostic about the heading has to name the
   * cell somebody opens to fix it. Pointing at the key cell one column over is
   * the kind of small wrongness that makes a warning worth ignoring.
   */
  headingRef: CellRef;
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
  /**
   * The view column that orders rows within a key and period.
   *
   * Only needed by an aggregation that has to know which row is last, such as
   * `period_end`. Declared here rather than guessed, because a prepared view
   * arrives in whatever order the query returned and "the last one" from an
   * unordered set is an arbitrary one.
   */
  orderColumn?: string;
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
  /** The ordering column, when the bindings declared one. */
  orderColumn?: string;
  diagnostics: string[];
  /**
   * Configuration text that looks like an instruction rather than a label
   * (R24). Empty in the ordinary case. Carried as structure as well as prose
   * so a caller can act on the kind and confidence rather than parse a
   * sentence — a model-facing caller drops the value, a renderer draws it.
   */
  untrusted: Finding[];
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
      headingRef: row[headingAt]?.ref ?? row[keyAt]!.ref,
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

/**
 * Configuration text, checked for text that is trying to be read as an
 * instruction rather than a label (R24).
 *
 * Every string here came out of a workbook or a metadata snapshot, which are
 * files somebody else can write. Today they are only ever drawn on a screen,
 * so an imperative in a heading is odd rather than dangerous — but a metric
 * label is exactly the sort of thing a later answer quotes, and by then the
 * flag has to already exist.
 *
 * It is a **diagnostic, not a refusal.** A queue legitimately named "Ignore"
 * must not break a report, and R14 is explicit that configured structure
 * survives whatever anything else says. A caller about to put this text in
 * front of a model reads the diagnostics and decides; a renderer draws the
 * label either way.
 *
 * The limits differ by field because the shape of the value is itself a
 * signal: a heading is a few words, a note is a sentence or two, and either
 * one arriving as four hundred characters is worth saying out loud.
 */
const TEXT_LIMITS = { heading: 120, value: 200, note: 500 } as const;

function scanConfiguration(
  workbook: WorkbookRead,
  metadata: MetadataSnapshot,
  skeleton: SkeletonRow[],
  spec: BindingSpec,
): Finding[] {
  const findings: Finding[] = [];
  const where = (ref: CellRef) => `${ref.sheet}!${ref.address}`;

  for (const row of skeleton) {
    findings.push(
      ...scanText(row.heading, where(row.headingRef), { maxLength: TEXT_LIMITS.heading }),
    );
    findings.push(...scanText(row.rowKey, where(row.ref), { maxLength: TEXT_LIMITS.value }));
  }

  // The Config sheet's own cells, including the note column, which is the one
  // place in the workbook where prose is expected and so the easiest to hide in.
  const config = workbook.sheets.find((s) => s.name === "Config");
  if (config) {
    for (const row of config.rows) {
      for (const cell of row) {
        if (!cell || typeof cell.value !== "string") continue;
        findings.push(
          ...scanText(cell.value, where(cell.ref), { maxLength: TEXT_LIMITS.note }),
        );
      }
    }
  }

  // The metadata snapshot is the other authored source, and the side a
  // database administrator rather than a spreadsheet author can write.
  const metric = metadata.metrics.find((m) => m.id === spec.metric);
  if (metric) {
    for (const [key, limit] of [
      ["label", TEXT_LIMITS.heading],
      ["unit", TEXT_LIMITS.value],
      ["grain", TEXT_LIMITS.value],
      ["polarity", TEXT_LIMITS.value],
      ["definitionRef", TEXT_LIMITS.value],
    ] as const) {
      findings.push(
        ...scanText(metric[key], `metadata.metrics[${metric.id}].${key}`, { maxLength: limit }),
      );
    }
  }

  const view = metadata.views.find((v) => v.id === spec.view);
  if (view) {
    findings.push(
      ...scanText(view.id, `metadata.views[${view.id}].id`, { maxLength: TEXT_LIMITS.value }),
    );
    for (const column of view.columns) {
      findings.push(
        ...scanText(column.name, `metadata.views[${view.id}].columns.name`, {
          maxLength: TEXT_LIMITS.value,
        }),
      );
    }
  }

  return findings;
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

  // R24. Before anything reads these values for meaning, note the ones that
  // are asking to be obeyed. `describeFinding` never quotes the matched text,
  // so a diagnostic built from a hostile cell cannot itself carry the payload.
  const untrusted = scanConfiguration(workbook, metadata, skeleton, spec);
  for (const finding of untrusted) diagnostics.push(describeFinding(finding));

  // --- the metric and the view exist, by id ---------------------------------
  const rawMetric = metadata.metrics.find((m) => m.id === spec.metric);
  const view = metadata.views.find((v) => v.id === spec.view);

  if (!rawMetric) {
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
  if (!rawMetric || !view) return { ok: false, problems };

  // Normalised here rather than at every reader: a snapshot may still spell
  // additivity as a boolean, and one place to accept that is one place to fix.
  const normalised = normaliseMetric(rawMetric as RawMetricDefinition);
  if (!normalised.ok) {
    problems.push(normalised.problem);
    return { ok: false, problems };
  }
  const metric = normalised.metric;

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
    // Normalised on both sides before comparing: a workbook saying TRUE and a
    // snapshot saying "additive" agree, and reporting that as a conflict would
    // be this bridge inventing a disagreement out of two spellings.
    const declared = config.get("additive");
    if (declared) {
      const fromWorkbook = readAdditivity(declared.value.value);
      if (fromWorkbook === undefined) {
        problems.push({
          code: "additive-conflict",
          message:
            `the workbook declares additive ${JSON.stringify(declared.value.value)}, which is not ` +
            `one of ${ADDITIVITY.join(", ")} (or TRUE/FALSE)`,
          at: declared.value.ref,
        });
      } else if (fromWorkbook !== metric.additivity) {
        problems.push({
          code: "additive-conflict",
          message:
            `additive disagrees: the workbook says ${JSON.stringify(fromWorkbook)}, ` +
            `the metadata snapshot says ${JSON.stringify(metric.additivity)}. ` +
            `Which source is authoritative is decision D01 and still open, so this is refused rather than resolved.`,
          at: declared.value.ref,
        });
      }
    }
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
      if (metric.additivity === "non_additive") {
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
      ...(spec.orderColumn ? { orderColumn: spec.orderColumn } : {}),
      diagnostics,
      untrusted,
    },
  };
}
