import type { Issue } from "./validate.js";

/**
 * The manifest format will change. Every version bump lands a step here, so an
 * old file keeps working instead of becoming a support ticket.
 *
 * A step takes the raw parsed object at version N and returns it at N+1. Steps
 * run before validation, so they must tolerate shapes that are merely
 * plausible — never assume a field is well-formed.
 */
export const LATEST_VERSION = 1;

type Step = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version being migrated *from*. */
const STEPS: Record<number, Step> = {
  // 1 -> 2 goes here when v2 exists.
};

export interface MigrateResult {
  raw: Record<string, unknown>;
  from: number;
  to: number;
  applied: number[];
  issues: Issue[];
}

export function migrate(input: unknown): MigrateResult {
  const issues: Issue[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      raw: {}, from: 0, to: LATEST_VERSION, applied: [],
      issues: [{ path: "(root)", message: "manifest must be an object" }],
    };
  }

  let raw = { ...(input as Record<string, unknown>) };
  const declared = raw["gridwright"];

  if (declared === undefined) {
    issues.push({
      path: "gridwright",
      message: `missing version key — add "gridwright: ${LATEST_VERSION}" at the top of the file`,
    });
    return { raw, from: 0, to: LATEST_VERSION, applied: [], issues };
  }
  if (typeof declared !== "number" || !Number.isInteger(declared) || declared < 1) {
    issues.push({ path: "gridwright", message: "version must be a positive integer" });
    return { raw, from: 0, to: LATEST_VERSION, applied: [], issues };
  }
  if (declared > LATEST_VERSION) {
    issues.push({
      path: "gridwright",
      message: `manifest is version ${declared} but this build understands up to ${LATEST_VERSION} — upgrade Gridwright`,
    });
    return { raw, from: declared, to: declared, applied: [], issues };
  }

  const applied: number[] = [];
  let version = declared;
  while (version < LATEST_VERSION) {
    const step = STEPS[version];
    if (!step) {
      issues.push({
        path: "gridwright",
        message: `no migration registered from version ${version} to ${version + 1}`,
      });
      break;
    }
    raw = step(raw);
    applied.push(version);
    version += 1;
    raw["gridwright"] = version;
  }

  return { raw, from: declared, to: version, applied, issues };
}
