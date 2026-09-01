import { Component, useCallback, useEffect, useMemo, useRef, type ErrorInfo, type ReactNode } from "react";
import type { Action, Filter, Manifest, PanelDef } from "@gridwright/schema";
import { formatIssues } from "@gridwright/schema";
import { Engine, type DataSource, type QueryResult, type Value } from "@gridwright/engine";
import { PanelRegistry, defaultRegistry, type PanelSpec } from "@gridwright/panels";
import { FilterStore, describeSelections, type Selections } from "./filter-store.js";
import { useAsync, useMeasure, useSelections } from "./hooks.js";

export interface DashboardProps {
  manifest: Manifest;
  source: DataSource;
  registry?: PanelRegistry;
  /** Supply one to drive selections from outside, or read them back. */
  store?: FilterStore;
  locale?: string;
  className?: string;
  onError?: (error: Error) => void;
  /**
   * Rendered inside every panel's box, on top of its content.
   *
   * This is the seam the builder hangs its drag chrome on. It lives here rather
   * than in an overlay the builder positions itself because the panel's box is
   * the only place the grid's geometry is known exactly — a mirrored overlay has
   * to re-measure and can drift by a pixel, and a drag handle that is a pixel
   * off the thing it drags is worse than none. Absent, it costs nothing.
   */
  panelOverlay?: (panel: PanelDef) => ReactNode;
  /**
   * Rendered as a further child of the grid itself, so the builder can place a
   * drop ghost at a cell no panel occupies yet.
   */
  gridOverlay?: ReactNode;
}

const DEFAULT_COLUMNS = 12;
const DEFAULT_ROW_HEIGHT = 76;
const DEFAULT_GAP = 12;

/** What a panel click carries: the clicked dimension and value, plus its row. */
interface Emitted {
  dimension: string;
  value: Value;
  row?: Readonly<Record<string, Value>>;
}

