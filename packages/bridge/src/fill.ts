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

  // viewKey -> period -> summed value, built once.
  const source = new Map<string, Map<string, number>>();
  for (const row of input.rows) {
    const key = String(row[input.keyColumn] ?? "");
    const period = String(row[input.periodColumn] ?? "");
    const n = numberOf(row[metricColumn]);
    if (!key || !period || n === null) continue;
    const byPeriod = source.get(key) ?? new Map<string, number>();
    byPeriod.set(period, (byPeriod.get(period) ?? 0) + n);
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
