import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Manifest, PanelDef } from "@gridwright/schema";
import type { DataSource } from "@gridwright/engine";
import { PanelRegistry, defaultRegistry } from "@gridwright/panels";
import { Dashboard, FilterStore } from "@gridwright/react";
import { PropertyForm, type JsonSchema } from "./property-form.js";
import { ModelEditor } from "./model-form.js";
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
 * The visual editor. It renders the same `<Dashboard>` a viewer sees — editing
 * a live dashboard rather than a mock is the only way the preview can be
 * trusted — with an inspector driven entirely by the selected panel's schema.
 */
export function Builder({ manifest, manifestText, source, registry, onChange, locale }: BuilderProps) {
  const reg = useMemo(() => registry ?? defaultRegistry(), [registry]);
  const [state, dispatch] = useReducer(reduce, manifest, (m) => initialState(m, manifestText));
  const [exported, setExported] = useState<string | null>(null);
  const [tab, setTab] = useState<"panels" | "model">("panels");
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

  // Column ids the selected panel can reference, read straight from the
  // manifest — no query needed to populate the pickers.
  const refs = useMemo(() => {
    if (!selected) return [];
    const ds = state.manifest.datasets[selected.dataset];
    return [...(ds?.dimensions ?? []), ...(ds?.measures ?? [])];
  }, [selected, state.manifest]);

  const columns = state.manifest.grid?.columns ?? 12;

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
        <main className="gwb-preview">
          <Dashboard
            manifest={preview}
            source={source}
            registry={reg}
            store={store}
            {...(locale ? { locale } : {})}
          />
        </main>

        <aside className="gwb-inspector" aria-label="Inspector">
          <div className="gwb-tabs" role="tablist">
            {(["panels", "model"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`gwb-tab${tab === t ? " gwb-on" : ""}`}
                onClick={() => setTab(t)}
              >
                {t === "panels" ? "Panels" : "Model"}
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
                  <span>{p.title ?? p.id}</span>
                </button>
              </li>
            ))}
          </ul>

          {!selected && <p className="gwb-hint">Select a panel to edit it.</p>}

          {selected && (
            <>
              <h2 className="gwb-heading">
                {selected.title ?? selected.id}
                <button
                  type="button"
                  className="gwb-mini gwb-danger"
                  onClick={() => apply({ type: "removePanel", id: selected.id })}
                >
                  Delete
                </button>
              </h2>

              <div className="gwb-row">
                <label className="gwb-label" htmlFor="gwb-title">Title</label>
                <div className="gwb-control">
                  <input
                    id="gwb-title"
                    className="gwb-input"
                    value={selected.title ?? ""}
                    onChange={(e) =>
                      apply({ type: "updatePanel", id: selected.id, patch: { title: e.target.value || undefined } })
                    }
                  />
                </div>
              </div>

              <div className="gwb-row">
                <label className="gwb-label" htmlFor="gwb-dataset">Dataset</label>
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
                <legend>Layout</legend>
                {(["x", "y", "w", "h"] as const).map((k) => (
                  <div className="gwb-row" key={k}>
                    <label className="gwb-label" htmlFor={`gwb-${k}`}>{k.toUpperCase()}</label>
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

              {spec ? (
                <fieldset className="gwb-fieldset">
                  <legend>{spec.label} settings</legend>
                  <PropertyForm
                    schema={spec.schema.jsonSchema() as JsonSchema}
                    value={selected.props ?? {}}
                    suggestions={{ refs }}
                    onChange={(next) =>
                      apply({ type: "updateProps", id: selected.id, props: (next ?? {}) as Record<string, unknown> })
                    }
                  />
                </fieldset>
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
        <div className="gwb-export" role="dialog" aria-label="Exported manifest">
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
