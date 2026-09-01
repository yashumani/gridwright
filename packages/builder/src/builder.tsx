import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Manifest, PanelDef } from "@gridwright/schema";
import type { DataSource } from "@gridwright/engine";
import { PanelRegistry, defaultRegistry, type PanelSpec } from "@gridwright/panels";
import { Dashboard, FilterStore } from "@gridwright/react";
import { PropertyForm, type JsonSchema, type RefOption } from "./property-form.js";
import { ModelEditor } from "./model-form.js";
import { ThemeEditor } from "./theme-form.js";
import { DropGhost, PanelChrome, useDrag } from "./drag.js";
import { compact, gridColumns, resizeTo, resolveCollisions, type Rect } from "./layout.js";
import {
  checkManifest, exportManifest, initialState, nextPanelId, placePanel, reduce,
} from "./editor.js";

export interface BuilderProps {
  manifest: Manifest;
  /**
   * The YAML this manifest was parsed from. Supplying it makes an export
   * preserve the original's comments and layout, which is what lets engineers
   * and analysts share one file.
   */
  manifestText?: string;
  source: DataSource;
  registry?: PanelRegistry;
  onChange?: (manifest: Manifest) => void;
  locale?: string;
}

/**
 * A name for a panel that has no title of its own.
 *
 * Falling back to the id shows a list of `kpi_total_amount`, `bars_region`,
 * `detail` — legible to whoever wrote the manifest and to nobody else, which
 * for a generated manifest is nobody at all. The panel already says what it
 * draws in its props, so read the ids it references and answer with their
 * labels. The scan is generic rather than a switch on panel type, so a panel
 * type this file has never heard of still gets a readable name.
 */
function describePanel(panel: PanelDef, manifest: Manifest, spec?: PanelSpec): string {
  const labels = new Map<string, string>();
  for (const d of manifest.model.dimensions) labels.set(d.id, d.label ?? d.id);
  for (const m of manifest.model.measures) labels.set(m.id, m.label ?? m.id);

  const found: string[] = [];
  const scan = (v: unknown, depth: number): void => {
    if (found.length >= 3 || depth > 4) return;
    if (typeof v === "string") {
      const label = labels.get(v);
      if (label && !found.includes(label)) found.push(label);
    } else if (Array.isArray(v)) {
      for (const item of v) scan(item, depth + 1);
    } else if (v && typeof v === "object") {
      for (const item of Object.values(v)) scan(item, depth + 1);
    }
  };
  scan(panel.props ?? {}, 0);

  // Nothing recognisable — the panel's own type reads better than its id.
  return found.length ? found.join(" · ") : spec?.label ?? panel.type;
}

/**
 * The visual editor. It renders the same `<Dashboard>` a viewer sees — editing
 * a live dashboard rather than a mock is the only way the preview can be
 * trusted — with an inspector driven entirely by the selected panel's schema.
 */
/** The four layout numbers, named for what they mean rather than for the axis. */
const LAYOUT_KEYS = [
  ["x", "From column"], ["y", "From row"], ["w", "Columns wide"], ["h", "Rows tall"],
] as const;

