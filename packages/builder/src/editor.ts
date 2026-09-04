import { isMap, isSeq, parseDocument, stringify, type Document } from "yaml";
import type {
  DatasetDef, Issue, Manifest, ModelDef, PanelDef, RelationDef, ThemeDef,
} from "@gridwright/schema";
import { validateManifest } from "@gridwright/schema";
import { analyzeExpression } from "@gridwright/expr";
import { compileModel } from "@gridwright/engine";

/**
 * Manifest editing as pure functions over an immutable document, with an undo
 * stack. Keeping every mutation a function of the previous manifest is what
 * makes the round-trip guarantee testable: import, edit, export, re-import.
 */

export interface EditorState {
  manifest: Manifest;
  selected: string | null;
  past: Manifest[];
  future: Manifest[];
  /** The text this manifest was opened from, so an export can preserve it. */
  source?: string;
}

export type EditorAction =
  | { type: "select"; id: string | null }
  | { type: "addPanel"; panel: PanelDef }
  | { type: "removePanel"; id: string }
  | { type: "updatePanel"; id: string; patch: Partial<PanelDef> }
  | { type: "updateProps"; id: string; props: Record<string, unknown> }
  | { type: "movePanel"; id: string; x: number; y: number }
  | { type: "resizePanel"; id: string; w: number; h: number }
  | { type: "replace"; manifest: Manifest }
  | { type: "undo" }
  | { type: "redo" }
  // ---- the model layer ----
  // Additions and edits hand over the whole slice: the form already computed
  // it, and a reducer case per attribute would be a lot of code saying nothing.
  // Removals and renames get their own actions, because those are the ones
  // with consequences elsewhere in the manifest.
  | { type: "setModel"; model: ModelDef }
  | { type: "removeField"; name: string }
  | { type: "renameDimension"; from: string; to: string }
  | { type: "removeDimension"; id: string }
  | { type: "renameMeasure"; from: string; to: string }
  | { type: "removeMeasure"; id: string }
  | { type: "setDatasets"; datasets: Record<string, DatasetDef> }
  | { type: "renameDataset"; from: string; to: string }
  | { type: "removeDataset"; name: string }
  | { type: "setTheme"; theme: ThemeDef | undefined }
  | { type: "setRelations"; relations: RelationDef[] };

const MAX_HISTORY = 50;

export function initialState(manifest: Manifest, source?: string): EditorState {
  return { manifest, selected: null, past: [], future: [], ...(source ? { source } : {}) };
}

const withPanels = (m: Manifest, panels: PanelDef[]): Manifest => ({ ...m, panels });

function commit(state: EditorState, next: Manifest, selected = state.selected): EditorState {
  return {
    manifest: next,
    selected,
    past: [...state.past, state.manifest].slice(-MAX_HISTORY),
    future: [],
    ...(state.source ? { source: state.source } : {}),
  };
}

/**
 * Cascades for the model layer.
 *
 * The rule that decides all of them: a reference held as an *id in a list* is
 * structure, and structure is the editor's to keep consistent. A reference
 * living inside an expression is somebody's formula, and rewriting that is a
 * guess, not a cascade — those are left alone and named by the validator
 * instead. `measure(revenue)` therefore survives a rename of `revenue` as a
 * visible error rather than being quietly rewritten into something the author
 * never wrote.
 */

const mapValues = <T>(o: Record<string, T>, f: (v: T, k: string) => T): Record<string, T> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v, k)]));

/** Drops interactions left with nothing to do; the schema requires at least one. */
function withInteractions(m: Manifest, next: Manifest["interactions"]): Manifest {
  if (!m.interactions) return m;
  const kept = (next ?? []).filter((i) => i.do.length > 0);
  return { ...m, interactions: kept };
}

function removeDimension(m: Manifest, id: string): Manifest {
  const dimensions = m.model.dimensions.filter((d) => d.id !== id);
  if (dimensions.length === m.model.dimensions.length) return m;

  const datasets = mapValues(m.datasets, (ds) => ({
    ...ds,
    ...(ds.dimensions ? { dimensions: ds.dimensions.filter((x) => x !== id) } : {}),
    ...(ds.filters ? { filters: ds.filters.filter((f) => f.dimension !== id) } : {}),
    ...(ds.sort ? { sort: ds.sort.filter((s) => !("dimension" in s && s.dimension === id)) } : {}),
  }));

  const next: Manifest = { ...m, model: { ...m.model, dimensions }, datasets };
  return withInteractions(
    next,
    (m.interactions ?? []).map((i) => ({
      ...i,
      do: i.do.filter((a) => !(a.action === "filter" && a.dimension === id)),
    })),
  );
}

