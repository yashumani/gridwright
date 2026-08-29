/**
 * A tiny structural validator built from combinators.
 *
 * Two jobs, one definition: `check` produces precise, path-anchored issues for
 * humans, and `jsonSchema` emits an equivalent JSON Schema for editor tooling.
 * Keeping both on the same object is what stops the two drifting apart.
 */

export interface Issue {
  /** Dotted/bracketed path to the offending value, e.g. `panels[2].props.ref`. */
  path: string;
  message: string;
}

export interface Validator<T = unknown> {
  check(value: unknown, path: string, out: Issue[]): void;
  jsonSchema(): Record<string, unknown>;
  /** Present only on validators produced by `opt`. */
  readonly isOptional?: boolean;
  /** Phantom type carrier — never read at runtime. */
  readonly _type?: T;
}

export type Infer<V> = V extends Validator<infer T> ? T : never;

const push = (out: Issue[], path: string, message: string) => {
  out.push({ path: path || "(root)", message });
};

const typeName = (v: unknown): string => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
};

/** Marks a validator as optional inside `obj`. Does not change `check`. */
export function opt<T>(v: Validator<T>): Validator<T | undefined> {
  return {
    check: (value, path, out) => v.check(value, path, out),
    jsonSchema: () => v.jsonSchema(),
    isOptional: true,
  };
}

export interface StrOpts {
  minLength?: number;
  maxLength?: number;
  /** Anchored automatically — supply the inner pattern only. */
  pattern?: RegExp;
  patternHint?: string;
}

export function str(o: StrOpts = {}): Validator<string> {
  return {
    check(value, path, out) {
      if (typeof value !== "string") {
        return push(out, path, `expected string, got ${typeName(value)}`);
      }
      if (o.minLength !== undefined && value.length < o.minLength) {
        push(out, path, `string is shorter than ${o.minLength} characters`);
      }
      if (o.maxLength !== undefined && value.length > o.maxLength) {
        push(out, path, `string exceeds ${o.maxLength} characters`);
      }
      if (o.pattern && !o.pattern.test(value)) {
        push(out, path, o.patternHint ?? `does not match ${String(o.pattern)}`);
      }
    },
    jsonSchema() {
      const s: Record<string, unknown> = { type: "string" };
      if (o.minLength !== undefined) s["minLength"] = o.minLength;
      if (o.maxLength !== undefined) s["maxLength"] = o.maxLength;
      if (o.pattern) s["pattern"] = o.pattern.source;
      return s;
    },
  };
}

export interface NumOpts {
  min?: number;
  max?: number;
  integer?: boolean;
}

export function num(o: NumOpts = {}): Validator<number> {
  return {
    check(value, path, out) {
      if (typeof value !== "number" || Number.isNaN(value)) {
        return push(out, path, `expected number, got ${typeName(value)}`);
      }
      if (!Number.isFinite(value)) return push(out, path, "number must be finite");
      if (o.integer && !Number.isInteger(value)) push(out, path, "expected an integer");
      if (o.min !== undefined && value < o.min) push(out, path, `must be >= ${o.min}`);
      if (o.max !== undefined && value > o.max) push(out, path, `must be <= ${o.max}`);
    },
    jsonSchema() {
      const s: Record<string, unknown> = { type: o.integer ? "integer" : "number" };
      if (o.min !== undefined) s["minimum"] = o.min;
      if (o.max !== undefined) s["maximum"] = o.max;
      return s;
    },
  };
}

export function bool(): Validator<boolean> {
  return {
    check(value, path, out) {
      if (typeof value !== "boolean") push(out, path, `expected boolean, got ${typeName(value)}`);
    },
    jsonSchema: () => ({ type: "boolean" }),
  };
}

export function nul(): Validator<null> {
  return {
    check(value, path, out) {
      if (value !== null) push(out, path, `expected null, got ${typeName(value)}`);
    },
    jsonSchema: () => ({ type: "null" }),
  };
}

export function lit<const T extends string | number | boolean>(v: T): Validator<T> {
  return {
    check(value, path, out) {
      if (value !== v) push(out, path, `expected ${JSON.stringify(v)}`);
    },
    jsonSchema: () => ({ const: v }),
  };
}

export function enum_<const T extends readonly string[]>(values: T): Validator<T[number]> {
  return {
    check(value, path, out) {
      if (typeof value !== "string" || !values.includes(value)) {
        push(out, path, `expected one of ${values.map((v) => `"${v}"`).join(", ")}`);
      }
    },
    jsonSchema: () => ({ type: "string", enum: [...values] }),
  };
}

export interface ArrOpts {
  min?: number;
  max?: number;
}

export function arr<T>(item: Validator<T>, o: ArrOpts = {}): Validator<T[]> {
  return {
    check(value, path, out) {
      if (!Array.isArray(value)) {
        return push(out, path, `expected array, got ${typeName(value)}`);
      }
      if (o.min !== undefined && value.length < o.min) {
        push(out, path, `expected at least ${o.min} item(s), got ${value.length}`);
      }
      if (o.max !== undefined && value.length > o.max) {
        push(out, path, `expected at most ${o.max} item(s), got ${value.length}`);
      }
      value.forEach((el, i) => item.check(el, `${path}[${i}]`, out));
    },
    jsonSchema() {
      const s: Record<string, unknown> = { type: "array", items: item.jsonSchema() };
      if (o.min !== undefined) s["minItems"] = o.min;
      if (o.max !== undefined) s["maxItems"] = o.max;
      return s;
    },
  };
}

