import { isMap, isSeq, parseDocument, stringify, type Document } from "yaml";
import type { Manifest, PanelDef } from "@gridwright/schema";
import { validateManifest } from "@gridwright/schema";

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
  | { type: "redo" };

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

export interface ExportResult {
  yaml: string;
  ok: boolean;
  issues: string[];
}

/** Exported manifests must still validate; this is the round-trip guarantee. */
export function exportManifest(manifest: Manifest, original?: string): ExportResult {
  const yaml = toYaml(manifest, original);
  const check = validateManifest(JSON.parse(JSON.stringify(manifest)));
  return {
    yaml,
    ok: check.ok,
    issues: check.ok ? [] : check.issues.map((i) => `${i.path}: ${i.message}`),
  };
}
