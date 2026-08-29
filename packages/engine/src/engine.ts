import type { Filter, Manifest } from "@gridwright/schema";
import { compileDataset, compileModel, hashPlan, type CompiledModel } from "./compile.js";
import type { DataSource, QueryPlan, QueryResult } from "./types.js";

/**
 * A bounded result cache. Cross-filtering re-queries constantly and users
 * clear selections as often as they set them, so the panel they just backed
 * out of should come back instantly rather than recompute.
 */
export class QueryCache {
  private readonly entries = new Map<string, QueryResult>();

  constructor(private readonly maxEntries = 64) {}

  get(key: string): QueryResult | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    // Re-insert so iteration order tracks recency.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  set(key: string, value: QueryResult): void {
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface EngineOptions {
  cache?: QueryCache | false;
}

export interface QueryOptions {
  filters?: readonly Filter[];
  /** Skip the cache for this call; the result is still stored. */
  refresh?: boolean;
}

export interface EngineStats {
  queries: number;
  cacheHits: number;
}

/**
 * Ties a manifest to a data source. The measure model is analysed once here
 * rather than per query — it is the same work for every dataset.
 */
export class Engine {
  private readonly model: CompiledModel;
  private readonly cache: QueryCache | undefined;
  private readonly stats: EngineStats = { queries: 0, cacheHits: 0 };

  constructor(
    readonly manifest: Manifest,
    readonly source: DataSource,
    o: EngineOptions = {},
  ) {
    this.model = compileModel(manifest);
    this.cache = o.cache === false ? undefined : o.cache ?? new QueryCache();
  }

  plan(dataset: string, filters: readonly Filter[] = []): QueryPlan {
    return compileDataset(this.manifest, dataset, { runtimeFilters: filters }, this.model);
  }

  async query(dataset: string, o: QueryOptions = {}): Promise<QueryResult> {
    const plan = this.plan(dataset, o.filters ?? []);
    const key = hashPlan(plan);

    if (this.cache && !o.refresh) {
      const hit = this.cache.get(key);
      if (hit) {
        this.stats.cacheHits++;
        return hit;
      }
    }

    const result = await this.source.execute(plan);
    this.stats.queries++;
    this.cache?.set(key, result);
    return result;
  }

  /** Runs every dataset a set of panels needs, de-duplicated, in parallel. */
  async queryAll(
    datasets: readonly string[],
    o: QueryOptions = {},
  ): Promise<Record<string, QueryResult>> {
    const unique = [...new Set(datasets)];
    const results = await Promise.all(unique.map((d) => this.query(d, o)));
    return Object.fromEntries(unique.map((d, i) => [d, results[i]!]));
  }

  getStats(): Readonly<EngineStats> {
    return { ...this.stats };
  }

  clearCache(): void {
    this.cache?.clear();
  }
}
