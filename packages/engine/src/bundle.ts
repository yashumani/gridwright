import { parseManifest, type Issue, type Manifest } from "@gridwright/schema";
import { analyzeExpression } from "@gridwright/expr";
import { Engine } from "./engine.js";
import { sourceFromText, type TableText } from "./index.js";
import type { DataSource } from "./types.js";

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

export type BundleResult =
  | { ok: true; manifest: Manifest; source: DataSource; engine: Engine; issues: [] }
  | { ok: false; manifest?: Manifest; issues: Issue[] };

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;
const normalise = (p: string): string => basename(p).trim().toLowerCase();

/** Matches each declared table to one of the supplied files. */
export function resolveFiles(
  manifest: Manifest,
  files: readonly BundleFile[],
): { text: TableText; issues: Issue[] } {
  const text: TableText = Object.create(null);
  const issues: Issue[] = [];
  const remaining = new Map(files.map((f) => [normalise(f.name), f]));

  for (const decl of manifest.source.files) {
    const byPath = remaining.get(normalise(decl.path));
    const byId = remaining.get(normalise(`${decl.id}.csv`)) ?? remaining.get(normalise(decl.id));
    const hit = byPath ?? byId;
    if (hit) {
      text[decl.id] = hit.text;
      remaining.delete(normalise(hit.name));
      continue;
    }
    // One table, one leftover file: the intent is unambiguous.
    if (manifest.source.files.length === 1 && remaining.size === 1) {
      const only = [...remaining.values()][0]!;
      text[decl.id] = only.text;
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
