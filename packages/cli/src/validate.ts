import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  formatIssues, parseManifest, type Issue, type Manifest,
} from "@gridwright/schema";
import { analyzeExpression } from "@gridwright/expr";
import { Engine, sourceFromText, type TableText } from "@gridwright/engine";
import { defaultRegistry } from "@gridwright/panels";

/**
 * Full validation, in the order that gives the most useful first error: shape,
 * then expressions, then panel props, then — when the data is reachable — the
 * columns the manifest claims exist and the queries actually running.
 */
export interface ValidationReport {
  ok: boolean;
  manifest?: Manifest;
  issues: Issue[];
  /** Datasets executed successfully, with their row counts. */
  datasets: Array<{ name: string; rows: number; ms: number }>;
  checkedData: boolean;
}

export interface ValidateFileOptions {
  /** Load the data files and run every dataset. Off for a pure lint. */
  withData?: boolean;
}

export async function validateFile(
  path: string,
  o: ValidateFileOptions = {},
): Promise<ValidationReport> {
  const text = await readFile(path, "utf8");
  const parsed = parseManifest(text, {
    // Measure expressions are checked here so a bad one is reported with the
    // manifest's other issues rather than blowing up at first query.
    checkExpression: (expr) => analyzeExpression(expr).issues,
  });
  if (!parsed.ok) {
    return { ok: false, issues: parsed.issues, datasets: [], checkedData: false };
  }

  const manifest = parsed.manifest;
  const issues: Issue[] = [];

  const registry = defaultRegistry();
  manifest.panels.forEach((p, i) => {
    issues.push(
      ...registry.validateProps(p.type, p.props ?? {}, `panels[${i}].props`),
    );
  });

  if (issues.length) return { ok: false, manifest, issues, datasets: [], checkedData: false };
  if (!o.withData) return { ok: true, manifest, issues: [], datasets: [], checkedData: false };

  // ---- data pass ----
  const base = dirname(resolve(path));
  const text2: TableText = {};
  for (const file of manifest.source.files) {
    try {
      text2[file.id] = await readFile(resolve(base, file.path), "utf8");
    } catch (err) {
      issues.push({
        path: `source.files`,
        message: `could not read "${file.path}" for table "${file.id}": ${(err as Error).message}`,
      });
    }
  }
  if (issues.length) return { ok: false, manifest, issues, datasets: [], checkedData: true };

  const datasets: ValidationReport["datasets"] = [];
  try {
    const engine = new Engine(manifest, sourceFromText(manifest, text2));
    for (const name of Object.keys(manifest.datasets)) {
      try {
        const r = await engine.query(name);
        datasets.push({ name, rows: r.rowCount, ms: r.ms });
      } catch (err) {
        issues.push({ path: `datasets.${name}`, message: (err as Error).message });
      }
    }
  } catch (err) {
    const e = err as Error & { detail?: string };
    issues.push({ path: "source", message: e.detail ? `${e.message}: ${e.detail}` : e.message });
  }

  return { ok: issues.length === 0, manifest, issues, datasets, checkedData: true };
}

export function renderReport(path: string, report: ValidationReport): string {
  const lines: string[] = [];
  if (report.ok) {
    const m = report.manifest!;
    lines.push(`✓ ${path}`);
    lines.push(
      `  ${m.model.fields.length} fields · ${m.model.dimensions.length} dimensions · ` +
      `${m.model.measures.length} measures · ${Object.keys(m.datasets).length} datasets · ` +
      `${m.panels.length} panels`,
    );
    for (const d of report.datasets) {
      lines.push(`  ${d.name}: ${d.rows} row${d.rows === 1 ? "" : "s"} in ${d.ms}ms`);
    }
    if (!report.checkedData) lines.push("  (data not checked — pass --data to run every dataset)");
  } else {
    lines.push(`✗ ${path} — ${report.issues.length} issue${report.issues.length === 1 ? "" : "s"}`);
    lines.push(formatIssues(report.issues));
  }
  return lines.join("\n");
}