export function Builder({ manifest, manifestText, source, registry, onChange, locale }: BuilderProps) {
  const reg = useMemo(() => registry ?? defaultRegistry(), [registry]);
  const [state, dispatch] = useReducer(reduce, manifest, (m) => initialState(m, manifestText));
  const [exported, setExported] = useState<string | null>(null);
  const [tab, setTab] = useState<"panels" | "model" | "colours">("panels");
  const store = useMemo(() => new FilterStore(), []);

  /**
   * The preview renders the last manifest that compiled, not the one being
   * edited.
   *
   * `new Engine()` analyses the whole measure model in its constructor, during
   * render — so a half-typed expression, which every expression is for a
   * moment, would throw straight through the builder and take the editor down
   * with the dashboard. Holding the last good one back means the form stays
   * usable while the numbers behind it are briefly nonsense, and the preview
   * catches up the instant it makes sense again.
   */
  const health = useMemo(() => checkManifest(state.manifest), [state.manifest]);
  const lastGood = useRef(manifest);
  if (health.ok) lastGood.current = state.manifest;
  const preview = health.ok ? state.manifest : lastGood.current;

  /**
   * Real column names per table, so `from:` is a pick rather than a spelling
   * test. Introspection is the source's own business and may be async.
   */
  const [sourceColumns, setSourceColumns] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let live = true;
    const tables = manifest.source.files.map((f) => f.id);
    Promise.all(
      tables.map(async (t) => [t, await source.introspect(t).catch(() => [])] as const),
    ).then((pairs) => {
      if (live) setSourceColumns(Object.fromEntries(pairs));
    });
    return () => { live = false; };
  }, [source, manifest]);

  const apply = (action: Parameters<typeof reduce>[1]) => {
    const next = reduce(state, action);
    dispatch(action);
    if (next.manifest !== state.manifest) onChange?.(next.manifest);
  };

  const selected = state.manifest.panels.find((p) => p.id === state.selected);
  const spec = selected ? reg.get(selected.type) : undefined;

  // What the selected panel can draw, read straight from the manifest — no
  // query needed to populate the pickers. Labels come along, because `rtn_rate`
  // is not something anyone can be expected to guess.
  const refs = useMemo((): RefOption[] => {
    if (!selected) return [];
    const ds = state.manifest.datasets[selected.dataset];
    const label = (id: string, from: { id: string; label?: string }[]): string =>
      from.find((m) => m.id === id)?.label ?? id;
    return [
      ...(ds?.dimensions ?? []).map((id) => ({
        id, label: label(id, state.manifest.model.dimensions), kind: "dimension" as const,
      })),
      ...(ds?.measures ?? []).map((id) => ({
        id, label: label(id, state.manifest.model.measures), kind: "measure" as const,
      })),
    ];
  }, [selected, state.manifest]);

  const columns = gridColumns(state.manifest);

  /**
   * A dropped panel takes its cells outright and pushes whatever was under it
   * down, then everything settles upwards into the space that leaves. Doing both
   * as one action keeps the whole gesture a single undo step — a drag that took
   * three presses of undo to reverse would be worse than no drag.
   */
  const place = useCallback(
    (id: string, to: Rect) => {
      const panels = compact(resolveCollisions(state.manifest.panels, id, to));
      const settled = panels.every((p, i) => p === state.manifest.panels[i]);
      if (settled) return;
      apply({ type: "replace", manifest: { ...state.manifest, panels } });
      dispatch({ type: "select", id });
    },
    [state.manifest],
  );

  const drag = useDrag({
    manifest: state.manifest,
    minSize: (p) => reg.get(p.type)?.minSize ?? { w: 1, h: 1 },
    onCommit: place,
    onSelect: (id) => apply({ type: "select", id }),
  });

  /**
   * The same moves from the keyboard. A layout you can only change by dragging
   * is one a keyboard user cannot change at all, and arrows are the faster way
   * to nudge something one cell anyway.
   */
  const onGridKeyDown = (e: React.KeyboardEvent) => {
    if (!selected) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const d = step[e.key];
    if (!d) return;
    e.preventDefault();
    const [dx, dy] = d;
    const min = reg.get(selected.type)?.minSize ?? { w: 1, h: 1 };
    const to = e.shiftKey
      ? resizeTo(selected.layout, "se", dx, dy, columns, min)
      : {
          ...selected.layout,
          x: Math.min(Math.max(0, selected.layout.x + dx), columns - selected.layout.w),
          y: Math.max(0, selected.layout.y + dy),
        };
    place(selected.id, to);
  };

  // Escape closes the export dialog. It covers the editor, so there has to be
  // a way out that is not hunting for the button.
  useEffect(() => {
    if (exported === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExported(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exported]);

  return (
    <div className="gwb-root">
      <header className="gwb-toolbar">
        <strong className="gwb-brand">Gridwright</strong>
        <div className="gwb-tools">
          <select
            className="gwb-input"
            value=""
            aria-label="Add a panel"
            onChange={(e) => {
              const type = e.target.value;
              if (!type) return;
              const s = reg.get(type);
              if (!s) return;
              const dataset = Object.keys(state.manifest.datasets)[0];
              if (!dataset) return;
              const panel: PanelDef = {
                id: nextPanelId(state.manifest, type),
                type,
                dataset,
                layout: placePanel(state.manifest, s.minSize?.w ?? 4, s.minSize?.h ?? 3),
                props: {},
              };
              apply({ type: "addPanel", panel });
              e.target.value = "";
            }}
          >
            <option value="">Add panel…</option>
            {reg.all().map((s) => (
              <option key={s.type} value={s.type}>{s.label}</option>
            ))}
          </select>
          <button type="button" className="gwb-mini" disabled={!state.past.length} onClick={() => apply({ type: "undo" })}>
            Undo
          </button>
          <button type="button" className="gwb-mini" disabled={!state.future.length} onClick={() => apply({ type: "redo" })}>
            Redo
          </button>
          <button
            type="button"
            className="gwb-mini gwb-primary"
            onClick={() => setExported(exportManifest(state.manifest, state.source).yaml)}
          >
            Export
          </button>
        </div>
      </header>

      <div className="gwb-body">
        <main
          className={`gwb-preview${drag.gesture ? " gwb-gesturing" : ""}`}
          onKeyDown={onGridKeyDown}
        >
          <Dashboard
            manifest={preview}
            source={source}
            registry={reg}
            store={store}
            {...(locale ? { locale } : {})}
            panelOverlay={(p) => (
              <PanelChrome
                panel={p}
                selected={p.id === state.selected}
                drag={drag}
                label={p.title ?? describePanel(p, state.manifest, reg.get(p.type))}
              />
            )}
            gridOverlay={<DropGhost gesture={drag.gesture} />}
          />
        </main>

        <aside className="gwb-inspector" aria-label="Inspector">
          <div className="gwb-tabs" role="tablist">
            {(["panels", "model", "colours"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`gwb-tab${tab === t ? " gwb-on" : ""}`}
                onClick={() => setTab(t)}
              >
                {t === "panels" ? "Panels" : t === "model" ? "Model" : "Colours"}
              </button>
            ))}
          </div>

          {/* What is wrong, where. Shown in both tabs: a model edit is the
              usual way to break a panel, and the two are edited apart. */}
          {!health.ok && (
            <div className="gwb-issues" role="alert">
              <strong>{health.issues.length === 1 ? "1 problem" : `${health.issues.length} problems`}</strong>
              <ul>
                {health.issues.slice(0, 6).map((i, n) => (
                  <li key={n}><code>{i.path || "(root)"}</code> {i.message}</li>
                ))}
              </ul>
              {health.issues.length > 6 && <p>and {health.issues.length - 6} more.</p>}
              <p className="gwb-hint">The preview is showing the last version that ran.</p>
            </div>
          )}

          {tab === "model" ? (
            <ModelEditor manifest={state.manifest} apply={apply} columns={sourceColumns} />
          ) : tab === "colours" ? (
            <ThemeEditor
              manifest={state.manifest}
              apply={(theme) => apply({ type: "setTheme", theme })}
            />
          ) : (
          <>
          <h2 className="gwb-heading">Panels</h2>
          <ul className="gwb-list">
            {state.manifest.panels.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`gwb-listitem${p.id === state.selected ? " gwb-on" : ""}`}
                  onClick={() => apply({ type: "select", id: p.id })}
                  aria-pressed={p.id === state.selected}
                >
                  <span className="gwb-listtype">{p.type}</span>
                  <span>{p.title ?? describePanel(p, state.manifest, reg.get(p.type))}</span>
                </button>
              </li>
            ))}
          </ul>

          {!selected && (
            <p className="gwb-hint">
              Pick a panel to change what it shows. The fields it can draw from —
              what you can group by, and what gets measured — live under{" "}
              <strong>Model</strong>.
            </p>
          )}

          {selected && (
            <>
              <h2 className="gwb-heading">
                {selected.title ?? describePanel(selected, state.manifest, spec)}
                <button
                  type="button"
                  className="gwb-mini gwb-danger"
                  onClick={() => apply({ type: "removePanel", id: selected.id })}
                >
                  Delete
                </button>
              </h2>

              {/* What the panel draws comes first, because it is the question
                  the panel is asking. Everything below it is presentation. */}
              {spec ? (
                <>
                  {spec.primary?.length ? (
                    <PropertyForm
                      schema={spec.schema.jsonSchema() as JsonSchema}
                      value={selected.props ?? {}}
                      suggestions={{ refs }}
                      only={spec.primary}
                      onChange={(next) =>
                        apply({ type: "updateProps", id: selected.id, props: (next ?? {}) as Record<string, unknown> })
                      }
                    />
                  ) : null}

                  <div className="gwb-row">
                    <label className="gwb-label" htmlFor="gwb-title">Title</label>
                    <div className="gwb-control">
                      <input
                        id="gwb-title"
                        className="gwb-input"
                        placeholder={describePanel(selected, state.manifest, spec)}
                        value={selected.title ?? ""}
                        onChange={(e) =>
                          apply({ type: "updatePanel", id: selected.id, patch: { title: e.target.value || undefined } })
                        }
                      />
                    </div>
                  </div>

                  <details className="gwb-section">
                    <summary>More settings</summary>

                    <PropertyForm
                      schema={spec.schema.jsonSchema() as JsonSchema}
                      value={selected.props ?? {}}
                      suggestions={{ refs }}
                      {...(spec.primary?.length ? { except: spec.primary } : {})}
                      onChange={(next) =>
                        apply({ type: "updateProps", id: selected.id, props: (next ?? {}) as Record<string, unknown> })
                      }
                    />

                    <div className="gwb-row">
                      <label className="gwb-label" htmlFor="gwb-dataset">Reads from</label>
                      <div className="gwb-control">
                        <select
                          id="gwb-dataset"
                          className="gwb-input"
                          value={selected.dataset}
                          onChange={(e) =>
                            apply({ type: "updatePanel", id: selected.id, patch: { dataset: e.target.value } })
                          }
                        >
                          {Object.keys(state.manifest.datasets).map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <fieldset className="gwb-fieldset">
                      <legend>Position</legend>
                      <p className="gwb-hint">
                        Drag the panel to move it, or its corners to resize. Arrow keys nudge
                        the selected panel; hold shift to resize.
                      </p>
                      {LAYOUT_KEYS.map(([k, name]) => (
                        <div className="gwb-row" key={k}>
                          <label className="gwb-label" htmlFor={`gwb-${k}`}>{name}</label>
                          <div className="gwb-control">
                            <input
                              id={`gwb-${k}`}
                              className="gwb-input"
                              type="number"
                              min={k === "w" || k === "h" ? 1 : 0}
                              max={k === "x" || k === "w" ? columns : undefined}
                              value={selected.layout[k]}
                              onChange={(e) => {
                                const n = Number(e.target.value);
                                if (!Number.isFinite(n)) return;
                                const layout = { ...selected.layout, [k]: Math.trunc(n) };
                                apply({ type: "updatePanel", id: selected.id, patch: { layout } });
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </fieldset>
                  </details>
                </>
              ) : (
                <p className="gwb-hint">No editor for panel type “{selected.type}”.</p>
              )}
            </>
          )}
          </>
          )}
        </aside>
      </div>

      {exported !== null && (
        <div className="gwb-scrim" onClick={() => setExported(null)} />
      )}
      {exported !== null && (
        <div className="gwb-export" role="dialog" aria-modal="true" aria-label="Exported manifest">
          <header>
            <strong>Manifest</strong>
            <button type="button" className="gwb-mini" onClick={() => setExported(null)}>Close</button>
          </header>
          <textarea readOnly value={exported} spellCheck={false} />
        </div>
      )}
    </div>
  );
}
