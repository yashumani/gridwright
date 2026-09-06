import { readWorkbook, type WorkbookRead } from "./xlsx.js";
import {
  resolveBindings,
  type BindingSpec,
  type MetadataSnapshot,
  type Problem,
} from "./bindings.js";
import { compileReport, type CalculatedRow, type ReportDefinition } from "./compile.js";
import type { ViewRow } from "./fill.js";

/**
 * Revisions of a report's configuration: revise, validate, preview, roll back,
 * export and reopen.
 *
 * R16 makes one thing the axis of the whole design: **source configuration is
 * authoritative, and a generated runtime definition is not a second
 * unsynchronised authoring source.** So a revision stores the workbook,
 * metadata and bindings — the things a person edits — and the definition is
 * always derived from them, never stored as something that could be edited
 * on its own and drift.
 *
 * The other half is that **an invalid draft is kept apart from the last valid
 * version.** A configuration author who breaks a formula should see what they
 * broke, and everyone reading the report should keep seeing the last version
 * that worked. Overwriting the good one with the broken one loses both.
 * `current` is what was last submitted; `lastValid` is what still compiles;
 * `preview()` reads the second, so a half-finished edit never blanks a screen.
 */

/** Everything a person authors. The definition is derived from this, not stored. */
export interface ConfigurationSource {
  /** The workbook, as bytes, so a package round-trips the real file. */
  workbook: Uint8Array;
  metadata: MetadataSnapshot;
  bindings: BindingSpec;
  calculated?: CalculatedRow[];
}

export type RevisionStatus = "valid" | "invalid";

export interface Revision {
  version: number;
  at: string;
  status: RevisionStatus;
  source: ConfigurationSource;
  /** Present only when the revision compiles. Derived, never authored. */
  definition?: ReportDefinition;
  /** Present only when it does not. */
  problems?: Problem[];
}

/** A configuration package, for moving a report between environments. */
export interface ConfigurationPackage {
  formatVersion: 1;
  exportedAt: string;
  version: number;
  /** Which metadata snapshot the configuration was written against. */
  snapshot: { source: string; capturedAt: string; version: string };
  workbookBase64: string;
  metadata: MetadataSnapshot;
  bindings: BindingSpec;
  calculated: CalculatedRow[];
  /**
   * Always present, never inferred. R27 wants data inclusion to be an explicit
   * choice, and a reader should not have to notice a missing key to learn that
   * a package carries business data.
   */
  dataIncluded: boolean;
  rows?: ViewRow[];
}

export interface ExportOptions {
  /** Explicitly include the view's rows. Off unless asked. */
  includeData?: boolean;
  rows?: readonly ViewRow[];
}

export class RevisionError extends Error {
  readonly problems: Problem[];
  constructor(message: string, problems: Problem[]) {
    super(message);
    this.name = "RevisionError";
    this.problems = problems;
  }
}

/** Validates one configuration, returning its definition or its problems. */
export function validateConfiguration(
  source: ConfigurationSource,
): { ok: true; definition: ReportDefinition; workbook: WorkbookRead } | { ok: false; problems: Problem[] } {
  let workbook: WorkbookRead;
  try {
    workbook = readWorkbook(source.bindings.workbook, source.workbook);
  } catch (e) {
    return {
      ok: false,
      problems: [{ code: "skeleton-unreadable", message: (e as Error).message }],
    };
  }

  const resolved = resolveBindings(workbook, source.metadata, source.bindings);
  if (!resolved.ok) return { ok: false, problems: resolved.problems };

  const compiled = compileReport(workbook, resolved.resolution, {
    calculated: source.calculated,
  });
  if (!compiled.ok) return { ok: false, problems: compiled.problems };

  return { ok: true, definition: compiled.definition, workbook };
}

export interface RevisionsOptions {
  /** Injected so a history is reproducible in a test. */
  now?: () => string;
}

export class Revisions {
  private readonly history: Revision[] = [];
  private readonly now: () => string;

  private constructor(first: Revision, now: () => string) {
    this.history.push(first);
    this.now = now;
  }

