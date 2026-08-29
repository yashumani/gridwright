import { stringify } from "yaml";
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

export function initialState(manifest: Manifest): EditorState {
  return { manifest, selected: null, past: [], future: [] };
}

const withPanels = (m: Manifest, panels: PanelDef[]): Manifest => ({ ...m, panels });

function commit(state: EditorState, next: Manifest, selected = state.selected): EditorState {
  return {
    manifest: next,
    selected,
    past: [...state.past, state.manifest].slice(-MAX_HISTORY),
    future: [],
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
 * rather than insertion order, so an exported file looks hand-written and a
 * diff between two exports stays small.
 */
const KEY_ORDER = [
  "gridwright", "title", "source", "model", "datasets", "grid", "panels", "interactions", "theme",
];

export function toYaml(manifest: Manifest): string {
  const ordered: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    if (key in manifest) ordered[key] = (manifest as unknown as Record<string, unknown>)[key];
  }
  for (const [k, v] of Object.entries(manifest)) {
    if (!(k in ordered)) ordered[k] = v;
  }
  return stringify(ordered, { lineWidth: 100, singleQuote: false });
}

/** Exported manifests must still validate; this is the round-trip guarantee. */
export function exportManifest(manifest: Manifest): { yaml: string; ok: boolean; issues: string[] } {
  const yaml = toYaml(manifest);
  const check = validateManifest(JSON.parse(JSON.stringify(manifest)));
  return {
    yaml,
    ok: check.ok,
    issues: check.ok ? [] : check.issues.map((i) => `${i.path}: ${i.message}`),
  };
}