function removeMeasure(m: Manifest, id: string): Manifest {
  const measures = m.model.measures.filter((x) => x.id !== id);
  if (measures.length === m.model.measures.length) return m;

  const datasets = mapValues(m.datasets, (ds) => ({
    ...ds,
    measures: ds.measures.filter((x) => x !== id),
    ...(ds.sort ? { sort: ds.sort.filter((s) => !("measure" in s && s.measure === id)) } : {}),
  }));
  return { ...m, model: { ...m.model, measures }, datasets };
}

function removeField(m: Manifest, name: string): Manifest {
  const fields = m.model.fields.filter((f) => f.name !== name);
  if (fields.length === m.model.fields.length) return m;
  // A dimension is a named view of one field; without the field it means
  // nothing, so it goes too — and that carries on into the datasets.
  const orphans = m.model.dimensions.filter((d) => d.field === name).map((d) => d.id);
  let next: Manifest = { ...m, model: { ...m.model, fields } };
  for (const id of orphans) next = removeDimension(next, id);
  return next;
}

function removeDataset(m: Manifest, name: string): Manifest {
  if (!(name in m.datasets)) return m;
  const datasets = { ...m.datasets };
  delete datasets[name];
  // A panel bound to a dataset that no longer exists has nothing to draw, so
  // it follows — the same rule removePanel already applies to interactions.
  const gone = new Set(m.panels.filter((p) => p.dataset === name).map((p) => p.id));
  const next: Manifest = { ...m, datasets, panels: m.panels.filter((p) => !gone.has(p.id)) };
  return withInteractions(
    next,
    (m.interactions ?? []).filter((i) => !gone.has(i.on.split(".")[0]!)),
  );
}

function renameDimension(m: Manifest, from: string, to: string): Manifest {
  if (from === to || m.model.dimensions.some((d) => d.id === to)) return m;
  const dimensions = m.model.dimensions.map((d) => (d.id === from ? { ...d, id: to } : d));
  if (!dimensions.some((d) => d.id === to)) return m;

  const datasets = mapValues(m.datasets, (ds) => ({
    ...ds,
    ...(ds.dimensions ? { dimensions: ds.dimensions.map((x) => (x === from ? to : x)) } : {}),
    ...(ds.filters ? { filters: ds.filters.map((f) => (f.dimension === from ? { ...f, dimension: to } : f)) } : {}),
    ...(ds.sort
      ? { sort: ds.sort.map((s) => ("dimension" in s && s.dimension === from ? { ...s, dimension: to } : s)) }
      : {}),
  }));

  const next: Manifest = { ...m, model: { ...m.model, dimensions }, datasets };
  return withInteractions(
    next,
    (m.interactions ?? []).map((i) => ({
      ...i,
      do: i.do.map((a) =>
        a.dimension === from ? ({ ...a, dimension: to } as typeof a) : a,
      ),
    })),
  );
}

function renameMeasure(m: Manifest, from: string, to: string): Manifest {
  if (from === to || m.model.measures.some((x) => x.id === to)) return m;
  const measures = m.model.measures.map((x) => (x.id === from ? { ...x, id: to } : x));
  if (!measures.some((x) => x.id === to)) return m;

  const datasets = mapValues(m.datasets, (ds) => ({
    ...ds,
    measures: ds.measures.map((x) => (x === from ? to : x)),
    ...(ds.sort
      ? { sort: ds.sort.map((s) => ("measure" in s && s.measure === from ? { ...s, measure: to } : s)) }
      : {}),
  }));
  return { ...m, model: { ...m.model, measures }, datasets };
}

function renameDataset(m: Manifest, from: string, to: string): Manifest {
  if (from === to || !(from in m.datasets) || to in m.datasets) return m;
  // Rebuilt in order rather than deleted and re-added, so a rename does not
  // shuffle the dataset that follows it to the bottom of the exported file.
  const datasets: Record<string, DatasetDef> = {};
  for (const [k, v] of Object.entries(m.datasets)) datasets[k === from ? to : k] = v;
  const panels = m.panels.map((p) => (p.dataset === from ? { ...p, dataset: to } : p));
  return { ...m, datasets, panels };
}

