import { useEffect, useMemo, useState, type ReactNode } from "react";
import { analyzeExpression } from "@gridwright/expr";
import type {
  Cardinality, DatasetDef, DimensionDef, FieldDef, FieldType, Filter, FilterOp,
  Grain, Manifest, MeasureDef, RelationDef, Scalar, Sort, SortDir,
} from "@gridwright/schema";
import type { EditorAction } from "./editor.js";

/**
 * The model editor: the half of a manifest that is not panels.
 *
 * Arranging panels on a model somebody else wrote is a different job from
 * defining what the numbers mean. Until this existed an analyst could do the
 * first and had to hand the second back to an engineer, which put a person in
 * the loop for every new measure — the thing the whole format is meant to
 * avoid.
 *
 * Every control writes through the reducer, so model edits join the same undo
 * stack and the same comment-preserving export as everything else.
 */

const FIELD_TYPES: FieldType[] = ["string", "number", "date", "boolean"];
const GRAINS: Grain[] = ["year", "quarter", "month", "week", "day"];
const CARDINALITIES: Cardinality[] = ["many-to-one", "one-to-one"];
const OPS: FilterOp[] = ["in", "eq", "ne", "gt", "gte", "lt", "lte", "between"];

export interface ModelEditorProps {
  manifest: Manifest;
  apply: (action: EditorAction) => void;
  /** Real column names per table id, read from the source. */
  columns: Record<string, string[]>;
}

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="gwb-row">
      {htmlFor ? (
        <label className="gwb-label" htmlFor={htmlFor}>{label}</label>
      ) : (
        <span className="gwb-label">{label}</span>
      )}
      <div className="gwb-control">{children}</div>
    </div>
  );
}

/**
 * A text input that reports only when the edit is finished.
 *
 * Ids cascade: renaming a dimension rewrites every dataset, filter, sort and
 * interaction that names it. Doing that per keystroke would rename to `r`,
 * then `re`, then `rev` — fifty pointless entries on the undo stack and a
 * manifest that is briefly nonsense at every step. So identity edits commit on
 * blur or Enter, and Escape puts the old value back.
 */
function CommitInput({
  value, onCommit, id, ariaLabel,
}: { value: string; onCommit: (next: string) => void; id?: string; ariaLabel?: string }) {
  const [draft, setDraft] = useState(value);
  // Adopt an outside change (undo, or a cascade) unless it is being edited.
  useEffect(() => { setDraft(value); }, [value]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };

  return (
    <input
      {...(id ? { id } : {})}
      {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
      className="gwb-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === "Escape") { setDraft(value); e.currentTarget.blur(); }
      }}
    />
  );
}

