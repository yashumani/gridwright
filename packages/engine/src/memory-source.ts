import { LIMITS, type Filter, type Sort } from "@gridwright/schema";
import {
  FUNCTIONS, evalAggregateIndexed, evalPostColumn, makeReducer, truncateDate,
  type Node, type Row, type RowCursor, type Value,
} from "@gridwright/expr";
import {
  EngineError, dimKey, measureKey,
  type ColumnMeta, type DataSource, type QueryPlan, type QueryResult,
  type SourceCapabilities, type Table,
} from "./types.js";

/**
 * The in-process executor: runs a plan over columnar tables held in memory.
 *
 * Two properties carry the performance at scale, and both are about *not*
 * building things per row. Fields are read through accessors positioned by
 * index, so no row object is ever materialised; and each dimension is encoded
 * to an integer code once, so grouping is an array index rather than a string
 * hash. At five million rows those two together are the difference between a
 * query that takes seconds and one that takes a fraction of a second.
 *
 * Order of operations matters and is not arbitrary. Grouping happens on the
 * *dimension* value with grain already applied, so a filter on a month
 * dimension matches the bucket rather than the raw timestamp. The pre-sort runs
 * before the post tier so window functions see the declared order — `runningSum`
 * on a by-month dataset accumulates in month order, which is the only reading a
 * user expects.
 */
export class MemorySource implements DataSource {
  readonly name = "memory";

  /**
   * Join indexes and dimension encodings depend on the data and the plan's
   * shape, never on its filters — so cross-filtering, which changes only the
   * filters, can reuse both. Recomputing them per query was pure repeated work
   * on the one path users exercise hardest.
   *
   * Tables are immutable for the lifetime of a source, so nothing invalidates.
   */
  private readonly joinCache = new Map<string, Int32Array>();
  private readonly encodeCache = new Map<string, Encoded>();

  constructor(private readonly tables: Map<string, Table>) {}

  /** Frees the derived indexes. The next query rebuilds what it needs. */
  clearDerived(): void {
    this.joinCache.clear();
    this.encodeCache.clear();
  }

  static fromTables(tables: readonly Table[]): MemorySource {
    return new MemorySource(new Map(tables.map((t) => [t.name, t])));
  }

  capabilities(): SourceCapabilities {
    return { windowFunctions: true, pushdownLimit: false, maxRows: 20_000_000 };
  }

  async introspect(table: string): Promise<string[]> {
    const t = this.tables.get(table);
    if (!t) throw new EngineError(`unknown table "${table}"`);
    return Object.keys(t.columns);
  }

