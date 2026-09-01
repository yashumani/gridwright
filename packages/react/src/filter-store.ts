import type { Filter, Manifest } from "@gridwright/schema";
import type { Value } from "@gridwright/engine";

/**
 * Cross-filter state: which values are selected per dimension.
 *
 * A hand-rolled subscribable store rather than a state library, because the
 * shape is tiny and `useSyncExternalStore` wants exactly this interface. The
 * one rule that matters: a selection is a *set* per dimension, and selections
 * across dimensions are ANDed — clicking North then Online means both.
 */
export type Selections = Readonly<Record<string, readonly Value[]>>;

export type Listener = () => void;

export class FilterStore {
  private state: Selections = Object.freeze(Object.create(null));
  private readonly listeners = new Set<Listener>();

  getSnapshot = (): Selections => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Adds or removes one value. Clicking a selected value clears it. */
  toggle(dimension: string, value: Value): void {
    const current = this.state[dimension] ?? [];
    const without = current.filter((v) => v !== value);
    const next = without.length === current.length ? [...current, value] : without;
    this.write(dimension, next);
  }

  set(dimension: string, values: readonly Value[]): void {
    this.write(dimension, [...values]);
  }

  clear(dimension?: string): void {
    if (dimension === undefined) {
      this.state = Object.freeze(Object.create(null));
      this.emit();
      return;
    }
    this.write(dimension, []);
  }

  isEmpty(): boolean {
    return Object.values(this.state).every((v) => v.length === 0);
  }

  /** The engine's filter form. Empty dimensions drop out rather than matching nothing. */
  toFilters(): Filter[] {
    return Object.entries(this.state)
      .filter(([, values]) => values.length > 0)
      .map(([dimension, values]) => ({
        dimension,
        op: "in" as const,
        values: [...values] as Filter extends { values: infer V } ? V : never,
      }));
  }

  private write(dimension: string, values: Value[]): void {
    const next: Record<string, readonly Value[]> = Object.create(null);
    for (const [k, v] of Object.entries(this.state)) next[k] = v;
    if (values.length) next[dimension] = Object.freeze(values);
    else delete next[dimension];
    this.state = Object.freeze(next);
    this.emit();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

/** Human-readable summary of the active selections, for the filter bar. */
export function describeSelections(manifest: Manifest, selections: Selections): Array<{
  dimension: string;
  label: string;
  values: readonly Value[];
}> {
  const labels = new Map(manifest.model.dimensions.map((d) => [d.id, d.label ?? d.id]));
  return Object.entries(selections)
    .filter(([, v]) => v.length > 0)
    .map(([dimension, values]) => ({
      dimension,
      label: labels.get(dimension) ?? dimension,
      values,
    }));
}
