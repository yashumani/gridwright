import type { RelationDef } from "@gridwright/schema";
import { EngineError } from "./types.js";

/**
 * Join planning for a star schema.
 *
 * The whole difficulty here is fan-out. Joining a fact table to a dimension
 * many-to-one is safe: every fact row matches at most one dimension row, so the
 * grain is unchanged and `sum()` still means what it says. Following the same
 * edge backwards — one dimension row to many facts — multiplies rows, and every
 * aggregate downstream is silently wrong. That is the classic BI bug, and it is
 * silent, which is what makes it dangerous.
 *
 * So the planner only ever traverses edges in the safe direction. If the tables
 * a dataset needs cannot be connected that way, it refuses and says why, rather
 * than returning a number nobody can trust.
 */

export interface JoinStep {
  /** The table being brought in. */
  table: string;
  /** An already-joined table supplying the key. */
  fromTable: string;
  fromColumn: string;
  toColumn: string;
}

export interface JoinPlan {
  base: string;
  steps: JoinStep[];
}

interface Edge {
  to: string;
  fromColumn: string;
  toColumn: string;
  safe: boolean;
}

const split = (ref: string): [string, string] => {
  const dot = ref.indexOf(".");
  return [ref.slice(0, dot), ref.slice(dot + 1)];
};

/** Adjacency in both directions, tagged with whether traversal preserves grain. */
function buildGraph(relations: readonly RelationDef[]): Map<string, Edge[]> {
  const graph = new Map<string, Edge[]>();
  const push = (from: string, edge: Edge) => {
    const list = graph.get(from);
    if (list) list.push(edge);
    else graph.set(from, [edge]);
  };

  for (const r of relations) {
    const [leftTable, leftColumn] = split(r.left);
    const [rightTable, rightColumn] = split(r.right);
    const oneToOne = r.cardinality === "one-to-one";

    // many -> one preserves grain; one -> many multiplies it.
    push(leftTable, { to: rightTable, fromColumn: leftColumn, toColumn: rightColumn, safe: true });
    push(rightTable, { to: leftTable, fromColumn: rightColumn, toColumn: leftColumn, safe: oneToOne });
  }
  return graph;
}

/** Breadth-first walk from `base`, optionally allowing grain-multiplying edges. */
function reach(
  graph: Map<string, Edge[]>,
  base: string,
  allowUnsafe: boolean,
): { seen: Set<string>; steps: JoinStep[] } {
  const seen = new Set([base]);
  const steps: JoinStep[] = [];
  const queue = [base];

  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of graph.get(current) ?? []) {
      if (seen.has(edge.to)) continue;
      if (!edge.safe && !allowUnsafe) continue;
      seen.add(edge.to);
      steps.push({
        table: edge.to,
        fromTable: current,
        fromColumn: edge.fromColumn,
        toColumn: edge.toColumn,
      });
      queue.push(edge.to);
    }
  }
  return { seen, steps };
}

export interface PlanJoinsOptions {
  /** Manifest declaration order, used only to break ties deterministically. */
  fileOrder: readonly string[];
  /** Named in error messages so the user knows which dataset to fix. */
  dataset?: string;
}

/**
 * Chooses a base table and the join steps that bring in everything else.
 *
 * A candidate base must reach every required table by safe edges only. Where
 * several qualify, the one declared first wins, so a plan is stable across runs
 * and its hash stays a usable cache key.
 */
export function planJoins(
  relations: readonly RelationDef[],
  required: readonly string[],
  o: PlanJoinsOptions,
): JoinPlan {
  const needed = [...new Set(required)];
  const where = o.dataset ? `dataset "${o.dataset}"` : "this query";

  if (needed.length === 0) throw new EngineError(`${where} reads no tables`);
  if (needed.length === 1) return { base: needed[0]!, steps: [] };

  const graph = buildGraph(relations);
  const order = (t: string) => {
    const i = o.fileOrder.indexOf(t);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const candidates = [...needed].sort((a, b) => order(a) - order(b));

  for (const base of candidates) {
    const { seen, steps } = reach(graph, base, false);
    if (needed.every((t) => seen.has(t))) {
      // Keep only the steps on the way to something actually required, so a
      // dataset never scans a table none of its fields mention.
      return { base, steps: prune(steps, base, needed) };
    }
  }

  // Nothing worked. Distinguish "would fan out" from "not connected at all",
  // because the fix is different.
  for (const base of candidates) {
    const { seen } = reach(graph, base, true);
    if (needed.every((t) => seen.has(t))) {
      const stranded = needed.filter((t) => !reach(graph, base, false).seen.has(t));
      throw new EngineError(
        `${where} cannot be joined without multiplying rows`,
        `Reaching ${stranded.map((t) => `"${t}"`).join(", ")} from "${base}" means following a ` +
        `one-to-many relation, which repeats every row on the many side and would double-count ` +
        `sums. Model the shared grain as its own table, or split this into separate datasets.`,
      );
    }
  }

  throw new EngineError(
    `${where} reads ${needed.map((t) => `"${t}"`).join(" and ")}, which are not connected`,
    "Declare a relation under source.relations that links them.",
  );
}

/** Drops join steps that no required table depends on. */
function prune(steps: readonly JoinStep[], base: string, needed: readonly string[]): JoinStep[] {
  const parent = new Map(steps.map((s) => [s.table, s.fromTable]));
  const keep = new Set<string>();
  for (const target of needed) {
    let cursor: string | undefined = target;
    while (cursor && cursor !== base && !keep.has(cursor)) {
      keep.add(cursor);
      cursor = parent.get(cursor);
    }
  }
  return steps.filter((s) => keep.has(s.table));
}
