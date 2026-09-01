/**
 * Resource ceilings. A manifest is untrusted input: every one of these has a
 * specific error message so a user who trips it knows what to change.
 */
export const LIMITS = {
  manifestBytes: 512 * 1024,
  files: 16,
  relations: 32,
  fields: 512,
  dimensions: 128,
  measures: 256,
  datasets: 64,
  panels: 64,
  interactions: 128,
  actionsPerInteraction: 8,
  filterValues: 5_000,
  datasetLimit: 100_000,
  /** Ceiling on rows x columns for a single query result. */
  resultCells: 2_000_000,
  identifierLength: 64,
  exprLength: 2_000,
  labelLength: 200,
} as const;

export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const IDENTIFIER_HINT =
  "must start with a letter or underscore and contain only letters, digits and underscores";

/**
 * Names that would collide with JavaScript object internals. Gridwright keys
 * records by user-supplied ids in several places, so these are rejected at the
 * door rather than defended against at every lookup.
 */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export function isReservedName(name: string): boolean {
  return RESERVED_NAMES.has(name);
}
