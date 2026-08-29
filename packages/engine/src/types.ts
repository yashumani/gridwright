import type { Filter, Grain, Sort } from "@gridwright/schema";
import type { Node, Value } from "@gridwright/expr";

export type { Value };

/** A source table in columnar form. Columns stay parallel arrays end to end. */
export interface Table {
  name: string;
  columns: Record<string, Value[]>;
  rowCount: number;
}

export interface PlanDimension {
  id: string;
  field: string;
  label: string;
  grain?: Grain;
}

export interface PlanMeasure {
  id: string;
  label: string;
  format?: string;
  ast: Node;
}

/**
 * The compiled form of a dataset request. Both the in-process executor and the
 * SQL emitter consume this, so a backend swap cannot change query semantics.
 */
export interface QueryPlan {
  dataset: string;
  table: string;
  dimensions: PlanDimension[];
  /** Fold raw rows; become the GROUP BY projection. */
  aggregate: PlanMeasure[];
  /** Computed over the grouped result, in dependency order. */
  post: PlanMeasure[];
  /** Source columns the scan must read. */
  fields: string[];
  filters: Filter[];
  /** Sorts resolvable before the post tier — dimensions and aggregate measures. */
  preSort: Sort[];
  /** Sorts on post-tier measures, applied after they exist. */
  postSort: Sort[];
  limit?: number;
}

export interface ColumnMeta {
  /** Stable key into `QueryResult.data`. */
  key: string;
  id: string;
  kind: "dimension" | "measure";
  label: string;
  format?: string;
}

export interface QueryResult {
  plan: QueryPlan;
  columns: ColumnMeta[];
  /** Columnar, keyed by `ColumnMeta.key`. */
  data: Record<string, Value[]>;
  rowCount: number;
  /** True when `limit` or the cell ceiling cut the result short. */
  truncated: boolean;
  /** Groups before the limit was applied. */
  totalGroups: number;
  ms: number;
}

export interface SourceCapabilities {
  /** Backend can evaluate window functions itself. */
  windowFunctions: boolean;
  /** Backend can apply LIMIT/OFFSET server-side. */
  pushdownLimit: boolean;
  maxRows: number;
}

/**
 * The seam every backend implements. DuckDB, a warehouse adapter, or the
 * in-process executor differ only here.
 */
export interface DataSource {
  readonly name: string;
  capabilities(): SourceCapabilities;
  /** Column names available on a table, for validating a manifest against real data. */
  introspect(table: string): Promise<string[]>;
  execute(plan: QueryPlan): Promise<QueryResult>;
}

export class EngineError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = "EngineError";
  }
}

/** Column key for a dimension or measure. Prefixed so the two cannot collide. */
export const dimKey = (id: string): string => `d_${id}`;
export const measureKey = (id: string): string => `m_${id}`;
