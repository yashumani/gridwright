import type { Issue } from "./validate.js";
import type { Manifest } from "./types.js";

/**
 * Referential integrity, run after the structural pass. Everything here is a
 * cross-reference the shape validator cannot see: an id that parses fine but
 * points at nothing.
 */

const DEFAULT_COLUMNS = 12;

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) (seen.has(id) ? dupes : seen).add(id);
  return [...dupes];
}

export interface SemanticOptions {
  /**
   * Optional hook so callers that have @gridwright/expr loaded can validate
   * measure expressions here. Kept as a hook to avoid a dependency cycle.
   */
  checkExpression?: (expr: string, measureId: string) => Issue[];
}

export function checkSemantics(m: Manifest, o: SemanticOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  const tableIds = new Set(m.source.files.map((f) => f.id));
  for (const dupe of duplicates(m.source.files.map((f) => f.id))) {
    add("source.files", `duplicate file id "${dupe}"`);
  }

  // ---- relations ----
  const relations = m.source.relations ?? [];
  relations.forEach((r, i) => {
    const [leftTable] = r.left.split(".");
    const [rightTable] = r.right.split(".");
    if (!tableIds.has(leftTable!)) {
      add(`source.relations[${i}].left`, `unknown table "${leftTable}"`);
    }
    if (!tableIds.has(rightTable!)) {
      add(`source.relations[${i}].right`, `unknown table "${rightTable}"`);
    }
    if (leftTable === rightTable) {
      add(`source.relations[${i}]`, `a relation cannot join "${leftTable}" to itself`);
    }
  });
  for (const dupe of duplicates(relations.map((r) => {
    const a = r.left.split(".")[0]!;
    const b = r.right.split(".")[0]!;
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }))) {
    add("source.relations", `two relations connect the same pair of tables (${dupe.replace("|", " and ")})`);
  }
  if (m.source.files.length > 1 && relations.length === 0) {
    add(
      "source.relations",
      "more than one table is declared but no relations connect them — " +
      "add a relation, or the planner cannot combine their fields",
    );
  }

  // ---- fields ----
  const fieldsByName = new Map(m.model.fields.map((f) => [f.name, f]));
  for (const dupe of duplicates(m.model.fields.map((f) => f.name))) {
    add("model.fields", `duplicate field name "${dupe}"`);
  }
  m.model.fields.forEach((f, i) => {
    const table = f.from.split(".")[0]!;
    if (!tableIds.has(table)) {
      add(`model.fields[${i}].from`, `unknown table "${table}" — declare it under source.files`);
    }
  });

  // ---- dimensions ----
  const dimIds = new Set(m.model.dimensions.map((d) => d.id));
  for (const dupe of duplicates(m.model.dimensions.map((d) => d.id))) {
    add("model.dimensions", `duplicate dimension id "${dupe}"`);
  }
  m.model.dimensions.forEach((d, i) => {
    const f = fieldsByName.get(d.field);
    if (!f) {
      add(`model.dimensions[${i}].field`, `unknown field "${d.field}"`);
    } else if (d.grain && f.type !== "date") {
      add(`model.dimensions[${i}].grain`, `grain is only valid on date fields; "${d.field}" is ${f.type}`);
    }
  });

  // ---- measures ----
  const measureIds = new Set(m.model.measures.map((x) => x.id));
  for (const dupe of duplicates(m.model.measures.map((x) => x.id))) {
    add("model.measures", `duplicate measure id "${dupe}"`);
  }
  const clash = [...measureIds].filter((id) => dimIds.has(id));
  for (const id of clash) {
    add("model.measures", `"${id}" is used as both a dimension and a measure id`);
  }
  if (o.checkExpression) {
    m.model.measures.forEach((mm, i) => {
      for (const issue of o.checkExpression!(mm.expr, mm.id)) {
        add(`model.measures[${i}].expr`, issue.message);
      }
    });
  }

  // ---- datasets ----
  for (const [name, ds] of Object.entries(m.datasets)) {
    const at = `datasets.${name}`;
    const dsDims = new Set(ds.dimensions ?? []);
    const dsMeasures = new Set(ds.measures);

    (ds.dimensions ?? []).forEach((id, i) => {
      if (!dimIds.has(id)) add(`${at}.dimensions[${i}]`, `unknown dimension "${id}"`);
    });
    ds.measures.forEach((id, i) => {
      if (!measureIds.has(id)) add(`${at}.measures[${i}]`, `unknown measure "${id}"`);
    });
    if (!ds.measures.length && !(ds.dimensions ?? []).length) {
      add(at, "dataset selects neither dimensions nor measures");
    }
    (ds.filters ?? []).forEach((f, i) => {
      if (!dimIds.has(f.dimension)) {
        add(`${at}.filters[${i}].dimension`, `unknown dimension "${f.dimension}"`);
      }
    });
    (ds.sort ?? []).forEach((s, i) => {
      if ("measure" in s) {
        if (!measureIds.has(s.measure)) {
          add(`${at}.sort[${i}].measure`, `unknown measure "${s.measure}"`);
        } else if (!dsMeasures.has(s.measure)) {
          add(`${at}.sort[${i}].measure`, `"${s.measure}" is not selected by this dataset`);
        }
      } else if (!dimIds.has(s.dimension)) {
        add(`${at}.sort[${i}].dimension`, `unknown dimension "${s.dimension}"`);
      } else if (!dsDims.has(s.dimension)) {
        add(`${at}.sort[${i}].dimension`, `"${s.dimension}" is not selected by this dataset`);
      }
    });
  }

  // ---- panels ----
  const panelIds = new Set(m.panels.map((p) => p.id));
  for (const dupe of duplicates(m.panels.map((p) => p.id))) {
    add("panels", `duplicate panel id "${dupe}"`);
  }
  const columns = m.grid?.columns ?? DEFAULT_COLUMNS;
  m.panels.forEach((p, i) => {
    if (!(p.dataset in m.datasets)) {
      add(`panels[${i}].dataset`, `unknown dataset "${p.dataset}"`);
    }
    if (p.layout.x + p.layout.w > columns) {
      add(
        `panels[${i}].layout`,
        `panel spans past the grid: x(${p.layout.x}) + w(${p.layout.w}) exceeds ${columns} columns`,
      );
    }
  });

  // ---- interactions ----
  (m.interactions ?? []).forEach((it, i) => {
    const panelId = it.on.split(".")[0]!;
    if (!panelIds.has(panelId)) {
      add(`interactions[${i}].on`, `unknown panel "${panelId}"`);
    }
    it.do.forEach((a, j) => {
      const dim = a.action === "filter" ? a.dimension : a.dimension;
      if (dim !== undefined && !dimIds.has(dim)) {
        add(`interactions[${i}].do[${j}].dimension`, `unknown dimension "${dim}"`);
      }
      if (a.action === "filter" && panelIds.has(panelId)) {
        const panel = m.panels.find((p) => p.id === panelId)!;
        const ds = m.datasets[panel.dataset];
        if (ds && !(ds.dimensions ?? []).includes(a.dimension)) {
          add(
            `interactions[${i}].do[${j}].dimension`,
            `panel "${panelId}" cannot emit a filter on "${a.dimension}" — its dataset does not group by it`,
          );
        }
      }
    });
  });

  return issues;
}
