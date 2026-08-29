import { parseManifest, type Issue, type Manifest } from "@gridwright/schema";
import { analyzeExpression } from "@gridwright/expr";
import { Engine } from "./engine.js";
import { sourceFromText, type TableText } from "./index.js";
import { loadBlob, typesForTable, verifyColumns, type LoadOptions } from "./csv.js";
import { MemorySource } from "./memory-source.js";
import type { DataSource, Table } from "./types.js";

/**
 * Turning a pile of dropped files into a running dashboard.
 *
 * The awkward part is matching a manifest's `./sales.csv` to a File the user
 * dragged in, which arrives with a bare name and no path. Matching on basename
 * — case-insensitively, and falling back to a sole unmatched file — is what
 * makes "drop a manifest and a CSV" work without asking anyone to think about
 * directory layout.
 */
export interface BundleFile {
  name: string;
  text: string;
}

/** A file supplied as a stream rather than a string, for large uploads. */
export interface BundleBlob {
  name: string;
  blob: Blob;
}

export type BundleResult =
  | { ok: true; manifest: Manifest; source: DataSource; engine: Engine; issues: [] }
  | { ok: false; manifest?: Manifest; issues: Issue[] };

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;
const normalise = (p: string): string => basename(p).trim().toLowerCase();

/**
 * Pairs each declared table with one of the supplied files, by name.
 *
 * Generic over what a "file" carries, so the string path and the streaming
 * path share exactly one matching rule and cannot drift apart.
 */
export function matchFiles<T extends { name: string }>(
  manifest: Manifest,
  files: readonly T[],
): { matched: Map<string, T>; issues: Issue[] } {
  const matched = new Map<string, T>();
  const issues: Issue[] = [];
  const remaining = new Map(files.map((f) => [normalise(f.name), f]));

  for (const decl of manifest.source.files) {
    const byPath = remaining.get(normalise(decl.path));
    const byId = remaining.get(normalise(`${decl.id}.csv`)) ?? remaining.get(normalise(decl.id));
    const hit = byPath ?? byId;
    if (hit) {
      matched.set(decl.id, hit);
      remaining.delete(normalise(hit.name));
      continue;
    }
    // One table, one leftover file: the intent is unambiguous.
    if (manifest.source.files.length === 1 && remaining.size === 1) {
      const only = [...remaining.values()][0]!;
      matched.set(decl.id, only);
      remaining.clear();
      continue;
    }
    issues.push({
      path: "source.files",
      message:
        `no file supplied for table "${decl.id}" (expected something named ` +
        `"${basename(decl.path)}")`,
    });
  }

  return { matched, issues };
}

/** Matches each declared table to one of the supplied files. */
export function resolveFiles(
  manifest: Manifest,
  files: readonly BundleFile[],
): { text: TableText; issues: Issue[] } {
  const { matched, issues } = matchFiles(manifest, files);
  const text: TableText = Object.create(null);
  for (const [id, file] of matched) text[id] = file.text;
  return { text, issues };
}

/**
 * Validates a manifest, matches its data files, and returns a ready engine.
 * Every failure is an issue list — nothing here throws at the caller.
 */
export function loadBundle(manifestText: string, files: readonly BundleFile[]): BundleResult {
  const parsed = parseManifest(manifestText, {
    checkExpression: (expr) => analyzeExpression(expr).issues,
  });
  if (!parsed.ok) return { ok: false, issues: parsed.issues };

  const manifest = parsed.manifest;
  const { text, issues } = resolveFiles(manifest, files);
  if (issues.length) return { ok: false, manifest, issues };

  try {
    const source = sourceFromText(manifest, text);
    return { ok: true, manifest, source, engine: new Engine(manifest, source), issues: [] };
  } catch (err) {
    const e = err as Error & { detail?: string };
    return {
      ok: false,
      manifest,
      issues: [{ path: "source", message: e.detail ? `${e.message} — ${e.detail}` : e.message }],
    };
  }
}


export interface LoadBlobsOptions {
  /** Refuse a file with more rows than this, rather than exhausting memory. */
  maxRows?: number;
}

/**
 * The large-upload path: validates the manifest, then streams each data file
 * straight into columns.
 *
 * A ten-million-row CSV is about a gigabyte. Reading it with `File.text()`
 * first would need the whole thing as one string, which is where the tab dies —
 * so nothing here ever sees the raw text whole.
 */
export async function loadBundleFromBlobs(
  manifestText: string,
  files: readonly BundleBlob[],
  o: LoadBlobsOptions = {},
): Promise<BundleResult> {
  const parsed = parseManifest(manifestText, {
    checkExpression: (expr) => analyzeExpression(expr).issues,
  });
  if (!parsed.ok) return { ok: false, issues: parsed.issues };

  const manifest = parsed.manifest;
  const { matched, issues } = matchFiles(manifest, files);
  if (issues.length) return { ok: false, manifest, issues };

  try {
    const tables: Table[] = [];
    for (const decl of manifest.source.files) {
      const hit = matched.get(decl.id)!;
      const options: LoadOptions = {
        delimiter: decl.format === "tsv" ? "\t" : ",",
        types: typesForTable(manifest, decl.id),
        ...(o.maxRows !== undefined ? { maxRows: o.maxRows } : {}),
      };
      tables.push(await loadBlob(decl.id, hit.blob, options));
    }
    verifyColumns(manifest, tables);
    const source = MemorySource.fromTables(tables);
    return { ok: true, manifest, source, engine: new Engine(manifest, source), issues: [] };
  } catch (err) {
    const e = err as Error & { detail?: string };
    return {
      ok: false,
      manifest,
      issues: [{ path: "source", message: e.detail ? `${e.message} — ${e.detail}` : e.message }],
    };
  }
}