/** `table.column`, split for editing and rejoined on change. */
function ColumnPicker({
  value, tables, columns, onChange, ariaLabel,
}: {
  value: string;
  tables: string[];
  columns: Record<string, string[]>;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  const dot = value.indexOf(".");
  const table = dot < 0 ? tables[0] ?? "" : value.slice(0, dot);
  const column = dot < 0 ? value : value.slice(dot + 1);
  const known = columns[table] ?? [];

  return (
    <div className="gwb-pair">
      <select
        className="gwb-input"
        aria-label={`${ariaLabel} table`}
        value={table}
        onChange={(e) => onChange(`${e.target.value}.${column}`)}
      >
        {tables.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      {/* A loaded file tells us its real columns; before that, or for a column
          the file does not have, the name stays typeable rather than lost. */}
      {known.length && known.includes(column) ? (
        <select
          className="gwb-input"
          aria-label={`${ariaLabel} column`}
          value={column}
          onChange={(e) => onChange(`${table}.${e.target.value}`)}
        >
          {known.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      ) : (
        <CommitInput
          value={column}
          ariaLabel={`${ariaLabel} column`}
          onCommit={(c) => onChange(`${table}.${c}`)}
        />
      )}
    </div>
  );
}

/** Multi-select over a fixed set of ids, as checkboxes — order follows the source list. */
function IdSet({
  all, chosen, onChange, legend,
}: { all: string[]; chosen: string[]; onChange: (next: string[]) => void; legend: string }) {
  if (!all.length) return <p className="gwb-hint">None defined yet.</p>;
  return (
    <ul className="gwb-checks" aria-label={legend}>
      {all.map((id) => (
        <li key={id}>
          <label className="gwb-check">
            <input
              type="checkbox"
              checked={chosen.includes(id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...chosen, id] : chosen.filter((x) => x !== id))
              }
            />
            {id}
          </label>
        </li>
      ))}
    </ul>
  );
}

/** Text to a filter value. A bare number stays a number so comparisons order. */
function parseScalar(raw: string): Scalar {
  const v = raw.trim();
  if (v === "") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  const n = Number(v);
  return v !== "" && Number.isFinite(n) ? n : v;
}

const showScalar = (v: Scalar): string => (v === null ? "" : String(v));

/** A unique id in a namespace, so "add" never lands on a duplicate. */
function freshId(taken: readonly string[], stem: string): string {
  const set = new Set(taken);
  if (!set.has(stem)) return stem;
  for (let i = 2; ; i++) if (!set.has(`${stem}_${i}`)) return `${stem}_${i}`;
}

export function ModelEditor({ manifest, apply, columns }: ModelEditorProps) {
  const { fields, dimensions, measures } = manifest.model;
  const tables = manifest.source.files.map((f) => f.id);
  const setModel = (patch: Partial<Manifest["model"]>) =>
    apply({ type: "setModel", model: { ...manifest.model, ...patch } });
  const setDatasets = (datasets: Record<string, DatasetDef>) =>
    apply({ type: "setDatasets", datasets });

  const fieldType = useMemo(
    () => new Map(fields.map((f) => [f.name, f.type])),
    [fields],
  );

  const patchAt = <T,>(list: T[], i: number, patch: Partial<T>): T[] =>
    list.map((item, j) => (j === i ? { ...item, ...patch } : item));

  return (
    <div className="gwb-model">
      <p className="gwb-hint gwb-modelnote">
        This is where the numbers come from. <strong>Fields</strong> are the columns
        in your file; <strong>dimensions</strong> are the ones you can group by;
        <strong> measures</strong> are what gets calculated. Panels above only
        display what is defined here.
      </p>

      {/* ---- fields ---- */}
      {/* Fields closed, dimensions and measures open. The fields were read out
          of the file and are already right; opening on eight identical blocks
          of Name/Type/From buries the two sections the note just said matter. */}
      <details className="gwb-section">
        <summary>Fields <span className="gwb-count">{fields.length}</span></summary>

        {fields.map((f, i) => (
          <div className="gwb-item" key={`${f.name}-${i}`}>
            <Row label="Name">
              <CommitInput
                value={f.name}
                ariaLabel={`Field ${i + 1} name`}
                onCommit={(name) => setModel({ fields: patchAt<FieldDef>(fields, i, { name }) })}
              />
            </Row>
            <Row label="Type">
              <select
                className="gwb-input"
                aria-label={`Field ${i + 1} type`}
                value={f.type}
                onChange={(e) =>
                  setModel({ fields: patchAt<FieldDef>(fields, i, { type: e.target.value as FieldType }) })
                }
              >
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Row>
            <Row label="From">
              <ColumnPicker
                value={f.from}
                tables={tables}
                columns={columns}
                ariaLabel={`Field ${i + 1}`}
                onChange={(from) => setModel({ fields: patchAt<FieldDef>(fields, i, { from }) })}
              />
            </Row>
            <button
              type="button"
              className="gwb-mini gwb-danger"
              onClick={() => apply({ type: "removeField", name: f.name })}
            >
              Remove field
            </button>
          </div>
        ))}

        <button
          type="button"
          className="gwb-mini"
          onClick={() => {
            const table = tables[0] ?? "";
            const name = freshId(fields.map((x) => x.name), "field");
            setModel({ fields: [...fields, { name, type: "string", from: `${table}.${name}` }] });
          }}
        >
          Add field
        </button>
      </details>

      {/* ---- dimensions ---- */}
      <details className="gwb-section" open>
        <summary>Dimensions <span className="gwb-count">{dimensions.length}</span></summary>

        {dimensions.map((d, i) => {
          // Grain buckets a date before grouping; on anything else it is a
          // validation error, so the control is not offered.
          const dated = fieldType.get(d.field) === "date";
          return (
            <div className="gwb-item" key={d.id}>
              <Row label="Id">
                <CommitInput
                  value={d.id}
                  ariaLabel={`Dimension ${i + 1} id`}
                  onCommit={(to) => apply({ type: "renameDimension", from: d.id, to })}
                />
              </Row>
              <Row label="Field">
                <select
                  className="gwb-input"
                  aria-label={`Dimension ${i + 1} field`}
                  value={d.field}
                  onChange={(e) => {
                    const field = e.target.value;
                    const next: DimensionDef = { ...d, field };
                    if (fieldType.get(field) !== "date") delete next.grain;
                    setModel({ dimensions: dimensions.map((x, j) => (j === i ? next : x)) });
                  }}
                >
                  {fields.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                </select>
              </Row>
              <Row label="Label">
                <input
                  className="gwb-input"
                  aria-label={`Dimension ${i + 1} label`}
                  value={d.label ?? ""}
                  onChange={(e) => {
                    const next: DimensionDef = { ...d };
                    if (e.target.value) next.label = e.target.value;
                    else delete next.label;
                    setModel({ dimensions: dimensions.map((x, j) => (j === i ? next : x)) });
                  }}
                />
              </Row>
              {dated && (
                <Row label="Grain">
                  <select
                    className="gwb-input"
                    aria-label={`Dimension ${i + 1} grain`}
                    value={d.grain ?? ""}
                    onChange={(e) => {
                      const next: DimensionDef = { ...d };
                      if (e.target.value) next.grain = e.target.value as Grain;
                      else delete next.grain;
                      setModel({ dimensions: dimensions.map((x, j) => (j === i ? next : x)) });
                    }}
                  >
                    <option value="">none</option>
                    {GRAINS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </Row>
              )}
              <button
                type="button"
                className="gwb-mini gwb-danger"
                onClick={() => apply({ type: "removeDimension", id: d.id })}
              >
                Remove dimension
              </button>
            </div>
          );
        })}

        <button
          type="button"
          className="gwb-mini"
          disabled={!fields.length}
          onClick={() => {
            const id = freshId(dimensions.map((x) => x.id), "dimension");
            setModel({ dimensions: [...dimensions, { id, field: fields[0]!.name }] });
          }}
        >
          Add dimension
        </button>
      </details>

      {/* ---- measures ---- */}
      <details className="gwb-section" open>
        <summary>Measures <span className="gwb-count">{measures.length}</span></summary>

        {measures.map((m, i) => (
          <MeasureRow
            key={m.id}
            measure={m}
            index={i}
            onRename={(to) => apply({ type: "renameMeasure", from: m.id, to })}
            onChange={(next) => setModel({ measures: measures.map((x, j) => (j === i ? next : x)) })}
            onRemove={() => apply({ type: "removeMeasure", id: m.id })}
          />
        ))}

        <button
          type="button"
          className="gwb-mini"
          onClick={() => {
            const id = freshId(measures.map((x) => x.id), "measure");
            setModel({ measures: [...measures, { id, expr: "count()" }] });
          }}
        >
          Add measure
        </button>
      </details>

      {/* ---- datasets ---- */}
      <details className="gwb-section">
        <summary>Datasets <span className="gwb-count">{Object.keys(manifest.datasets).length}</span></summary>

        {Object.entries(manifest.datasets).map(([name, ds], i) => (
          <DatasetRow
            key={name}
            name={name}
            dataset={ds}
            index={i}
            dimensions={dimensions.map((d) => d.id)}
            measures={measures.map((m) => m.id)}
            onRename={(to) => apply({ type: "renameDataset", from: name, to })}
            onChange={(next) => setDatasets({ ...manifest.datasets, [name]: next })}
            onRemove={() => apply({ type: "removeDataset", name })}
          />
        ))}

        <button
          type="button"
          className="gwb-mini"
          onClick={() => {
            const name = freshId(Object.keys(manifest.datasets), "dataset");
            setDatasets({ ...manifest.datasets, [name]: { measures: [] } });
          }}
        >
          Add dataset
        </button>
      </details>

      {/* ---- relations ---- */}
      <details className="gwb-section">
        <summary>Relations <span className="gwb-count">{manifest.source.relations?.length ?? 0}</span></summary>

        <p className="gwb-hint">
          Left is the many side, right the one side. Following that edge backwards
          multiplies fact rows, so the planner refuses it rather than double-counting.
        </p>

        {(manifest.source.relations ?? []).map((r, i) => {
          const relations = manifest.source.relations ?? [];
          const set = (patch: Partial<RelationDef>) =>
            apply({ type: "setRelations", relations: patchAt<RelationDef>(relations, i, patch) });
          return (
            <div className="gwb-item" key={i}>
              <Row label="Many side">
                <ColumnPicker
                  value={r.left}
                  tables={tables}
                  columns={columns}
                  ariaLabel={`Relation ${i + 1} left`}
                  onChange={(left) => set({ left })}
                />
              </Row>
              <Row label="One side">
                <ColumnPicker
                  value={r.right}
                  tables={tables}
                  columns={columns}
                  ariaLabel={`Relation ${i + 1} right`}
                  onChange={(right) => set({ right })}
                />
              </Row>
              <Row label="Cardinality">
                <select
                  className="gwb-input"
                  aria-label={`Relation ${i + 1} cardinality`}
                  value={r.cardinality ?? "many-to-one"}
                  onChange={(e) => set({ cardinality: e.target.value as Cardinality })}
                >
                  {CARDINALITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Row>
              <button
                type="button"
                className="gwb-mini gwb-danger"
                onClick={() =>
                  apply({ type: "setRelations", relations: relations.filter((_, j) => j !== i) })
                }
              >
                Remove relation
              </button>
            </div>
          );
        })}

        <button
          type="button"
          className="gwb-mini"
          disabled={tables.length < 2}
          onClick={() => {
            const [a, b] = tables;
            apply({
              type: "setRelations",
              relations: [
                ...(manifest.source.relations ?? []),
                { left: `${a}.id`, right: `${b}.id`, cardinality: "many-to-one" },
              ],
            });
          }}
        >
          Add relation
        </button>
      </details>
    </div>
  );
}

function MeasureRow({
  measure, index, onRename, onChange, onRemove,
}: {
  measure: MeasureDef;
  index: number;
  onRename: (to: string) => void;
  onChange: (next: MeasureDef) => void;
  onRemove: () => void;
}) {
  // The expression language is the part an analyst is most likely to get
  // wrong, so it answers while they type rather than at export.
  const analysis = useMemo(() => analyzeExpression(measure.expr), [measure.expr]);

  return (
    <div className="gwb-item">
      <Row label="Id">
        <CommitInput value={measure.id} ariaLabel={`Measure ${index + 1} id`} onCommit={onRename} />
      </Row>
      <Row label="Label">
        <input
          className="gwb-input"
          aria-label={`Measure ${index + 1} label`}
          value={measure.label ?? ""}
          onChange={(e) => {
            const next: MeasureDef = { ...measure };
            if (e.target.value) next.label = e.target.value;
            else delete next.label;
            onChange(next);
          }}
        />
      </Row>
      <Row label="Expression">
        <textarea
          className="gwb-input gwb-expr"
          aria-label={`Measure ${index + 1} expression`}
          rows={2}
          spellCheck={false}
          value={measure.expr}
          onChange={(e) => onChange({ ...measure, expr: e.target.value })}
        />
      </Row>
      {analysis.issues.length ? (
        <p className="gwb-issue" role="status">{analysis.issues[0]!.message}</p>
      ) : (
        <p className="gwb-ok" role="status">
          {analysis.analysis?.stage === "post"
            ? "Runs after grouping"
            : "Folds raw rows"}
        </p>
      )}
      <Row label="Format">
        <input
          className="gwb-input"
          aria-label={`Measure ${index + 1} format`}
          placeholder="$#,##0.00"
          value={measure.format ?? ""}
          onChange={(e) => {
            const next: MeasureDef = { ...measure };
            if (e.target.value) next.format = e.target.value;
            else delete next.format;
            onChange(next);
          }}
        />
      </Row>
      <button type="button" className="gwb-mini gwb-danger" onClick={onRemove}>
        Remove measure
      </button>
    </div>
  );
}

function DatasetRow({
  name, dataset, index, dimensions, measures, onRename, onChange, onRemove,
}: {
  name: string;
  dataset: DatasetDef;
  index: number;
  dimensions: string[];
  measures: string[];
  onRename: (to: string) => void;
  onChange: (next: DatasetDef) => void;
  onRemove: () => void;
}) {
  const filters = dataset.filters ?? [];
  const sort = dataset.sort ?? [];

  const withKey = <K extends keyof DatasetDef>(key: K, value: DatasetDef[K]): DatasetDef => {
    const next: DatasetDef = { ...dataset };
    // An empty optional list is noise in the exported file; drop the key.
    if (value === undefined || (Array.isArray(value) && !value.length)) delete next[key];
    else next[key] = value;
    return next;
  };

  return (
    <div className="gwb-item">
      <Row label="Name">
        <CommitInput value={name} ariaLabel={`Dataset ${index + 1} name`} onCommit={onRename} />
      </Row>

      <fieldset className="gwb-fieldset">
        <legend>Group by</legend>
        <IdSet
          all={dimensions}
          chosen={dataset.dimensions ?? []}
          legend={`Dataset ${index + 1} dimensions`}
          onChange={(next) => onChange(withKey("dimensions", next))}
        />
      </fieldset>

      <fieldset className="gwb-fieldset">
        <legend>Measures</legend>
        <IdSet
          all={measures}
          chosen={dataset.measures}
          legend={`Dataset ${index + 1} measures`}
          onChange={(next) => onChange({ ...dataset, measures: next })}
        />
      </fieldset>

      <fieldset className="gwb-fieldset">
        <legend>Filters</legend>
        {filters.map((f, i) => (
          <FilterRow
            key={i}
            filter={f}
            index={i}
            dimensions={dimensions}
            onChange={(next) =>
              onChange(withKey("filters", filters.map((x, j) => (j === i ? next : x))))
            }
            onRemove={() => onChange(withKey("filters", filters.filter((_, j) => j !== i)))}
          />
        ))}
        <button
          type="button"
          className="gwb-mini"
          disabled={!dimensions.length}
          onClick={() =>
            onChange(withKey("filters", [
              ...filters,
              { dimension: dimensions[0]!, op: "eq", value: "" } as Filter,
            ]))
          }
        >
          Add filter
        </button>
      </fieldset>

      <fieldset className="gwb-fieldset">
        <legend>Sort</legend>
        {sort.map((s, i) => {
          const key = "measure" in s ? `measure:${s.measure}` : `dimension:${s.dimension}`;
          return (
            <div className="gwb-pair" key={i}>
              <select
                className="gwb-input"
                aria-label={`Dataset ${index + 1} sort ${i + 1} column`}
                value={key}
                onChange={(e) => {
                  const [kind, id] = e.target.value.split(":") as ["measure" | "dimension", string];
                  const next: Sort = kind === "measure"
                    ? { measure: id, ...(s.dir ? { dir: s.dir } : {}) }
                    : { dimension: id, ...(s.dir ? { dir: s.dir } : {}) };
                  onChange(withKey("sort", sort.map((x, j) => (j === i ? next : x))));
                }}
              >
                {dimensions.map((d) => (
                  <option key={`d${d}`} value={`dimension:${d}`}>{d}</option>
                ))}
                {measures.map((m) => (
                  <option key={`m${m}`} value={`measure:${m}`}>{m}</option>
                ))}
              </select>
              <select
                className="gwb-input"
                aria-label={`Dataset ${index + 1} sort ${i + 1} direction`}
                value={s.dir ?? "asc"}
                onChange={(e) =>
                  onChange(withKey("sort", sort.map((x, j) =>
                    j === i ? { ...x, dir: e.target.value as SortDir } : x)))
                }
              >
                <option value="asc">asc</option>
                <option value="desc">desc</option>
              </select>
              <button
                type="button"
                className="gwb-mini gwb-danger"
                aria-label={`Remove sort ${i + 1}`}
                onClick={() => onChange(withKey("sort", sort.filter((_, j) => j !== i)))}
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="gwb-mini"
          disabled={!dimensions.length && !measures.length}
          onClick={() => {
            const first: Sort = measures.length
              ? { measure: measures[0]!, dir: "desc" }
              : { dimension: dimensions[0]!, dir: "asc" };
            onChange(withKey("sort", [...sort, first]));
          }}
        >
          Add sort
        </button>
      </fieldset>

      <Row label="Limit">
        <input
          className="gwb-input"
          type="number"
          min={1}
          aria-label={`Dataset ${index + 1} limit`}
          value={dataset.limit ?? ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(withKey("limit", e.target.value && Number.isFinite(n) ? Math.trunc(n) : undefined));
          }}
        />
      </Row>

      <button type="button" className="gwb-mini gwb-danger" onClick={onRemove}>
        Remove dataset
      </button>
    </div>
  );
}

function FilterRow({
  filter, index, dimensions, onChange, onRemove,
}: {
  filter: Filter;
  index: number;
  dimensions: string[];
  onChange: (next: Filter) => void;
  onRemove: () => void;
}) {
  const label = `Filter ${index + 1}`;

  // Changing the operator changes the shape of the value, so the payload is
  // rebuilt rather than spread over — `values` and `value` never coexist.
  const setOp = (op: FilterOp): Filter => {
    const d = filter.dimension;
    if (op === "in") return { dimension: d, op, values: [] };
    if (op === "between") return { dimension: d, op, from: "", to: "" };
    return { dimension: d, op, value: "" };
  };

  return (
    <div className="gwb-item">
      <div className="gwb-pair">
        <select
          className="gwb-input"
          aria-label={`${label} dimension`}
          value={filter.dimension}
          onChange={(e) => onChange({ ...filter, dimension: e.target.value })}
        >
          {dimensions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select
          className="gwb-input"
          aria-label={`${label} operator`}
          value={filter.op}
          onChange={(e) => onChange(setOp(e.target.value as FilterOp))}
        >
          {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button type="button" className="gwb-mini gwb-danger" aria-label={`Remove ${label}`} onClick={onRemove}>
          ×
        </button>
      </div>

      {filter.op === "in" && (
        <input
          className="gwb-input"
          aria-label={`${label} values`}
          placeholder="North, South"
          value={filter.values.map(showScalar).join(", ")}
          onChange={(e) =>
            onChange({
              ...filter,
              values: e.target.value.split(",").map(parseScalar).filter((v) => v !== null),
            })
          }
        />
      )}

      {filter.op === "between" && (
        <div className="gwb-pair">
          <input
            className="gwb-input"
            aria-label={`${label} from`}
            value={String(filter.from)}
            onChange={(e) => {
              const v = parseScalar(e.target.value);
              onChange({ ...filter, from: typeof v === "number" ? v : e.target.value });
            }}
          />
          <input
            className="gwb-input"
            aria-label={`${label} to`}
            value={String(filter.to)}
            onChange={(e) => {
              const v = parseScalar(e.target.value);
              onChange({ ...filter, to: typeof v === "number" ? v : e.target.value });
            }}
          />
        </div>
      )}

      {filter.op !== "in" && filter.op !== "between" && (
        <input
          className="gwb-input"
          aria-label={`${label} value`}
          value={showScalar(filter.value)}
          onChange={(e) => onChange({ ...filter, value: parseScalar(e.target.value) })}
        />
      )}
    </div>
  );
}
