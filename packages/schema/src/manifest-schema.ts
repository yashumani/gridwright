import {
  arr, bool, enum_, json, lit, num, obj, opt, rec, str, union, variant,
  type Validator,
} from "./validate.js";
import { IDENTIFIER, IDENTIFIER_HINT, LIMITS, isReservedName } from "./limits.js";

const identBase = () =>
  str({ pattern: IDENTIFIER, patternHint: IDENTIFIER_HINT, maxLength: LIMITS.identifierLength });

/** An identifier that additionally may not collide with object internals. */
const ident = (): Validator<string> => {
  const base = identBase();
  return {
    check(value, path, out) {
      base.check(value, path, out);
      if (typeof value === "string" && isReservedName(value)) {
        out.push({ path: path || "(root)", message: `"${value}" is a reserved name` });
      }
    },
    jsonSchema: () => base.jsonSchema(),
  };
};

const label = () => str({ maxLength: LIMITS.labelLength });

const scalar = () => union([str(), num(), bool()] as const);

const fileRef = obj({
  id: ident(),
  path: str({ minLength: 1, maxLength: 1024 }),
  format: opt(enum_(["csv", "tsv", "json"] as const)),
});

const tableColumn = () =>
  str({
    pattern: /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_ ]*$/,
    patternHint: 'must be "table.column"',
    maxLength: 2 * LIMITS.identifierLength + 1,
  });

const relation = obj({
  left: tableColumn(),
  right: tableColumn(),
  cardinality: opt(enum_(["many-to-one", "one-to-one"] as const)),
});

const source = obj({
  kind: lit("file"),
  files: arr(fileRef, { min: 1, max: LIMITS.files }),
  relations: opt(arr(relation, { max: LIMITS.relations })),
});

const field = obj({
  name: ident(),
  type: enum_(["string", "number", "date", "boolean"] as const),
  from: tableColumn(),
});

const dimension = obj({
  id: ident(),
  field: ident(),
  label: opt(label()),
  grain: opt(enum_(["year", "quarter", "month", "week", "day"] as const)),
});

const measure = obj({
  id: ident(),
  label: opt(label()),
  expr: str({ minLength: 1, maxLength: LIMITS.exprLength }),
  format: opt(str({ maxLength: 64 })),
});

const model = obj({
  fields: arr(field, { min: 1, max: LIMITS.fields }),
  dimensions: arr(dimension, { max: LIMITS.dimensions }),
  measures: arr(measure, { max: LIMITS.measures }),
});

const filter: Validator<unknown> = variant("op", {
  in: obj({ dimension: ident(), op: lit("in"), values: arr(union([scalar()] as const), { max: LIMITS.filterValues }) }),
  between: obj({ dimension: ident(), op: lit("between"), from: union([str(), num()] as const), to: union([str(), num()] as const) }),
  eq: obj({ dimension: ident(), op: lit("eq"), value: scalar() }),
  ne: obj({ dimension: ident(), op: lit("ne"), value: scalar() }),
  gt: obj({ dimension: ident(), op: lit("gt"), value: scalar() }),
  gte: obj({ dimension: ident(), op: lit("gte"), value: scalar() }),
  lt: obj({ dimension: ident(), op: lit("lt"), value: scalar() }),
  lte: obj({ dimension: ident(), op: lit("lte"), value: scalar() }),
});

const sortDir = opt(enum_(["asc", "desc"] as const));
const sort = union(
  [
    obj({ measure: ident(), dir: sortDir }),
    obj({ dimension: ident(), dir: sortDir }),
  ] as const,
  "a sort on either { measure } or { dimension }",
);

const dataset = obj({
  dimensions: opt(arr(ident(), { max: LIMITS.dimensions })),
  measures: arr(ident(), { max: LIMITS.measures }),
  filters: opt(arr(filter, { max: LIMITS.dimensions })),
  sort: opt(arr(sort, { max: 8 })),
  limit: opt(num({ integer: true, min: 1, max: LIMITS.datasetLimit })),
});

const panel = obj({
  id: ident(),
  type: str({ pattern: /^[a-z][a-z0-9-]*$/, patternHint: "must be lowercase kebab-case", maxLength: 48 }),
  dataset: ident(),
  title: opt(label()),
  layout: obj({
    x: num({ integer: true, min: 0, max: 64 }),
    y: num({ integer: true, min: 0, max: 4096 }),
    w: num({ integer: true, min: 1, max: 64 }),
    h: num({ integer: true, min: 1, max: 256 }),
  }),
  // Validated against the panel's own schema by @gridwright/panels, not here.
  props: opt(rec(json())),
});

const action = variant("action", {
  filter: obj({
    action: lit("filter"),
    dimension: ident(),
    from: opt(enum_(["row", "value"] as const)),
  }),
  clearFilters: obj({ action: lit("clearFilters"), dimension: opt(ident()) }),
});

const interaction = obj({
  on: str({
    pattern: /^[A-Za-z_][A-Za-z0-9_]*\.[a-zA-Z]+$/,
    patternHint: 'must be "panelId.event"',
    maxLength: 128,
  }),
  do: arr(action, { min: 1, max: LIMITS.actionsPerInteraction }),
});

export const manifestSchema = obj({
  gridwright: num({ integer: true, min: 1 }),
  title: opt(label()),
  source,
  model,
  datasets: rec(dataset, { keyPattern: IDENTIFIER, keyHint: `dataset name ${IDENTIFIER_HINT}`, max: LIMITS.datasets }),
  panels: arr(panel, { max: LIMITS.panels }),
  interactions: opt(arr(interaction, { max: LIMITS.interactions })),
  grid: opt(
    obj({
      columns: opt(num({ integer: true, min: 1, max: 64 })),
      rowHeight: opt(num({ integer: true, min: 8, max: 512 })),
      gap: opt(num({ integer: true, min: 0, max: 64 })),
    }),
  ),
  theme: opt(
    obj({
      preset: opt(str({ maxLength: 48 })),
      colors: opt(arr(str({ pattern: /^#[0-9a-fA-F]{3,8}$/, patternHint: "must be a hex colour" }), { max: 32 })),
    }),
  ),
});

/** JSON Schema mirror of the validator above, for editors and external tooling. */
export function manifestJsonSchema(): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://gridwright.dev/schema/v1/manifest.json",
    title: "Gridwright manifest v1",
    ...manifestSchema.jsonSchema(),
  };
}
