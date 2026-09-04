import type { ComponentType } from "react";
import { formatIssues, type Issue, type Validator } from "@gridwright/schema";
import type { ColumnMeta, QueryResult, Value } from "@gridwright/engine";

/**
 * The panel registry. Each entry pairs a component with a schema for its own
 * props, which is what makes both halves of the product work: the renderer
 * validates a manifest's props against it, and the builder generates its
 * property form from it. Adding a panel type extends the manifest language
 * without touching the core.
 */

export interface PanelSize {
  width: number;
  height: number;
}

export interface PanelContext {
  result: QueryResult;
  title?: string;
  /** Measured content box. Charts draw at real pixels rather than scaling text. */
  size: PanelSize;
  /**
   * Emits a selection. The host turns it into a filter and re-queries.
   *
   * `row` is the whole clicked row, keyed by column id. An interaction may
   * target a dimension other than the one clicked, and it needs that
   * dimension's own value from the same row — filtering `channel` by a region
   * name would empty the dashboard.
   */
  select(dimensionId: string, value: Value, row?: Readonly<Record<string, Value>>): void;
  /** Currently selected values per dimension, for highlighting. */
  selected: Readonly<Record<string, readonly Value[]>>;
  locale?: string;
}

export interface PanelProps<P = Record<string, unknown>> extends PanelContext {
  props: P;
}

export interface PanelSpec<P = Record<string, unknown>> {
  type: string;
  label: string;
  description: string;
  schema: Validator<P>;
  defaults: (result: QueryResult) => P;
  Component: ComponentType<PanelProps<P>>;
  /** Minimum grid footprint the builder should honour when placing one. */
  minSize?: { w: number; h: number };
  /**
   * The props that decide what this panel draws, in the order to ask for them.
   *
   * A bar chart has five settings and two of them are the chart; the rest are
   * tuning. The builder leads with these and folds the remainder behind a
   * disclosure, so the first thing a newcomer sees is the question the panel is
   * actually asking. Omit it and every prop shows at once, as before.
   */
  primary?: readonly string[];
}

export class PanelRegistry {
  private readonly specs = new Map<string, PanelSpec<any>>();

  register<P>(spec: PanelSpec<P>): this {
    this.specs.set(spec.type, spec);
    return this;
  }

  get(type: string): PanelSpec<any> | undefined {
    return this.specs.get(type);
  }

  has(type: string): boolean {
    return this.specs.has(type);
  }

  types(): string[] {
    return [...this.specs.keys()].sort();
  }

  all(): PanelSpec<any>[] {
    return [...this.specs.values()];
  }

  /** Validates one panel's props. Returns issues rather than throwing. */
  validateProps(type: string, props: unknown, path = "props"): Issue[] {
    const spec = this.specs.get(type);
    if (!spec) {
      return [{
        path,
        message: `unknown panel type "${type}" — registered types are ${this.types().join(", ")}`,
      }];
    }
    const issues: Issue[] = [];
    spec.schema.check(props ?? {}, path, issues);
    return issues;
  }
}

/** Thrown by a panel when its props do not describe something renderable. */
export class PanelConfigError extends Error {
  constructor(readonly issues: Issue[]) {
    super(`panel is misconfigured:\n${formatIssues(issues)}`);
    this.name = "PanelConfigError";
  }
}

// ---- helpers shared by the built-in panels ----

export const columnByRef = (result: QueryResult, ref: string): ColumnMeta | undefined =>
  result.columns.find((c) => c.id === ref);

export function requireColumn(result: QueryResult, ref: string, what: string): ColumnMeta {
  const c = columnByRef(result, ref);
  if (!c) {
    throw new PanelConfigError([{
      path: what,
      message: `"${ref}" is not in this dataset — available: ${result.columns.map((x) => x.id).join(", ")}`,
    }]);
  }
  return c;
}

export const columnValues = (result: QueryResult, meta: ColumnMeta): Value[] =>
  result.data[meta.key] ?? [];

export const firstDimension = (result: QueryResult): ColumnMeta | undefined =>
  result.columns.find((c) => c.kind === "dimension");

export const firstMeasure = (result: QueryResult): ColumnMeta | undefined =>
  result.columns.find((c) => c.kind === "measure");

export const isSelected = (
  selected: PanelContext["selected"],
  dimensionId: string,
  value: Value,
): boolean => (selected[dimensionId] ?? []).some((v) => v === value);