export function Dashboard({
  manifest, source, registry, store, locale, className, onError, panelOverlay, gridOverlay,
}: DashboardProps) {
  const reg = useMemo(() => registry ?? defaultRegistry(), [registry]);
  const filters = useMemo(() => store ?? new FilterStore(), [store]);
  const engine = useMemo(() => new Engine(manifest, source), [manifest, source]);
  const selections = useSelections(filters);

  /**
   * Dimensions a panel can select on. A panel is never filtered by its own
   * selection: collapsing a bar chart to the one bar you just clicked makes a
   * second selection impossible and leaves nothing to show as unselected.
   * Every other panel still narrows, which is the point of cross-filtering.
   */
  const ownDimensions = useCallback(
    (panel: PanelDef): string[] => {
      const configured = (manifest.interactions ?? [])
        .filter((i) => i.on.split(".")[0] === panel.id)
        .flatMap((i) => i.do.flatMap((a) => (a.action === "filter" ? [a.dimension] : [])));
      if (configured.length) return configured;
      return manifest.datasets[panel.dataset]?.dimensions ?? [];
    },
    [manifest],
  );

  const active = useMemo(() => filters.toFilters(), [filters, selections]);

  // One request per distinct (dataset, self-excluded dimensions) pair. Panels
  // that agree on both share a result, so the common case is still one query
  // per dataset and there is a single loading state rather than a ripple.
  const requests = useMemo(() => {
    const map = new Map<string, { dataset: string; filters: Filter[] }>();
    for (const panel of manifest.panels) {
      const own = new Set(ownDimensions(panel));
      const key = `${panel.dataset}|${[...own].sort().join(",")}`;
      if (map.has(key)) continue;
      map.set(key, {
        dataset: panel.dataset,
        filters: active.filter((f) => !own.has(f.dimension)),
      });
    }
    return map;
  }, [manifest, ownDimensions, active]);

  const requestKey = useCallback(
    (panel: PanelDef) => `${panel.dataset}|${[...new Set(ownDimensions(panel))].sort().join(",")}`,
    [ownDimensions],
  );

  const results = useAsync(async () => {
    const entries = [...requests.entries()];
    const settled = await Promise.all(
      entries.map(([, r]) => engine.query(r.dataset, { filters: r.filters })),
    );
    return Object.fromEntries(entries.map(([key], i) => [key, settled[i]!]));
  }, [engine, requests]);

  const columns = manifest.grid?.columns ?? DEFAULT_COLUMNS;
  const rowHeight = manifest.grid?.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const gap = manifest.grid?.gap ?? DEFAULT_GAP;

  const runActions = useCallback(
    (actions: readonly Action[], emitted: Emitted) => {
      for (const a of actions) {
        if (a.action === "clearFilters") {
          filters.clear(a.dimension);
          continue;
        }
        // The clicked value belongs to the dimension the panel emitted, so an
        // action naming a *different* dimension must read that dimension's own
        // value out of the same row. Filtering `channel` by a region name is
        // not a narrower dashboard, it is an empty one.
        if (a.from === "value") {
          // Explicitly asked for the clicked value, whatever it names.
          filters.toggle(a.dimension, emitted.value);
          continue;
        }
        if (emitted.row && a.dimension in emitted.row) {
          filters.toggle(a.dimension, emitted.row[a.dimension] ?? null);
          continue;
        }
        if (a.dimension === emitted.dimension) {
          // A panel that emits no row still knows its own dimension's value.
          filters.toggle(a.dimension, emitted.value);
          continue;
        }
        // The panel cannot supply this dimension: drop the action rather than
        // filter it by a value belonging to some other column.
      }
    },
    [filters],
  );

  const selectFor = useCallback(
    (panel: PanelDef) => (dimension: string, value: Value, row?: Readonly<Record<string, Value>>) => {
      const configured = (manifest.interactions ?? []).filter(
        (i) => i.on.split(".")[0] === panel.id,
      );
      if (!configured.length) {
        // No interaction declared: filtering on what was clicked is the
        // behaviour every user expects, so it is the default rather than
        // something a manifest has to opt into.
        filters.toggle(dimension, value);
        return;
      }
      for (const i of configured) runActions(i.do, { dimension, value, ...(row ? { row } : {}) });
    },
    [manifest, filters, runActions],
  );

  const chips = describeSelections(manifest, selections);

  return (
    <div className={`gw-root${className ? ` ${className}` : ""}`} data-gridwright="1">
      {manifest.title && <h1 className="gw-title">{manifest.title}</h1>}

      <div className="gw-filterbar" role="region" aria-label="Active filters">
        {chips.length === 0 ? (
          <span className="gw-filterbar-empty">No filters — click a chart to narrow the dashboard.</span>
        ) : (
          <>
            {chips.map((c) => (
              <button
                key={c.dimension}
                type="button"
                className="gw-chip"
                onClick={() => filters.clear(c.dimension)}
                title={`Clear ${c.label}`}
              >
                <span className="gw-chip-label">{c.label}</span>
                <span className="gw-chip-values">
                  {c.values.slice(0, 3).map((v) => String(v ?? "blank")).join(", ")}
                  {c.values.length > 3 ? ` +${c.values.length - 3}` : ""}
                </span>
                <span aria-hidden="true">×</span>
              </button>
            ))}
            <button type="button" className="gw-chip gw-chip-clear" onClick={() => filters.clear()}>
              Clear all
            </button>
          </>
        )}
        {results.status === "loading" && <span className="gw-loading" role="status">Updating…</span>}
      </div>

      {results.status === "error" && (
        <ErrorCard title="The dashboard could not load" error={results.error} onError={onError} />
      )}

      <div
        className="gw-grid"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridAutoRows: `${rowHeight}px`,
          gap: `${gap}px`,
        }}
      >
        {manifest.panels.map((panel) => (
          <PanelHost
            key={panel.id}
            panel={panel}
            spec={reg.get(panel.type)}
            registry={reg}
            result={results.data?.[requestKey(panel)]}
            loading={results.status === "loading" && !results.data}
            selections={selections}
            select={selectFor(panel)}
            {...(locale ? { locale } : {})}
            {...(onError ? { onError } : {})}
            {...(panelOverlay ? { overlay: panelOverlay(panel) } : {})}
          />
        ))}
        {gridOverlay}
      </div>
    </div>
  );
}

