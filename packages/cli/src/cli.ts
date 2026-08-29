import { writeFile } from "node:fs/promises";
import { manifestJsonSchema } from "@gridwright/schema";
import { FUNCTIONS, FUNCTION_NAMES, describeArity } from "@gridwright/expr";
import { Engine, planToSql, sourceFromText } from "@gridwright/engine";
import { defaultRegistry } from "@gridwright/panels";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseManifest } from "@gridwright/schema";
import { renderReport, validateFile } from "./validate.js";

export interface CliResult {
  code: number;
  out: string[];
  err: string[];
}

const USAGE = `gridwright — build dashboards from a manifest

Usage:
  gridwright validate <file.gw.yaml> [--data]   Check a manifest; --data also runs every dataset
  gridwright explain <file.gw.yaml> [dataset]   Show the compiled query plan as SQL
  gridwright functions                          List the expression functions
  gridwright panels                             List the registered panel types
  gridwright schema [--out <file>]              Emit the manifest JSON Schema
  gridwright --version
`;

const VERSION = "0.1.0";

export async function runCli(argv: readonly string[]): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];
  const [command, ...rest] = argv;

  const flag = (name: string) => rest.includes(`--${name}`);
  const value = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const positional = rest.filter((a) => !a.startsWith("--") && rest[rest.indexOf(a) - 1] !== "--out");

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      out.push(USAGE);
      return { code: 0, out, err };

    case "--version":
    case "-v":
      out.push(VERSION);
      return { code: 0, out, err };

    case "validate": {
      const file = positional[0];
      if (!file) {
        err.push("validate needs a manifest path");
        return { code: 2, out, err };
      }
      const report = await validateFile(file, { withData: flag("data") });
      (report.ok ? out : err).push(renderReport(file, report));
      return { code: report.ok ? 0 : 1, out, err };
    }

    case "explain": {
      const file = positional[0];
      if (!file) {
        err.push("explain needs a manifest path");
        return { code: 2, out, err };
      }
      const parsed = parseManifest(await readFile(file, "utf8"));
      if (!parsed.ok) {
        err.push(renderReport(file, { ok: false, issues: parsed.issues, datasets: [], checkedData: false }));
        return { code: 1, out, err };
      }
      const names = positional[1] ? [positional[1]] : Object.keys(parsed.manifest.datasets);
      const engine = new Engine(parsed.manifest, {
        name: "plan-only",
        capabilities: () => ({ windowFunctions: true, pushdownLimit: true, maxRows: 0 }),
        introspect: async () => [],
        execute: async () => { throw new Error("explain does not execute"); },
      });
      for (const name of names) {
        out.push(`-- ${name}`);
        out.push(planToSql(engine.plan(name)));
        out.push("");
      }
      return { code: 0, out, err };
    }

    case "functions": {
      out.push("Expression functions:");
      for (const name of FUNCTION_NAMES) {
        const spec = FUNCTIONS[name]!;
        out.push(
          `  ${name.padEnd(14)} ${spec.stage.padEnd(10)} ${describeArity(spec).padEnd(4)} ${spec.doc}`,
        );
      }
      out.push("  measure        special    1    Reference another measure by id.");
      return { code: 0, out, err };
    }

    case "panels": {
      const reg = defaultRegistry();
      out.push("Panel types:");
      for (const spec of reg.all()) {
        out.push(`  ${spec.type.padEnd(8)} ${spec.label.padEnd(12)} ${spec.description}`);
      }
      return { code: 0, out, err };
    }

    case "schema": {
      const json = JSON.stringify(manifestJsonSchema(), null, 2);
      const target = value("out");
      if (target) {
        await writeFile(target, `${json}\n`, "utf8");
        out.push(`wrote ${target}`);
      } else {
        out.push(json);
      }
      return { code: 0, out, err };
    }

    default:
      err.push(`unknown command "${command}"`);
      err.push(USAGE);
      return { code: 2, out, err };
  }
}

/** Used by `explain` and the docs; kept here so the CLI is the only Node entry. */
export async function loadManifestDir(path: string): Promise<string> {
  return dirname(resolve(path));
}

export { sourceFromText };