export function reduce(state: EditorState, action: EditorAction): EditorState {
  const { manifest } = state;

  switch (action.type) {
    case "select":
      return { ...state, selected: action.id };

    case "addPanel": {
      if (manifest.panels.some((p) => p.id === action.panel.id)) return state;
      return commit(state, withPanels(manifest, [...manifest.panels, action.panel]), action.panel.id);
    }

    case "removePanel": {
      const panels = manifest.panels.filter((p) => p.id !== action.id);
      if (panels.length === manifest.panels.length) return state;
      // Interactions pointing at a deleted panel would fail validation, so they
      // go with it rather than being left as a dangling reference.
      const interactions = (manifest.interactions ?? []).filter(
        (i) => i.on.split(".")[0] !== action.id,
      );
      const next: Manifest = { ...manifest, panels, ...(manifest.interactions ? { interactions } : {}) };
      return commit(state, next, state.selected === action.id ? null : state.selected);
    }

    case "updatePanel":
    case "movePanel":
    case "resizePanel":
    case "updateProps": {
      const index = manifest.panels.findIndex((p) => p.id === action.id);
      if (index < 0) return state;
      const panel = manifest.panels[index]!;
      let updated: PanelDef;
      if (action.type === "updatePanel") updated = { ...panel, ...action.patch };
      else if (action.type === "updateProps") updated = { ...panel, props: action.props };
      else if (action.type === "movePanel") {
        updated = { ...panel, layout: { ...panel.layout, x: action.x, y: action.y } };
      } else {
        updated = { ...panel, layout: { ...panel.layout, w: action.w, h: action.h } };
      }
      const panels = [...manifest.panels];
      panels[index] = updated;
      return commit(state, withPanels(manifest, panels));
    }

    case "replace":
      return commit(state, action.manifest, null);

    case "setModel":
      return commit(state, { ...manifest, model: action.model });

    case "setDatasets":
      return commit(state, { ...manifest, datasets: action.datasets });

    case "setTheme": {
      const next = { ...manifest };
      if (action.theme) next.theme = action.theme;
      else delete next.theme;
      return commit(state, next);
    }

    case "setRelations": {
      const { relations: _drop, ...rest } = manifest.source;
      const source = action.relations.length
        ? { ...manifest.source, relations: action.relations }
        : rest;
      return commit(state, { ...manifest, source });
    }

    case "removeField":
    case "removeDimension":
    case "removeMeasure":
    case "removeDataset":
    case "renameDimension":
    case "renameMeasure":
    case "renameDataset": {
      let next: Manifest;
      if (action.type === "removeField") next = removeField(manifest, action.name);
      else if (action.type === "removeDimension") next = removeDimension(manifest, action.id);
      else if (action.type === "removeMeasure") next = removeMeasure(manifest, action.id);
      else if (action.type === "removeDataset") next = removeDataset(manifest, action.name);
      else if (action.type === "renameDimension") next = renameDimension(manifest, action.from, action.to);
      else if (action.type === "renameMeasure") next = renameMeasure(manifest, action.from, action.to);
      else next = renameDataset(manifest, action.from, action.to);
      // A no-op stays off the undo stack: nothing to take back.
      if (next === manifest) return state;
      // A selected panel may have gone with its dataset.
      const selected = next.panels.some((p) => p.id === state.selected) ? state.selected : null;
      return commit(state, next, selected);
    }

    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        manifest: previous,
        selected: state.selected,
        past: state.past.slice(0, -1),
        future: [state.manifest, ...state.future].slice(0, MAX_HISTORY),
        ...(state.source ? { source: state.source } : {}),
      };
    }

    case "redo": {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return {
        manifest: next,
        selected: state.selected,
        past: [...state.past, state.manifest].slice(-MAX_HISTORY),
        future: rest,
        ...(state.source ? { source: state.source } : {}),
      };
    }
  }
}

/** Places a new panel on the first free row, full width of its own size. */
export function placePanel(manifest: Manifest, w: number, h: number): PanelDef["layout"] {
  const columns = manifest.grid?.columns ?? 12;
  const bottom = manifest.panels.reduce((max, p) => Math.max(max, p.layout.y + p.layout.h), 0);
  return { x: 0, y: bottom, w: Math.min(w, columns), h };
}

