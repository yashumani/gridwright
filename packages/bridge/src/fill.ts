import { scanText, type Finding } from "@gridwright/contracts";
import { analyzeExpression, evalPostColumn, type Value } from "@gridwright/expr";
import type { BlankPolicy, DefinitionRow, ReportDefinition } from "./compile.js";

/**
 * Fills a compiled definition from view data, without changing its shape.
 *
 * The definition already fixed which rows exist and in what order (R14). This
 * step only supplies numbers, and it may not add, drop or reorder a row — so a
 * queue the view returned nothing for comes out with its heading and a marker
 * saying so, rather than disappearing.
 *
 * Two things are kept separate on purpose, because collapsing them is how a
 * report starts lying:
 *
 *   - **`availability`** records what the source actually said: `measured`
 *     when a row came back, `not_available` when none did.
 *   - **`value`** is what the configured blank policy says to show for that.
 *
 * Under `not_available` and `blank` the value is null; under `zero` it is 0.
 * The availability flag survives either way, so a reader downstream can always
 * recover the difference between "no data" and "measured zero" even when the
 * number cannot.
 *
 * Arithmetic goes through `@gridwright/expr`'s post-aggregation evaluator, the
 * same one the engine uses. A period is a position in that evaluator's column,
 * so a calculated row is computed for every period in one pass with the
 * library's own null and division semantics rather than a second set written
 * here.
 */

export type Availability = "measured" | "not_available";

export interface FilledCell {
  /** What to show, after the blank policy. */
  value: number | null;
  /** What the source said, before it. */
  availability: Availability;
}

export interface FilledRow {
  rowKey: string;
  heading: string;
  indent: number;
  kind: DefinitionRow["kind"];
  /** One cell per configured period, keyed by period name. */
  cells: Record<string, FilledCell>;
  /** actual − comparison, when both were measured. */
  variance: FilledCell;
}

export interface ReportResult {
  rows: FilledRow[];
  /** Period names in configuration order, which is display order. */
  periods: string[];
  blankPolicy: BlankPolicy;
  diagnostics: string[];
}

/** A row of the prepared business-data view. */
export type ViewRow = Record<string, string | number | boolean | null>;

export interface FillInput {
  /** The view's rows, as the source returned them. */
  rows: readonly ViewRow[];
  /** Column naming the row key, e.g. `queue_key`. */
  keyColumn: string;
  /** Column naming the period, e.g. `period`. */
  periodColumn: string;
}

const absent = (policy: BlankPolicy): FilledCell => ({
  value: policy === "zero" ? 0 : null,
  availability: "not_available",
});

const measured = (value: number): FilledCell => ({ value, availability: "measured" });

function numberOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function fillReport(definition: ReportDefinition, input: FillInput): ReportResult {
  const diagnostics = [...definition.diagnostics];
  const periods = Object.keys(definition.execution.periods);
  const metricColumn = definition.metric.id;

  /**
   * viewKey -> period -> one value, combined by the metric's own rule.
   *
   * A prepared view can return more than one row for a key and period, and the
   * right way to fold them together is a property of the metric, not of this
   * function. Adding them is correct for a count of closed cases and wrong for
   * a backlog reading; the compiler has already refused any rule this build
   * does not implement, so what arrives here is one of three.
   */
  const combine = (a: number, b: number): number => {
    switch (definition.metric.aggregation) {
      case "min":
        return Math.min(a, b);
      case "max":
        return Math.max(a, b);
      default:
        return a + b;
    }
  };

  const source = new Map<string, Map<string, number>>();
  for (const row of input.rows) {
    const key = String(row[input.keyColumn] ?? "");
    const period = String(row[input.periodColumn] ?? "");
    const n = numberOf(row[metricColumn]);
    if (!key || !period || n === null) continue;
    const byPeriod = source.get(key) ?? new Map<string, number>();
    const already = byPeriod.get(period);
    byPeriod.set(period, already === undefined ? n : combine(already, n));
    source.set(key, byPeriod);
  }

  // Filled cells per row, so a total or a calculation can read what came before
  // it. Populated in `evaluationOrder`, which the compiler already sorted so a
  // row never reads one that has not been computed.
  const cellsByRow = new Map<string, Record<string, FilledCell>>();
  const byKey = new Map(definition.rows.map((r) => [r.rowKey, r]));

  const order = definition.evaluationOrder.filter((id) => byKey.has(id));
  for (const rowKey of definition.rows.map((r) => r.rowKey)) {
    if (!order.includes(rowKey)) order.push(rowKey);
  }

  for (const rowKey of order) {
    const row = byKey.get(rowKey)!;
    const cells: Record<string, FilledCell> = {};

    if (row.kind === "data") {
      const found = source.get(row.viewKey ?? "");
      for (const period of periods) {
        const mapped = definition.execution.periods[period]!;
        const n = found?.get(mapped);
        cells[period] = n === undefined ? absent(definition.blankPolicy) : measured(n);
      }
    } else if (row.kind === "total") {
      for (const period of periods) {
        let sum = 0;
        let any = false;
        for (const over of row.over ?? []) {
          const cell = cellsByRow.get(over)?.[period];
          // A row with no data contributes nothing to a total. It does not
          // contribute a zero, which would be a claim the source never made.
          if (cell?.availability === "measured" && cell.value !== null) {
            sum += cell.value;
            any = true;
          }
        }
        cells[period] = any ? measured(sum) : absent(definition.blankPolicy);
      }
    } else {
      // Calculated. One pass over all periods, through the governed evaluator.
      const { analysis } = analyzeExpression(row.expr ?? "");
      if (!analysis) {
        // The compiler refuses an unparseable rule, so reaching here means the
        // definition was built elsewhere. Say so rather than guessing a value.
        diagnostics.push(`row "${rowKey}": expression could not be analysed; left not available`);
        for (const period of periods) cells[period] = absent(definition.blankPolicy);
      } else {
        const column = (id: string): Value[] =>
          periods.map((p) => cellsByRow.get(id)?.[p]?.value ?? null);
        const out = evalPostColumn(analysis.ast, { rowCount: periods.length, column });
        periods.forEach((period, i) => {
          const n = numberOf(out[i]);
          cells[period] = n === null ? absent(definition.blankPolicy) : measured(n);
        });
      }
    }

    cellsByRow.set(rowKey, cells);
  }

  const [actualPeriod, comparisonPeriod] = periods;

  const rows: FilledRow[] = definition.rows.map((row) => {
    const cells = cellsByRow.get(row.rowKey)!;
    const a = actualPeriod ? cells[actualPeriod] : undefined;
    const c = comparisonPeriod ? cells[comparisonPeriod] : undefined;

    // A difference against nothing is not a difference. Only two measured
    // sides produce a variance; anything else stays not available, which is
    // what keeps a missing row out of the number people quote.
    const variance =
      a?.availability === "measured" &&
      c?.availability === "measured" &&
      a.value !== null &&
      c.value !== null
        ? measured(a.value - c.value)
        : absent(definition.blankPolicy);

    return {
      rowKey: row.rowKey,
      heading: row.heading,
      indent: row.indent,
      kind: row.kind,
      cells,
      variance,
    };
  });

  return { rows, periods, blankPolicy: definition.blankPolicy, diagnostics };
}

export interface ViewScanOptions {
  /** Most rows to look at. Default 1000. */
  maxRows?: number;
  /** Columns to scan. Default: every column present on the first row. */
  columns?: readonly string[];
  /** Longest a single value should be. Default 500. */
  maxLength?: number;
  /** Include the matched text in each finding. Off by default. */
  sample?: boolean;
}

/**
 * Scans view data for text that is trying to be read as an instruction (R24).
 *
 * Separate from `fillReport`, and deliberately not called by it. Configuration
 * is small and authored, so it is scanned every time; a prepared view can
 * return a hundred thousand rows that are almost entirely numbers, and running
 * a pattern set over all of them on every render would be real work for very
 * little signal.
 *
 * So this is the call a caller makes when the values are about to go somewhere
 * that reads them — an answer, a summary, a model's context — rather than
 * somewhere that only draws them. It is bounded by row count for the same
 * reason every other read here is: an attacker should not get to choose how
 * much work a scan does.
 */
export function scanViewRows(
  rows: readonly ViewRow[],
  options: ViewScanOptions = {},
): Finding[] {
  const maxRows = options.maxRows ?? 1000;
  const maxLength = options.maxLength ?? 500;
  const findings: Finding[] = [];

  const looked = rows.slice(0, maxRows);
  const columns = options.columns ?? Object.keys(looked[0] ?? {});

  looked.forEach((row, i) => {
    for (const column of columns) {
      const scanOptions = options.sample
        ? { maxLength, sample: true }
        : { maxLength };
      findings.push(...scanText(row[column], `row[${i}].${column}`, scanOptions));
    }
  });

  return findings;
}