interface PanelHostProps {
  panel: PanelDef;
  spec: PanelSpec<any> | undefined;
  registry: PanelRegistry;
  result: QueryResult | undefined;
  loading: boolean;
  selections: Selections;
  select: (dimension: string, value: Value, row?: Readonly<Record<string, Value>>) => void;
  locale?: string;
  onError?: (error: Error) => void;
  overlay?: ReactNode;
}

function PanelHost({
  panel, spec, registry, result, loading, selections, select, locale, onError, overlay,
}: PanelHostProps) {
  const [ref, size] = useMeasure<HTMLDivElement>();

  const style = {
    gridColumn: `${panel.layout.x + 1} / span ${panel.layout.w}`,
    gridRow: `${panel.layout.y + 1} / span ${panel.layout.h}`,
  };

  const issues = useMemo(
    () => registry.validateProps(panel.type, panel.props ?? {}),
    [registry, panel.type, panel.props],
  );

  let body: ReactNode;
  if (!spec) {
    body = <Misconfigured message={`Unknown panel type "${panel.type}".`} detail={`Registered: ${registry.types().join(", ")}`} />;
  } else if (issues.length) {
    body = <Misconfigured message="This panel's settings are not valid." detail={formatIssues(issues)} />;
  } else if (loading || !result) {
    body = <div className="gw-skeleton" aria-hidden="true" />;
  } else {
    const props = { ...spec.defaults(result), ...(panel.props ?? {}) };
    body = (
      <PanelBoundary id={panel.id} {...(onError ? { onError } : {})}>
        <spec.Component
          result={result}
          props={props}
          size={size}
          select={select}
          selected={selections}
          {...(panel.title ? { title: panel.title } : {})}
          {...(locale ? { locale } : {})}
        />
      </PanelBoundary>
    );
  }

  return (
    <section
      className="gw-panel"
      style={style}
      aria-label={panel.title ?? panel.id}
      data-panel={panel.id}
    >
      {panel.title && <h2 className="gw-panel-title">{panel.title}</h2>}
      <div className="gw-panel-body" ref={ref}>
        {body}
      </div>
      {overlay}
    </section>
  );
}

function Misconfigured({ message, detail }: { message: string; detail?: string }) {
  return (
    <div className="gw-bad" role="alert">
      <strong>{message}</strong>
      {detail && <pre>{detail}</pre>}
    </div>
  );
}

function ErrorCard({ title, error, onError }: { title: string; error: Error; onError?: (e: Error) => void }) {
  // Reporting from render would re-enter: a host that turns onError into state
  // re-renders this card, which reports again. Held in a ref so a fresh
  // callback identity each render does not count as a new error either.
  const report = useRef(onError);
  report.current = onError;
  useEffect(() => { report.current?.(error); }, [error]);

  const detail = (error as Error & { detail?: string }).detail;
  return (
    <div className="gw-bad gw-bad-block" role="alert">
      <strong>{title}</strong>
      <pre>{error.message}{detail ? `\n${detail}` : ""}</pre>
    </div>
  );
}

/**
 * One bad panel must not blank the dashboard. A panel that throws is replaced
 * by its own error card while every other panel keeps rendering.
 */
class PanelBoundary extends Component<
  { id: string; children: ReactNode; onError?: (e: Error) => void },
  { error: Error | null }
> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError?.(error);
  }

  override render() {
    if (this.state.error) {
      const detail = (this.state.error as Error & { issues?: unknown }).message;
      return <Misconfigured message={`Panel "${this.props.id}" could not render.`} detail={detail} />;
    }
    return this.props.children;
  }
}
