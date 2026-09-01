import type {
  DatasetDef, FieldType, Manifest, MeasureDef, PanelDef,
} from "@gridwright/schema";
import { IDENTIFIER, isReservedName } from "@gridwright/schema";
import type { Table, Value } from "./types.js";

/**
 * A starter manifest, guessed from the data alone.
 *
 * Somebody who has a spreadsheet and has never heard of this project cannot
 * write a manifest, and asking them to read the format before they have seen
 * anything work is where most of them leave. So the columns answer for them:
 * text groups, numbers add up, and the result is a real manifest they can read,
 * edit in the builder, and export.
 *
 * Everything here is a guess, and the guesses are conservative — a wrong
 * starting dashboard that renders is recoverable in the builder, whereas one
 * that fails to compile is not. Where a guess would be meaningless (summing an
 * id column) it is not made at all.
 */

/** Rows sampled per column when sniffing. Enough to be sure, cheap on 10M rows. */
const SAMPLE = 200;

/** Beyond this many distinct values a column is a label, not a grouping. */
const MAX_GROUPS = 50;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;
const TRUE_WORDS = new Set(["true", "yes", "y", "t"]);
const FALSE_WORDS = new Set(["false", "no", "n", "f"]);

/** Columns whose name says they identify a row rather than measure it. */
const ID_NAME = /(^|_)(id|uuid|guid|key|code|no|num|number)$/i;

/**
 * A column's type, from its values.
 *
 * Order matters: boolean before number, because `0` and `1` satisfy both and a
 * flag column summed is nonsense. Date before number for the same reason — a
 * bare year would otherwise become a measure.
 */
export function sniffType(values: readonly Value[]): FieldType {
  const seen: string[] = [];
  for (const v of values) {
    if (v === null || v === "") continue;
    seen.push(String(v));
    if (seen.length >= SAMPLE) break;
  }
  if (!seen.length) return "string";

  const every = (f: (s: string) => boolean): boolean => seen.every(f);

  if (every((s) => {
    const l = s.trim().toLowerCase();
    return TRUE_WORDS.has(l) || FALSE_WORDS.has(l);
  })) return "boolean";

  // A date needs to look like one. Date.parse alone accepts "5" and "2024",
  // which would silently turn a count column into a timeline.
  if (every((s) => ISO_DAY.test(s.trim()) || (s.length >= 8 && !Number.isNaN(Date.parse(s))))) {
    return "date";
  }

  if (every((s) => Number.isFinite(Number(s.trim())))) return "number";

  return "string";
}

/** A column name turned into a legal, unique identifier. */
function identifierFor(raw: string, taken: Set<string>): string {
  let base = raw
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (!base || !IDENTIFIER.test(base) || isReservedName(base)) base = `col_${base}`.replace(/_+$/, "");
  if (!IDENTIFIER.test(base)) base = "col";

  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  taken.add(name);
  return name;
}

/** "order_date" -> "Order date". Titles are for people; ids are for the format. */
function humanise(raw: string): string {
  const words = raw.trim().replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1).toLowerCase() : raw;
}

