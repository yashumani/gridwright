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

export interface FieldSuggestions {
  /** Column ids offered wherever a schema expects a reference. */
  refs?: readonly string[];
}

export interface PropertyFormProps {
  schema: JsonSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  suggestions?: FieldSuggestions;
  label?: string;
  path?: string;
}

const humanise = (key: string): string =>
  key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Keys whose value names a dataset column, so the control can offer a list. */
const REF_KEYS = new Set(["measure", "value", "delta", "ref", "x", "category", "dimension"]);

export function PropertyForm({
  schema, value, onChange, suggestions, label, path = "",
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
          <option value="">—</option>
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
      const entries = Object.entries(schema.properties ?? {});
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
      // A field that names a column gets the dataset's columns as a datalist,
      // which is the difference between guessing an id and picking one.
      const refs = REF_KEYS.has(leafKey) ? suggestions?.refs : undefined;
      const listId = refs ? `${id}-refs` : undefined;
      return (
        <Row label={label} htmlFor={id}>
          <input
            id={id}
            className="gwb-input"
            type="text"
            list={listId}
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
          {refs && (
            <datalist id={listId}>
              {refs.map((r) => <option key={r} value={r} />)}
            </datalist>
          )}
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
