import { useId, type ReactNode } from "react";

/**
 * A form generated from a JSON Schema.
 *
 * This is the whole reason the builder is cheap: panels already ship a schema
 * for their props so the renderer can validate a manifest, and the same schema
 * describes every control needed to edit them. Adding a panel type gives you
 * its editing UI for free — nobody hand-writes a property panel.
 */

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean | JsonSchema;
  pattern?: string;
  title?: string;
  description?: string;
}

/** A column the selected panel may draw, as a person would recognise it. */
export interface RefOption {
  id: string;
  label: string;
  kind: "dimension" | "measure";
}

export interface FieldSuggestions {
  /** Columns offered wherever a schema expects a reference. */
  refs?: readonly RefOption[];
}

export interface PropertyFormProps {
  schema: JsonSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  suggestions?: FieldSuggestions;
  label?: string;
  path?: string;
  /**
   * Property names to render, in this order. Everything else in the schema is
   * skipped — the caller renders it in a second pass behind a disclosure.
   *
   * A bar chart has five settings and two of them decide what it draws. Showing
   * all five as equals is the difference between "pick a category and a number"
   * and a form somebody has to read twice.
   */
  only?: readonly string[];
  /** Render everything except these. The other half of the same split. */
  except?: readonly string[];
}

const humanise = (key: string): string =>
  key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * Keys whose value names a dataset column, and which half of the model each one
 * wants. A bar chart's category is something to group by, never a number —
 * offering both makes the picker twice as long and half of it wrong.
 */
const REF_KEYS: Record<string, "dimension" | "measure" | "any"> = {
  measure: "measure", value: "measure", delta: "measure", y: "measure",
  x: "dimension", category: "dimension", dimension: "dimension",
  ref: "any",
};