  async execute(plan: QueryPlan): Promise<QueryResult> {
    const started = Date.now();
    const base = this.tables.get(plan.table);
    if (!base) throw new EngineError(`unknown table "${plan.table}"`);

    const tableFor = (name: string): Table => {
      const t = this.tables.get(name);
      if (!t) throw new EngineError(`unknown table "${name}"`);
      return t;
    };

    for (const f of plan.fields) {
      const origin = plan.fieldMap[f];
      if (!origin) throw new EngineError(`field "${f}" has no resolved source`);
      const owner = tableFor(origin.table);
      if (!(origin.column in owner.columns)) {
        throw new EngineError(
          `table "${origin.table}" has no column "${origin.column}"`,
          `available: ${Object.keys(owner.columns).join(", ")}`,
        );
      }
    }

    const n = base.rowCount;
    const dims = plan.dimensions;

    // ---- joins ----
    // One index per joined table, mapping a base row to the row it matched.
    // -1 means no match: the fact row survives with nulls rather than
    // vanishing, because losing facts to a missing dimension row is the wrong
    // answer dressed up as a smaller one.
    const matched = new Map<string, Int32Array>();
    for (const step of plan.joins) {
      const cacheKey =
        `${plan.table}|${step.fromTable}.${step.fromColumn}>${step.table}.${step.toColumn}`;
      const cachedJoin = this.joinCache.get(cacheKey);
      if (cachedJoin) {
        matched.set(step.table, cachedJoin);
        continue;
      }
      const right = tableFor(step.table);
      const left = tableFor(step.fromTable);
      const rightKey = right.columns[step.toColumn];
      const leftKey = left.columns[step.fromColumn];
      if (!rightKey) {
        throw new EngineError(
          `join key "${step.table}.${step.toColumn}" does not exist`,
          `available: ${Object.keys(right.columns).join(", ")}`,
        );
      }
      if (!leftKey) {
        throw new EngineError(
          `join key "${step.fromTable}.${step.fromColumn}" does not exist`,
          `available: ${Object.keys(left.columns).join(", ")}`,
        );
      }

      // Built back to front so the first declared row wins a duplicate key.
      const index = new Map<string, number>();
      for (let r = right.rowCount - 1; r >= 0; r--) {
        const v = rightKey[r];
        if (v === null || v === undefined) continue;
        index.set(joinKey(v), r);
      }

      const parent = step.fromTable === plan.table ? undefined : matched.get(step.fromTable);
      const out = new Int32Array(n).fill(-1);
      for (let i = 0; i < n; i++) {
        const li = parent ? parent[i]! : i;
        if (li < 0) continue;
        const v = leftKey[li];
        if (v === null || v === undefined) continue;
        out[i] = index.get(joinKey(v)) ?? -1;
      }
      matched.set(step.table, out);
      this.joinCache.set(cacheKey, out);
    }

    // ---- field access ----
    const accessorFor = (field: string): ((i: number) => Value) => {
      const origin = plan.fieldMap[field]!;
      const column = tableFor(origin.table).columns[origin.column]!;
      if (origin.table === plan.table) return (i) => column[i] ?? null;
      const at = matched.get(origin.table)!;
      return (i) => {
        const j = at[i]!;
        return j < 0 ? null : column[j] ?? null;
      };
    };

    const accessors = new Map<string, (i: number) => Value>();
    for (const f of plan.fields) accessors.set(f, accessorFor(f));

    // A single row view, repositioned rather than reallocated. Expressions read
    // it exactly as they would a plain row object.
    const cursor: RowCursor = { index: 0, row: {} as Row };
    for (const [field, read] of accessors) {
      Object.defineProperty(cursor.row, field, {
        get: () => read(cursor.index),
        enumerable: true,
      });
    }

    // ---- dimension encoding ----
    const encoded = dims.map((dim) => {
      const key = `${plan.table}|${dim.field}|${dim.grain ?? ""}`;
      const hit = this.encodeCache.get(key);
      if (hit) return hit;
      const built = encodeColumn(n, accessors.get(dim.field)!, dim.grain);
      // Bounded so a manifest with very many dimensions cannot pin memory.
      if (this.encodeCache.size >= 32) {
        const oldest = this.encodeCache.keys().next();
        if (!oldest.done) this.encodeCache.delete(oldest.value);
      }
      this.encodeCache.set(key, built);
      return built;
    });

    // ---- filters ----
    // A filter on a grouped dimension becomes a lookup table over its codes, so
    // the row loop does an array read instead of a comparison.
    const tests: Array<(i: number) => boolean> = [];
    for (const f of plan.filters) {
      const di = dims.findIndex((d) => d.id === f.dimension);
      if (di >= 0) {
        const { codes, values } = encoded[di]!;
        const pass = new Uint8Array(values.length);
        for (let c = 0; c < values.length; c++) pass[c] = matches(f, values[c]!) ? 1 : 0;
        tests.push((i) => pass[codes[i]!] === 1);
        continue;
      }
      // Not grouped by this dataset: resolve through the field the compiler
      // projected for it, applying that dimension's own grain.
      const origin = plan.dimensionFields?.[f.dimension];
      const read = origin ? accessors.get(origin.field) : accessors.get(f.dimension);
      if (!read) continue; // unresolvable here: do not narrow
      const grain = origin?.grain;
      tests.push((i) => {
        const raw = read(i);
        const v = grain && raw !== null ? truncateDate(String(raw), grain) : raw;
        return matches(f, v);
      });
    }

    // ---- grouping ----
    // Integer keys while the cardinality product fits in an Int32Array; a map
    // of composite string keys otherwise.
    let product = 1;
    let dense = true;
    for (const e of encoded) {
      product *= Math.max(1, e.values.length);
      if (product > 4_000_000) { dense = false; break; }
    }

    const groupId = new Int32Array(n).fill(-1);
    const groupCodes: number[] = [];
    const denseIndex = dense ? new Int32Array(product).fill(-1) : undefined;
    const sparseIndex = dense ? undefined : new Map<string, number>();
    let groupCount = 0;
    let kept = 0;

    for (let i = 0; i < n; i++) {
      let ok = true;
      for (let t = 0; t < tests.length; t++) {
        if (!tests[t]!(i)) { ok = false; break; }
      }
      if (!ok) continue;
      kept++;

      let g: number;
      if (denseIndex) {
        let key = 0;
        for (let d = 0; d < encoded.length; d++) {
          const e = encoded[d]!;
          key = key * Math.max(1, e.values.length) + e.codes[i]!;
        }
        g = denseIndex[key]!;
        if (g < 0) {
          g = groupCount++;
          denseIndex[key] = g;
          for (let d = 0; d < encoded.length; d++) groupCodes.push(encoded[d]!.codes[i]!);
        }
      } else {
        let key = "";
        for (let d = 0; d < encoded.length; d++) key += `${encoded[d]!.codes[i]!},`;
        const found = sparseIndex!.get(key);
        if (found === undefined) {
          g = groupCount++;
          sparseIndex!.set(key, g);
          for (let d = 0; d < encoded.length; d++) groupCodes.push(encoded[d]!.codes[i]!);
        } else {
          g = found;
        }
      }
      groupId[i] = g;
    }

    // An aggregate query with no GROUP BY returns exactly one row, even when
    // nothing matches — that is what makes a KPI read 0 rather than vanish
    // when a cross-filter excludes every record.
    if (!dims.length && groupCount === 0) groupCount = 1;

    // Counting sort of row indices into per-group runs: contiguous, so an
    // aggregate walks a slice rather than chasing a list of arrays.
    const offsets = new Int32Array(groupCount + 1);
    for (let i = 0; i < n; i++) {
      const g = groupId[i]!;
      if (g >= 0) offsets[g + 1]!++;
    }
    for (let g = 0; g < groupCount; g++) offsets[g + 1]! += offsets[g]!;
    const rowsByGroup = new Int32Array(kept);
    const fill = Int32Array.from(offsets.subarray(0, groupCount));
    for (let i = 0; i < n; i++) {
      const g = groupId[i]!;
      if (g >= 0) rowsByGroup[fill[g]!++] = i;
    }

    const width = dims.length;
    let entries: GroupEntry[] = new Array(groupCount);
    for (let g = 0; g < groupCount; g++) {
      const key: Value[] = new Array(width);
      for (let d = 0; d < width; d++) key[d] = encoded[d]!.values[groupCodes[g * width + d]!]!;
      entries[g] = { key, start: offsets[g]!, end: offsets[g + 1]! };
    }
    const totalGroups = groupCount;

    // ---- aggregate tier ----
    const aggregateColumns = new Map<string, Value[]>();
    for (const m of plan.aggregate) {
      const out: Value[] = new Array(entries.length);
      const simple = simpleAggregate(m.ast);
      const read = simple?.field ? accessors.get(simple.field) : undefined;

      if (simple && (!simple.field || read)) {
        for (let g = 0; g < entries.length; g++) {
          const e = entries[g]!;
          const reducer = makeReducer(simple.name);
          if (read) {
            for (let k = e.start; k < e.end; k++) reducer.push(read(rowsByGroup[k]!));
          } else {
            for (let k = e.start; k < e.end; k++) reducer.push(1);
          }
          out[g] = reducer.result();
        }
      } else {
        for (let g = 0; g < entries.length; g++) {
          const e = entries[g]!;
          out[g] = evalAggregateIndexed(m.ast, cursor, rowsByGroup, e.start, e.end);
        }
      }
      aggregateColumns.set(m.id, out);
    }

    // ---- pre-sort: dimensions and aggregate measures ----
    if (plan.preSort.length) {
      const order = sortOrder(entries.length, plan.preSort, (s, i) =>
        "measure" in s
          ? aggregateColumns.get(s.measure)?.[i] ?? null
          : entries[i]!.key[dims.findIndex((d) => d.id === s.dimension)] ?? null);
      entries = order.map((i) => entries[i]!);
      for (const [id, col] of aggregateColumns) {
        aggregateColumns.set(id, order.map((i) => col[i]!));
      }
    }

    // ---- post tier ----
    const columns = new Map(aggregateColumns);
    const ctx = {
      rowCount: entries.length,
      column: (id: string): Value[] => {
        const c = columns.get(id);
        if (!c) throw new EngineError(`measure "${id}" was not computed before it was referenced`);
        return c;
      },
    };
    for (const m of plan.post) {
      columns.set(m.id, evalPostColumn(m.ast, ctx));
    }

    // ---- post-sort: measures that only exist now ----
    if (plan.postSort.length) {
      const order = sortOrder(entries.length, plan.postSort, (s, i) =>
        "measure" in s ? columns.get(s.measure)?.[i] ?? null : null);
      entries = order.map((i) => entries[i]!);
      for (const [id, col] of columns) columns.set(id, order.map((i) => col[i]!));
    }

    // ---- projection, limit and the cell ceiling ----
    const meta: ColumnMeta[] = [
      ...dims.map((d): ColumnMeta => ({ key: dimKey(d.id), id: d.id, kind: "dimension", label: d.label })),
      ...[...plan.aggregate, ...plan.post].map((m): ColumnMeta => ({
        key: measureKey(m.id), id: m.id, kind: "measure", label: m.label,
        ...(m.format ? { format: m.format } : {}),
      })),
    ];

    const cellCap = meta.length ? Math.floor(LIMITS.resultCells / meta.length) : LIMITS.resultCells;
    const limit = Math.min(plan.limit ?? Number.MAX_SAFE_INTEGER, cellCap);
    const rowCount = Math.min(entries.length, limit);
    const truncated = rowCount < entries.length;

    const data: Record<string, Value[]> = Object.create(null);
    dims.forEach((d, di) => {
      const out: Value[] = new Array(rowCount);
      for (let i = 0; i < rowCount; i++) out[i] = entries[i]!.key[di] ?? null;
      data[dimKey(d.id)] = out;
    });
    for (const m of [...plan.aggregate, ...plan.post]) {
      data[measureKey(m.id)] = (columns.get(m.id) ?? []).slice(0, rowCount);
    }

    return { plan, columns: meta, data, rowCount, truncated, totalGroups, ms: Date.now() - started };
  }
}

