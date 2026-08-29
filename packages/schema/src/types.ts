/** Manifest v1 types. Kept hand-written so consumers get readable IntelliSense. */

export type FieldType = "string" | "number" | "date" | "boolean";
export type Grain = "year" | "quarter" | "month" | "week" | "day";
export type SortDir = "asc" | "desc";

export interface FileRef {
  /** Logical table name used by `FieldDef.from`. */
  id: string;
  /** Resolved by the host's FileResolver — never fetched directly. */
  path: string;
  format?: "csv" | "tsv" | "json";
}

export interface SourceDef {
  kind: "file";
  files: FileRef[];
}

export interface FieldDef {
  name: string;
  type: FieldType;
  /** `table.column` — table must match a `FileRef.id`. */
  from: string;
}

export interface DimensionDef {
  id: string;
  field: string;
  label?: string;
  /** Only meaningful for `date` fields; buckets the value before grouping. */
  grain?: Grain;
}

export interface MeasureDef {
  id: string;
  label?: string;
  /** Gridwright expression, e.g. `sum(amount)` or `measure(a) / measure(b)`. */
  expr: string;
  /** Excel-style pattern, e.g. `$#,##0.00` or `0.0%`. */
  format?: string;
}

export interface ModelDef {
  fields: FieldDef[];
  dimensions: DimensionDef[];
  measures: MeasureDef[];
}

export type FilterOp = "in" | "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "between";
export type Scalar = string | number | boolean | null;

export type Filter =
  | { dimension: string; op: "in"; values: Scalar[] }
  | { dimension: string; op: "between"; from: string | number; to: string | number }
  | { dimension: string; op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte"; value: Scalar };

export type Sort =
  | { measure: string; dir?: SortDir }
  | { dimension: string; dir?: SortDir };

export interface DatasetDef {
  dimensions?: string[];
  measures: string[];
  /** Baked into every query for this dataset, on top of runtime filters. */
  filters?: Filter[];
  sort?: Sort[];
  limit?: number;
}

export interface PanelLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanelDef {
  id: string;
  /** Looked up in the panel registry; the registry validates `props`. */
  type: string;
  dataset: string;
  title?: string;
  layout: PanelLayout;
  props?: Record<string, unknown>;
}

export type Action =
  | { action: "filter"; dimension: string; from?: "row" | "value" }
  | { action: "clearFilters"; dimension?: string };

export interface InteractionDef {
  /** `panelId.event`, e.g. `tbl.rowClick`. */
  on: string;
  do: Action[];
}

export interface GridDef {
  columns?: number;
  rowHeight?: number;
  gap?: number;
}

export interface ThemeDef {
  preset?: string;
  colors?: string[];
}

export interface Manifest {
  gridwright: number;
  title?: string;
  source: SourceDef;
  model: ModelDef;
  datasets: Record<string, DatasetDef>;
  panels: PanelDef[];
  interactions?: InteractionDef[];
  grid?: GridDef;
  theme?: ThemeDef;
}