export function PropertyForm({
  schema, value, onChange, suggestions, label, path = "", only, except,
}: PropertyFormProps): ReactNode {
  const id = useId();
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  const leafKey = path.split(".").pop()?.replace(/\[\d+\]$/, "") ?? "";

  // ---- enum: a fixed set is always a select ----
  if (schema.enum?.length) {
    return (
      <Row label={label} htmlFor={id}>
        <select
          id={id}
          className="gwb-input"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">Default</option>
          {schema.enum.map((o) => (
            <option key={String(o)} value={String(o)}>{String(o)}</option>
          ))}
        </select>
      </Row>
    );
  }

  switch (type) {
    case "object": {
      const record = (value ?? {}) as Record<string, unknown>;
      let entries = Object.entries(schema.properties ?? {});
      // The split applies to this object's own keys only, so a nested object
      // still renders whole — "only: [columns]" means that column list entire,
      // not its first field.
      if (only) {
        const rank = new Map(only.map((k, i) => [k, i]));
        entries = entries
          .filter(([k]) => rank.has(k))
          .sort((a, b) => rank.get(a[0])! - rank.get(b[0])!);
      } else if (except) {
        entries = entries.filter(([k]) => !except.includes(k));
      }
      if (!entries.length) return null;
      const body = entries.map(([key, child]) => (
        <PropertyForm
          key={key}
          schema={child}
          label={child.title ?? humanise(key)}
          value={record[key]}
          path={path ? `${path}.${key}` : key}
          {...(suggestions ? { suggestions } : {})}
          onChange={(next) => {
            const copy = { ...record };
            if (next === undefined || next === "") delete copy[key];
            else copy[key] = next;
            onChange(copy);
          }}
        />
      ));
      if (!label) return <div className="gwb-group">{body}</div>;
      return (
        <fieldset className="gwb-fieldset">
          <legend>{label}</legend>
          {body}
        </fieldset>
      );
    }

    case "array": {
      const items = Array.isArray(value) ? value : [];
      const itemSchema = schema.items ?? {};
      const atMax = schema.maxItems !== undefined && items.length >= schema.maxItems;
      const atMin = schema.minItems !== undefined && items.length <= schema.minItems;
      return (
        <fieldset className="gwb-fieldset">
          <legend>{label ?? "Items"}</legend>
          {items.map((item, i) => (
            <div className="gwb-item" key={i}>
              <PropertyForm
                schema={itemSchema}
                value={item}
                label={`${i + 1}`}
                path={`${path}[${i}]`}
                {...(suggestions ? { suggestions } : {})}
                onChange={(next) => {
                  const copy = [...items];
                  copy[i] = next;
                  onChange(copy);
                }}
              />
              <button
                type="button"
                className="gwb-mini"
                disabled={atMin}
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                aria-label={`Remove item ${i + 1}`}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="gwb-mini"
            disabled={atMax}
            onClick={() => onChange([...items, blankFor(itemSchema)])}
          >
            Add
          </button>
        </fieldset>
      );
    }

    case "boolean":
      return (
        <Row label={label} htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked ? true : undefined)}
          />
        </Row>
      );

    case "number":
    case "integer":
      return (
        <Row label={label} htmlFor={id}>
          <input
            id={id}
            className="gwb-input"
            type="number"
            value={value === undefined || value === null ? "" : String(value)}
            {...(schema.minimum !== undefined ? { min: schema.minimum } : {})}
            {...(schema.maximum !== undefined ? { max: schema.maximum } : {})}
            step={type === "integer" ? 1 : "any"}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") return onChange(undefined);
              const n = Number(raw);
              onChange(Number.isFinite(n) ? n : undefined);
            }}
          />
        </Row>
      );

    case "string": {
      // A field that names a column picks from the columns the panel's dataset
      // actually has, by their labels.
      //
      // This was a datalist on a free-text input, which is a suggestion rather
      // than a choice: the list is easy to miss, anything at all can be typed,
      // and what it offered were raw ids. Someone who has not read the manifest
      // has no way to know that the number they want is spelled `rtn_rate`.
      const wants = REF_KEYS[leafKey];
      const all = wants ? suggestions?.refs : undefined;
      // Narrow to what the field accepts, but never to nothing: a dataset with
      // no dimensions still has to let you pick something, and an empty select
      // is a dead end with no explanation.
      const narrowed = wants && wants !== "any" ? all?.filter((r) => r.kind === wants) : all;
      const refs = narrowed?.length ? narrowed : all;
      if (refs?.length) {
        const current = value === undefined || value === null ? "" : String(value);
        const known = refs.some((r) => r.id === current);
        const dims = refs.filter((r) => r.kind === "dimension");
        const measures = refs.filter((r) => r.kind === "measure");
        return (
          <Row label={label} htmlFor={id}>
            <select
              id={id}
              className="gwb-input"
              value={current}
              onChange={(e) => onChange(e.target.value || undefined)}
            >
              <option value="">Choose one…</option>
              {/* A value written by hand that this dataset does not have stays
                  selectable and is named as the problem, rather than silently
                  resetting to blank and losing what the author wrote. */}
              {current && !known && <option value={current}>{current} — not in this dataset</option>}
              {dims.length > 0 && (
                <optgroup label="Group by">
                  {dims.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </optgroup>
              )}
              {measures.length > 0 && (
                <optgroup label="Numbers">
                  {measures.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </optgroup>
              )}
            </select>
          </Row>
        );
      }
      return (
        <Row label={label} htmlFor={id}>
          <input
            id={id}
            className="gwb-input"
            type="text"
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        </Row>
      );
    }

    default: {
      if (schema.anyOf?.length) {
        // Untagged unions edit as their first branch; the validator still has
        // the final say when the manifest is saved.
        return (
          <PropertyForm
            schema={schema.anyOf[0]!}
            value={value}
            onChange={onChange}
            path={path}
            {...(label ? { label } : {})}
            {...(suggestions ? { suggestions } : {})}
          />
        );
      }
      return (
        <Row label={label} htmlFor={id}>
          <input
            id={id}
            className="gwb-input"
            type="text"
            value={value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value)}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        </Row>
      );
    }
  }
}

function Row({ label, htmlFor, children }: { label?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="gwb-row">
      {label && <label className="gwb-label" htmlFor={htmlFor}>{label}</label>}
      <div className="gwb-control">{children}</div>
    </div>
  );
}

/** A blank value matching a schema, so "Add" produces something editable. */
export function blankFor(schema: JsonSchema): unknown {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schema.enum?.length) return schema.enum[0];
  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const key of schema.required ?? []) {
        const child = schema.properties?.[key];
        if (child) out[key] = blankFor(child);
      }
      return out;
    }
    case "array": return [];
    case "boolean": return false;
    case "number":
    case "integer": return schema.minimum ?? 0;
    default: return "";
  }
}
