import {
  LIMITS, type Filter, type Manifest, type Sort,
} from "@gridwright/schema";
import { analyzeModel, type ExprAnalysis } from "@gridwright/expr";
import { EngineError, type PlanDimension, type PlanMeasure, type QueryPlan } from "./types.js";

/**
 * Manifest + dataset name + runtime filters -> one query plan.
 *
 * The compiler is where the two-tier split becomes concrete: measures land in
 * `aggregate` or `post` according to their analysed stage, and each list is in
 * dependency order so an executor can walk straight down it.
 */

export interface CompileOptions {
  /** Cross-filter selections from the filter store, ANDed with dataset filters. */
  runtimeFilters?: readonly Filter[];
}

export interface CompiledModel {
  analyses: Map<string, ExprAnalysis>;
  order: string[];
}

/** Analyses every measure once; reuse this across datasets in the same manifest. */
export function compileModel(manifest: Manifest): CompiledModel {
  const { byId, order, issues } = analyzeModel(
    manifest.model.measures.map((m) => ({ id: m.id, expr: m.expr })),
  );
  if (issues.length) {
    throw new EngineError(
      "the measure model does not compile",
      issues.map((i) => `${i.path}: ${i.message}`).join("\n"),
    );
  }
  return { analyses: byId, order };
}

export function compileDataset(
  manifest: Manifest,
  datasetName: string,
  o: CompileOptions = {},
  model?: CompiledModel,
): QueryPlan {
  const ds = manifest.datasets[datasetName];
  if (!ds) throw new EngineError(`unknown dataset "${datasetName}"`);

  const { analyses, order } = model ?? compileModel(manifest);
  const fieldsByName = new Map(manifest.model.fields.map((f) => [f.name, f]));
  const dimsById = new Map(manifest.model.dimensions.map((d) => [d.id, d]));
  const measuresById = new Map(manifest.model.measures.map((m) => [m.id, m]));

  // ---- dimensions ----
  const dimensions: PlanDimension[] = (ds.dimensions ?? []).map((id) => {
    const d = dimsById.get(id);
    if (!d) throw new EngineError(`dataset "${datasetName}" selects unknown dimension "${id}"`);
    return { id: d.id, field: d.field, label: d.label ?? d.id, ...(d.grain ? { grain: d.grain } : {}) };
  });

  // ---- measures, expanded to include everything they depend on ----
  const needed = new Set<string>();
  const addWithDeps = (id: string): void => {
    if (needed.has(id)) return;
    needed.add(id);
    for (const ref of analyses.get(id)?.measures ?? []) addWithDeps(ref);
  };
  for (const id of ds.measures) {
    if (!measuresById.has(id)) {
      throw new EngineError(`dataset "${datasetName}" selects unknown measure "${id}"`);
    }
    addWithDeps(id);
  }

  const aggregate: PlanMeasure[] = [];
  const post: PlanMeasure[] = [];
  const fields = new Set<string>();

  // `order` is topological, so dependencies are emitted before dependents.
  for (const id of order) {
    if (!needed.has(id)) continue;
    const def = measuresById.get(id)!;
    const analysis = analyses.get(id)!;
    const entry: PlanMeasure = {
      id,
      label: def.label ?? id,
      ...(def.format ? { format: def.format } : {}),
      ast: analysis.ast,
    };
    (analysis.stage === "aggregate" ? aggregate : post).push(entry);
    for (const f of analysis.fields) fields.add(f);
  }

  for (const d of dimensions) fields.add(d.field);

  // ---- filters ----
  const filters = [...(ds.filters ?? []), ...(o.runtimeFilters ?? [])];
  for (const f of filters) {
    const d = dimsById.get(f.dimension);
    if (!d) throw new EngineError(`filter references unknown dimension "${f.dimension}"`);
    fields.add(d.field);
  }

  // ---- table resolution ----
  const tables = new Set<string>();
  for (const name of fields) {
    const f = fieldsByName.get(name);
    if (!f) throw new EngineError(`unknown field "${name}"`);
    tables.add(f.from.split(".")[0]!);
  }
  if (tables.size > 1) {
    throw new EngineError(
      `dataset "${datasetName}" reads from ${[...tables].join(" and ")}`,
      "Gridwright v1 queries a single table per dataset; joins are not supported yet.",
    );
  }
  const table = [...tables][0] ?? manifest.source.files[0]!.id;

  // ---- sort, split by the tier that can resolve it ----
  const postIds = new Set(post.map((m) => m.id));
  const preSort: Sort[] = [];
  const postSort: Sort[] = [];
  for (const s of ds.sort ?? []) {
    ("measure" in s && postIds.has(s.measure) ? postSort : preSort).push(s);
  }

  const limit = ds.limit ?? Math.min(LIMITS.datasetLimit, 10_000);

  return {
    dataset: datasetName,
    table,
    dimensions,
    aggregate,
    post,
    fields: [...fields],
    filters,
    preSort,
    postSort,
    limit,
  };
}

/** Stable hash of a plan, for the result cache. FNV-1a over canonical JSON. */
export function hashPlan(plan: QueryPlan): string {
  const canonical = JSON.stringify(plan, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}-${canonical.length.toString(16)}`;
}