/** Whether every sampled value is a whole number, so decimals would be noise. */
function allWholeNumbers(values: readonly Value[]): boolean {
  let seen = 0;
  for (const v of values) {
    if (v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return false;
    if (++seen >= SAMPLE) break;
  }
  return true;
}

const distinctCount = (values: readonly Value[], cap: number): number => {
  const seen = new Set<string>();
  for (const v of values) {
    if (v === null) continue;
    seen.add(String(v));
    if (seen.size > cap) break;
  }
  return seen.size;
};

export interface InferOptions {
  /** Dashboard heading. Defaults to the table name, humanised. */
  title?: string;
  /** How many dimensions to build panels for. More than a few is a wall of charts. */
  maxDimensions?: number;
  /**
   * The data file's own name, as it sits on disk.
   *
   * The table id is a legal identifier, so `sales-q3.csv` becomes `sales_q3`
   * — and a manifest written from the id alone points at a file nobody has.
   * Saving the manifest next to the data is the whole promise, so the path has
   * to be the real name.
   */
  path?: string;
}

export interface InferredManifest {
  manifest: Manifest;
  /** What was guessed, in words, so the UI can say it rather than imply it. */
  notes: string[];
}

/**
 * Builds a manifest for one table. Multi-table models need declared relations —
 * cardinality is what keeps a join from silently multiplying rows — and that is
 * not something to guess, so joins stay a deliberate act.
 */
export function inferManifest(table: Table, o: InferOptions = {}): InferredManifest {
  const notes: string[] = [];
  const taken = new Set<string>();
  const maxDims = o.maxDimensions ?? 3;

  const columns = Object.entries(table.columns).map(([column, values]) => ({
    column,
    values,
    name: identifierFor(column, taken),
    type: sniffType(values),
  }));

  if (!columns.length) throw new Error(`"${table.name}" has no columns to build from`);

  const fields = columns.map((c) => ({ name: c.name, type: c.type, from: `${table.name}.${c.column}` }));

  // ---- measures ----
  // A number that identifies a row does not measure anything: summing an order
  // id produces a large, confident, meaningless number. Those stay dimensions.
  const numeric = columns.filter((c) => c.type === "number" && !ID_NAME.test(c.column));
  const idish = columns.filter((c) => c.type === "number" && ID_NAME.test(c.column));
  if (idish.length) {
    notes.push(
      `Treated ${idish.map((c) => `"${c.column}"`).join(", ")} as ${idish.length === 1 ? "a label" : "labels"} rather than ${idish.length === 1 ? "a number to add up" : "numbers to add up"}.`,
    );
  }

  const measures: MeasureDef[] = [
    { id: "rows", label: "Rows", expr: "count()", format: "#,##0" },
    ...numeric.slice(0, 6).map((c) => ({
      id: `total_${c.name}`.slice(0, 60),
      label: `Total ${humanise(c.column).toLowerCase()}`,
      expr: `sum(${c.name})`,
      // Counts read better whole; money and rates need their decimals. Taken
      // from the column rather than assumed, so a quantity does not come back
      // as "1,204.00".
      format: allWholeNumbers(c.values) ? "#,##0" : "#,##0.00",
    })),
  ];

  // ---- dimensions ----
  // A near-unique column is a legal dimension and a useless chart: grouping 60
  // customers by name draws sixty bars of one. So a column earns a place only
  // if it actually collects rows together — few distinct values in absolute
  // terms, and well short of one per row.
  const groupable = columns.filter((c) => {
    if (c.type === "number" && !ID_NAME.test(c.column)) return false;
    if (c.type === "date") return true;
    const distinct = distinctCount(c.values, MAX_GROUPS + 1);
    if (distinct <= 1 || distinct > MAX_GROUPS) return false;
    return distinct <= table.rowCount / 2;
  });

  const dateCol = groupable.find((c) => c.type === "date");
  // Date first: change over time is the chart people look for.
  const chosen = [
    ...(dateCol ? [dateCol] : []),
    ...groupable.filter((c) => c !== dateCol),
  ].slice(0, maxDims);

  const dimensions = chosen.map((c) => ({
    id: c.name === c.column.toLowerCase() ? `by_${c.name}`.slice(0, 60) : c.name,
    field: c.name,
    label: humanise(c.column),
    ...(c.type === "date" ? { grain: "month" as const } : {}),
  }));

  if (!dimensions.length) {
    notes.push("No column looked groupable, so this starts as totals only. Add a dimension in Build.");
  }

  // ---- datasets and panels ----
  const measureIds = measures.map((m) => m.id);
  const datasets: Record<string, DatasetDef> = { totals: { measures: measureIds.slice(0, 4) } };
  const panels: PanelDef[] = [];

  // The KPIs share the row rather than each taking a quarter of it: two
  // measures in the left third with half the width empty reads as a dashboard
  // that failed to load. 1, 2, 3 and 4 all divide 12 exactly.
  const kpis = measureIds.slice(0, 4);
  const kpiWidth = Math.floor(12 / kpis.length);
  kpis.forEach((id, i) => {
    panels.push({
      id: `kpi_${id}`.slice(0, 60),
      type: "kpi",
      dataset: "totals",
      layout: { x: i * kpiWidth, y: 0, w: kpiWidth, h: 2 },
      props: { measure: id },
    });
  });

  const headline = measureIds[1] ?? measureIds[0]!;
  let y = 2;

  // The trend spans the width; the categorical charts pair up beneath it. Laid
  // out explicitly rather than by a running offset, because an off-by-one in
  // the grid leaves a visible hole and nobody reads the arithmetic twice.
  const dated = dimensions.filter((d) => d.grain);
  const plain = dimensions.filter((d) => !d.grain);

  const dataset = (d: typeof dimensions[number]): string => {
    const name = `by_${d.field}`.slice(0, 60);
    datasets[name] = {
      dimensions: [d.id],
      measures: measureIds.slice(0, 4),
      ...(d.grain
        ? { sort: [{ dimension: d.id, dir: "asc" as const }] }
        : { sort: [{ measure: headline, dir: "desc" as const }], limit: 20 }),
    };
    return name;
  };

  for (const d of dated) {
    panels.push({
      id: `trend_${d.field}`.slice(0, 60),
      type: "line",
      dataset: dataset(d),
      title: `${d.label} trend`,
      layout: { x: 0, y, w: 12, h: 4 },
      props: { x: d.id, y: [headline], area: true },
    });
    y += 4;
  }

  plain.forEach((d, i) => {
    const half = plain.length > 1;
    panels.push({
      id: `bars_${d.field}`.slice(0, 60),
      type: "bar",
      dataset: dataset(d),
      title: `By ${d.label.toLowerCase()}`,
      layout: { x: half && i % 2 === 1 ? 6 : 0, y, w: half ? 6 : 12, h: 4 },
      props: { category: d.id, value: headline, showValues: true },
    });
    // Advance only when the row is full, or this was the last one.
    if (!half || i % 2 === 1 || i === plain.length - 1) y += 4;
  });

  // The table last: it is the relief view, and it is what makes any chart above
  // it checkable against actual numbers.
  const first = dimensions[0];
  if (first) {
    panels.push({
      id: "detail",
      type: "table",
      dataset: `by_${first.field}`.slice(0, 60),
      title: "Detail",
      layout: { x: 0, y, w: 12, h: 5 },
      props: {
        columns: [
          { ref: first.id },
          ...measureIds.slice(0, 4).map((m) => ({ ref: m, align: "right" as const })),
        ],
      },
    });
  }

  const manifest: Manifest = {
    gridwright: 1,
    title: o.title ?? humanise(table.name),
    source: { kind: "file", files: [{ id: table.name, path: `./${o.path ?? `${table.name}.csv`}` }] },
    model: { fields, dimensions, measures },
    datasets,
    panels,
  };

  notes.unshift(
    `Read ${table.rowCount.toLocaleString()} rows: ` +
    `${dimensions.length} thing${dimensions.length === 1 ? "" : "s"} to group by, ` +
    `${measures.length} number${measures.length === 1 ? "" : "s"} to measure.`,
  );

  return { manifest, notes };
}