/** A panel id that does not collide with anything already in the manifest. */
export function nextPanelId(manifest: Manifest, type: string): string {
  const taken = new Set(manifest.panels.map((p) => p.id));
  for (let i = 1; ; i++) {
    const id = `${type}_${i}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * Serialises back to YAML. Key order follows the format's own reading order
 * rather than insertion order, so a freshly written file looks hand-written and
 * a diff between two exports stays small.
 */
const KEY_ORDER = [
  "gridwright", "title", "source", "model", "datasets", "grid", "panels", "interactions", "theme",
];

function ordered(manifest: Manifest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    if (key in manifest) out[key] = (manifest as unknown as Record<string, unknown>)[key];
  }
  for (const [k, v] of Object.entries(manifest)) {
    if (!(k in out)) out[k] = v;
  }
  return out;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Elements carrying a stable `id`, so a list can be matched by identity. */
function idsOf(list: readonly unknown[]): string[] | null {
  const ids: string[] = [];
  for (const item of list) {
    if (!isPlainObject(item) || typeof item["id"] !== "string") return null;
    ids.push(item["id"]);
  }
  return new Set(ids).size === ids.length ? ids : null;
}

/**
 * Writes only what actually changed into an existing document.
 *
 * A comment in YAML belongs to a node, so replacing a node discards it. Editing
 * in place means an untouched section — and every comment on it — survives a
 * trip through the visual editor. That matters as soon as engineers and
 * analysts share a file: the first save must not silently delete the notes
 * somebody wrote to explain a measure.
 */
function patch(doc: Document, path: readonly (string | number)[], before: unknown, after: unknown): void {
  if (same(before, after)) return;

  if (Array.isArray(before) && Array.isArray(after)) {
    const beforeIds = idsOf(before);
    const afterIds = idsOf(after);

    // Matching by id keeps comments attached when items move, appear or go.
    if (beforeIds && afterIds) {
      const byId = new Map(beforeIds.map((id, i) => [id, { item: before[i], index: i }]));
      // Removals first, highest index down, so earlier indices stay valid.
      const removed = beforeIds
        .map((id, i) => ({ id, i }))
        .filter(({ id }) => !afterIds.includes(id))
        .sort((a, b) => b.i - a.i);
      for (const { i } of removed) doc.deleteIn([...path, i]);

      const survivors = beforeIds.filter((id) => afterIds.includes(id));
      // Order changed: rewriting the list is the honest option, and the items
      // themselves are re-patched below where they landed.
      if (!same(survivors, afterIds.filter((id) => survivors.includes(id)))) {
        doc.setIn([...path], after);
        return;
      }
      afterIds.forEach((id, index) => {
        const prior = byId.get(id);
        if (!prior) doc.addIn([...path], after[index]);
        else patch(doc, [...path, survivors.indexOf(id)], prior.item, after[index]);
      });
      return;
    }

    if (before.length === after.length) {
      after.forEach((v, i) => patch(doc, [...path, i], before[i], v));
      return;
    }
    doc.setIn([...path], after);
    return;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    for (const key of Object.keys(after)) patch(doc, [...path, key], before[key], after[key]);
    for (const key of Object.keys(before)) {
      if (!(key in after)) doc.deleteIn([...path, key]);
    }
    return;
  }

  if (path.length === 0) doc.contents = doc.createNode(after);
  else doc.setIn([...path], after);
}

/**
 * Serialises a manifest, preserving the comments and layout of `original` where
 * the content has not changed. Without an original, writes a fresh document.
 */
export function toYaml(manifest: Manifest, original?: string): string {
  if (original !== undefined && original.trim() !== "") {
    try {
      const doc = parseDocument(original);
      if (!doc.errors.length && (isMap(doc.contents) || isSeq(doc.contents))) {
        patch(doc, [], doc.toJS() as unknown, ordered(manifest));
        return String(doc);
      }
    } catch {
      // An unparseable original is not worth failing an export over; fall
      // through and write a clean document instead.
    }
  }
  return stringify(ordered(manifest), { lineWidth: 100, singleQuote: false });
}

/**
 * Whether a manifest is safe to hand to the renderer.
 *
 * This exists because `new Engine()` analyses the whole measure model in its
 * constructor, synchronously, during render. A half-typed expression — and
 * every measure passes through several while it is being typed — would
 * otherwise take the builder down with it. So the model editor checks first
 * and previews the last manifest that passed.
 *
 * Structural and referential validation catches most of it; compiling the
 * model catches what a per-measure check cannot see, notably a dependency
 * cycle between two measures that are each individually fine.
 */
export interface Health {
  ok: boolean;
  issues: Issue[];
}

export function checkManifest(manifest: Manifest): Health {
  // Validation reads plain data, and a manifest under edit is plain data with
  // undefined holes in it; the round trip drops them exactly as an export does.
  const check = validateManifest(JSON.parse(JSON.stringify(manifest)) as unknown, {
    checkExpression: (expr) => analyzeExpression(expr).issues,
  });
  if (!check.ok) return { ok: false, issues: check.issues };

  try {
    compileModel(check.manifest);
  } catch (err) {
    const e = err as Error & { detail?: string };
    return {
      ok: false,
      issues: [{ path: "model.measures", message: e.detail ? `${e.message}: ${e.detail}` : e.message }],
    };
  }
  return { ok: true, issues: [] };
}

export interface ExportResult {
  yaml: string;
  ok: boolean;
  issues: string[];
}

/** Exported manifests must still validate; this is the round-trip guarantee. */
export function exportManifest(manifest: Manifest, original?: string): ExportResult {
  const yaml = toYaml(manifest, original);
  const check = checkManifest(manifest);
  return {
    yaml,
    ok: check.ok,
    issues: check.issues.map((i) => `${i.path}: ${i.message}`),
  };
}