  /**
   * Opens a report from a configuration that must already be valid. A history
   * whose first entry is broken has nothing to preview and nothing to roll back
   * to, so it is refused rather than created half-formed.
   */
  static open(source: ConfigurationSource, o: RevisionsOptions = {}): Revisions {
    const now = o.now ?? (() => new Date().toISOString());
    const result = validateConfiguration(source);
    if (!result.ok) {
      throw new RevisionError(
        "the initial configuration does not compile, so there is nothing to open",
        result.problems,
      );
    }
    return new Revisions(
      { version: 1, at: now(), status: "valid", source, definition: result.definition },
      now,
    );
  }

  /** Every revision, oldest first, drafts included. */
  all(): readonly Revision[] {
    return this.history;
  }

  /** The most recent revision, valid or not. */
  current(): Revision {
    return this.history[this.history.length - 1]!;
  }

  /** The most recent revision that compiles. Never undefined: opening required one. */
  lastValid(): Revision {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const r = this.history[i]!;
      if (r.status === "valid") return r;
    }
    // Unreachable: `open` refuses an invalid first revision.
    throw new RevisionError("no valid revision", []);
  }

  /**
   * What to show. Deliberately the last valid definition rather than the
   * current one — a broken draft is the author's problem to see in
   * `current().problems`, not everyone else's blank screen.
   */
  preview(): ReportDefinition {
    return this.lastValid().definition!;
  }

  /**
   * Submits an edited configuration. A revision is always recorded, whether or
   * not it compiles, so a broken draft is preserved for its author rather than
   * discarded — and `lastValid` does not move when it fails.
   */
  revise(source: ConfigurationSource): Revision {
    const result = validateConfiguration(source);
    const revision: Revision =
      result.ok
        ? {
            version: this.history.length + 1,
            at: this.now(),
            status: "valid",
            source,
            definition: result.definition,
          }
        : {
            version: this.history.length + 1,
            at: this.now(),
            status: "invalid",
            source,
            problems: result.problems,
          };
    this.history.push(revision);
    return revision;
  }

  /**
   * Discards revisions after the last valid one, returning what is now current.
   *
   * Rolling back past a valid revision is a different operation from abandoning
   * a broken draft, and conflating them loses work silently — so this only
   * removes drafts that never compiled.
   */
  rollback(): Revision {
    while (this.history.length > 1 && this.current().status === "invalid") {
      this.history.pop();
    }
    return this.current();
  }

  /**
   * A portable configuration package.
   *
   * Data is excluded unless asked for, and `dataIncluded` is written either
   * way: R27 wants the choice explicit, and a reader should not have to notice
   * a missing key to learn whether business data travelled with it.
   */
  export(o: ExportOptions = {}): ConfigurationPackage {
    const revision = this.lastValid();
    const includeData = o.includeData === true;
    if (includeData && !o.rows) {
      throw new RevisionError("includeData was asked for but no rows were supplied", []);
    }
    return {
      formatVersion: 1,
      exportedAt: this.now(),
      version: revision.version,
      snapshot: revision.definition!.snapshot,
      workbookBase64: Buffer.from(revision.source.workbook).toString("base64"),
      metadata: revision.source.metadata,
      bindings: revision.source.bindings,
      calculated: revision.source.calculated ?? [],
      dataIncluded: includeData,
      ...(includeData ? { rows: [...o.rows!] } : {}),
    };
  }

  /** Reopens an exported package as a fresh history. */
  static reopen(pkg: ConfigurationPackage, o: RevisionsOptions = {}): Revisions {
    if (pkg.formatVersion !== 1) {
      throw new RevisionError(
        `configuration package format ${pkg.formatVersion} is not supported`,
        [],
      );
    }
    return Revisions.open(
      {
        workbook: Buffer.from(pkg.workbookBase64, "base64"),
        metadata: pkg.metadata,
        bindings: pkg.bindings,
        calculated: pkg.calculated,
      },
      o,
    );
  }
}