type Shape = Record<string, Validator<unknown>>;

type ObjType<S extends Shape> = { [K in keyof S]: Infer<S[K]> };

export interface ObjOpts {
  /** Unknown keys are rejected by default; manifests are untrusted input. */
  allowUnknown?: boolean;
}

export function obj<S extends Shape>(shape: S, o: ObjOpts = {}): Validator<ObjType<S>> {
  return {
    check(value, path, out) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return push(out, path, `expected object, got ${typeName(value)}`);
      }
      const rec = value as Record<string, unknown>;
      for (const [key, v] of Object.entries(shape)) {
        const child = path ? `${path}.${key}` : key;
        if (!(key in rec) || rec[key] === undefined) {
          if (!v.isOptional) push(out, child, "required property is missing");
          continue;
        }
        v.check(rec[key], child, out);
      }
      if (!o.allowUnknown) {
        for (const key of Object.keys(rec)) {
          if (!Object.hasOwn(shape, key)) {
            push(out, path ? `${path}.${key}` : key, `unknown property "${key}"`);
          }
        }
      }
    },
    jsonSchema() {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, v] of Object.entries(shape)) {
        properties[key] = v.jsonSchema();
        if (!v.isOptional) required.push(key);
      }
      const s: Record<string, unknown> = { type: "object", properties };
      if (required.length) s["required"] = required;
      if (!o.allowUnknown) s["additionalProperties"] = false;
      return s;
    },
  };
}

/**
 * Keys that both JSON.parse and the YAML parser materialise as real own
 * properties, and that would corrupt any record we key by a user-supplied id.
 * Rejected in every map, unconditionally — no manifest needs them.
 */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** A string-keyed map with uniformly typed values. */
export function rec<T>(
  value: Validator<T>,
  o: { keyPattern?: RegExp; keyHint?: string; max?: number } = {},
): Validator<Record<string, T>> {
  return {
    check(v, path, out) {
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        return push(out, path, `expected object, got ${typeName(v)}`);
      }
      const entries = Object.entries(v as Record<string, unknown>);
      if (o.max !== undefined && entries.length > o.max) {
        push(out, path, `expected at most ${o.max} entries, got ${entries.length}`);
      }
      for (const [k, val] of entries) {
        const child = path ? `${path}.${k}` : k;
        if (UNSAFE_KEYS.has(k)) {
          push(out, child, `"${k}" is a reserved name and cannot be used as a key`);
          continue;
        }
        if (o.keyPattern && !o.keyPattern.test(k)) {
          push(out, child, o.keyHint ?? `key "${k}" does not match ${String(o.keyPattern)}`);
        }
        value.check(val, child, out);
      }
    },
    jsonSchema() {
      const s: Record<string, unknown> = { type: "object", additionalProperties: value.jsonSchema() };
      if (o.keyPattern) s["propertyNames"] = { pattern: o.keyPattern.source };
      return s;
    },
  };
}

/**
 * An untagged union. Reports the branch that got furthest (fewest issues) so
 * the message points at the likely intent rather than dumping every branch.
 */
export function union<T extends readonly Validator<unknown>[]>(
  variants: T,
  label?: string,
): Validator<Infer<T[number]>> {
  return {
    check(value, path, out) {
      let best: Issue[] | undefined;
      for (const v of variants) {
        const local: Issue[] = [];
        v.check(value, path, local);
        if (local.length === 0) return;
        if (!best || local.length < best.length) best = local;
      }
      if (label) push(out, path, `does not match ${label}`);
      if (best) out.push(...best);
    },
    jsonSchema: () => ({ anyOf: variants.map((v) => v.jsonSchema()) }),
  };
}

/**
 * A tagged union keyed on a discriminant property. Produces far better errors
 * than `union` when the shape is known from one field.
 */
export function variant<K extends string>(
  key: K,
  cases: Record<string, Validator<unknown>>,
): Validator<Record<string, unknown>> {
  return {
    check(value, path, out) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return push(out, path, `expected object, got ${typeName(value)}`);
      }
      const tag = (value as Record<string, unknown>)[key];
      if (typeof tag !== "string") {
        return push(out, path ? `${path}.${key}` : key, `required discriminator "${key}" is missing`);
      }
      const branch = cases[tag];
      if (!branch) {
        return push(
          out,
          path ? `${path}.${key}` : key,
          `unknown ${key} "${tag}" — expected one of ${Object.keys(cases).map((c) => `"${c}"`).join(", ")}`,
        );
      }
      branch.check(value, path, out);
    },
    jsonSchema: () => ({ anyOf: Object.values(cases).map((v) => v.jsonSchema()) }),
  };
}

/** Any JSON value. Used for panel `props`, which the panel registry validates. */
export function json(): Validator<unknown> {
  return { check: () => {}, jsonSchema: () => ({}) };
}

/** Defers construction so recursive schemas can reference themselves. */
export function lazy<T>(f: () => Validator<T>): Validator<T> {
  let cached: Validator<T> | undefined;
  const get = () => (cached ??= f());
  return {
    check: (v, path, out) => get().check(v, path, out),
    jsonSchema: () => get().jsonSchema(),
  };
}