interface GroupEntry {
  key: Value[];
  /** Half-open range into the grouped row-index array. */
  start: number;
  end: number;
}

interface Encoded {
  codes: Int32Array;
  values: Value[];
}

/**
 * Turns a column into integer codes plus a value table, applying grain once.
 * Null is a code like any other, so blanks form their own group rather than
 * disappearing.
 */
function encodeColumn(
  n: number,
  read: (i: number) => Value,
  grain: string | undefined,
): Encoded {
  const codes = new Int32Array(n);
  const values: Value[] = [];

  // One dictionary per type rather than one keyed on a "type:value" string.
  // That string form cost an allocation per row per dimension, which at five
  // million rows was a large share of the whole query. Keeping the types apart
  // preserves the property that mattered: 1 and "1" stay different groups.
  const strings = new Map<string, number>();
  const numbers = new Map<number, number>();
  const others = new Map<string, number>();
  let nullCode = -1;

  for (let i = 0; i < n; i++) {
    const raw = read(i);
    const v = grain && raw !== null ? truncateDate(String(raw), grain) : raw;

    if (v === null) {
      if (nullCode < 0) { nullCode = values.length; values.push(null); }
      codes[i] = nullCode;
      continue;
    }
    if (typeof v === "string") {
      const hit = strings.get(v);
      if (hit === undefined) {
        const code = values.length;
        values.push(v);
        strings.set(v, code);
        codes[i] = code;
      } else codes[i] = hit;
      continue;
    }
    if (typeof v === "number") {
      const hit = numbers.get(v);
      if (hit === undefined) {
        const code = values.length;
        values.push(v);
        numbers.set(v, code);
        codes[i] = code;
      } else codes[i] = hit;
      continue;
    }
    const key = String(v);
    const hit = others.get(key);
    if (hit === undefined) {
      const code = values.length;
      values.push(v);
      others.set(key, code);
      codes[i] = code;
    } else codes[i] = hit;
  }
  return { codes, values };
}

