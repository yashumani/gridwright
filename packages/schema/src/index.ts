import { parse as parseYaml } from "yaml";
import { manifestSchema } from "./manifest-schema.js";
import { checkSemantics, type SemanticOptions } from "./semantics.js";
import { LATEST_VERSION, migrate } from "./migrate.js";
import { LIMITS } from "./limits.js";
import type { Issue } from "./validate.js";
import type { Manifest } from "./types.js";

export * from "./types.js";
export * from "./validate.js";
export { LIMITS, IDENTIFIER, IDENTIFIER_HINT, RESERVED_NAMES, isReservedName } from "./limits.js";
export { manifestSchema, manifestJsonSchema } from "./manifest-schema.js";
export { checkSemantics } from "./semantics.js";
export { LATEST_VERSION, migrate } from "./migrate.js";

export type ValidateResult =
  | { ok: true; manifest: Manifest; issues: [] }
  | { ok: false; manifest?: undefined; issues: Issue[] };

export interface ValidateOptions extends SemanticOptions {
  /** Skip cross-reference checks; structural only. Used by the builder mid-edit. */
  structuralOnly?: boolean;
}

/** Validates an already-parsed object. Migrates it to the current version first. */
export function validateManifest(input: unknown, o: ValidateOptions = {}): ValidateResult {
  const migrated = migrate(input);
  if (migrated.issues.length) return { ok: false, issues: migrated.issues };

  const issues: Issue[] = [];
  manifestSchema.check(migrated.raw, "", issues);
  if (issues.length) return { ok: false, issues };

  const manifest = migrated.raw as unknown as Manifest;
  if (!o.structuralOnly) {
    const semantic = checkSemantics(manifest, o);
    if (semantic.length) return { ok: false, issues: semantic };
  }
  return { ok: true, manifest, issues: [] };
}

/** Parses YAML or JSON text, then validates. Enforces the size ceiling first. */
export function parseManifest(text: string, o: ValidateOptions = {}): ValidateResult {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > LIMITS.manifestBytes) {
    return {
      ok: false,
      issues: [{
        path: "(root)",
        message: `manifest is ${bytes} bytes, over the ${LIMITS.manifestBytes} byte limit`,
      }],
    };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(text, { maxAliasCount: 100 });
  } catch (err) {
    return {
      ok: false,
      issues: [{ path: "(root)", message: `could not parse: ${(err as Error).message}` }],
    };
  }
  return validateManifest(parsed, o);
}

/** Renders issues as a readable, stable block. Used by the CLI and the UI. */
export function formatIssues(issues: readonly Issue[]): string {
  return issues.map((i) => `  ${i.path}: ${i.message}`).join("\n");
}

export const CURRENT_VERSION = LATEST_VERSION;