/**
 * Recognises the shapes that make up almost every real measure — `sum(field)`,
 * `count()`, `countIf(field)` — so they can read a column directly instead of
 * walking the expression tree through a property getter once per row.
 *
 * Anything more complex falls back to the general evaluator, which produces
 * identical results; this is a speed path, not a second set of semantics.
 */
function simpleAggregate(node: Node): { name: string; field?: string } | null {
  if (node.kind !== "call") return null;
  const spec = FUNCTIONS[node.name];
  if (!spec || spec.stage !== "aggregate") return null;
  const arg = node.args[0];
  if (!arg) return { name: node.name };
  if (arg.kind !== "field") return null;
  return { name: node.name, field: arg.name };
}

/** Join keys carry their type, so 1 and "1" are not treated as the same key. */
const joinKey = (v: Value): string => `${typeof v}:${String(v)}`;

export function compareValues(a: Value, b: Value): number {
  if (a === null && b === null) return 0;
  // Nulls sort last regardless of direction — an empty cell is not a small one.
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a), y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Returns an index permutation rather than sorting rows, so parallel columns stay aligned. */
function sortOrder(
  n: number,
  sorts: readonly Sort[],
  get: (sort: Sort, index: number) => Value,
): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((ia, ib) => {
    for (const s of sorts) {
      const dir = s.dir === "asc" ? 1 : -1;
      const a = get(s, ia);
      const b = get(s, ib);
      // Nulls stay last under either direction, so undo the flip for them.
      if (a === null || b === null) {
        const c = compareValues(a, b);
        if (c !== 0) return c;
        continue;
      }
      const c = compareValues(a, b);
      if (c !== 0) return c * dir;
    }
    return ia - ib; // stable
  });
  return order;
}

function matches(f: Filter, value: Value): boolean {
  switch (f.op) {
    case "in":
      return f.values.some((v) => compareValues(v as Value, value) === 0);
    case "between": {
      if (value === null) return false;
      return compareValues(value, f.from as Value) >= 0 && compareValues(value, f.to as Value) <= 0;
    }
    case "eq": return compareValues(value, f.value as Value) === 0;
    case "ne": return compareValues(value, f.value as Value) !== 0;
    case "gt": return value !== null && compareValues(value, f.value as Value) > 0;
    case "gte": return value !== null && compareValues(value, f.value as Value) >= 0;
    case "lt": return value !== null && compareValues(value, f.value as Value) < 0;
    case "lte": return value !== null && compareValues(value, f.value as Value) <= 0;
  }
}
