/**
 * The stylesheet, shipped as a string so a consumer can inject it, inline it, or
 * ignore it and write their own against the same class names. No CSS-in-JS
 * runtime and no build-step dependency for anyone embedding the library.
 *
 * Dark mode is selected, not flipped: the series steps are the dark column of
 * the validated palette, chosen against the dark surface.
 */
export const styles = `
.gw-root {
  --gw-surface: #ffffff;
  --gw-surface-2: #f5f7f6;
  --gw-ink: #15211f;
  --gw-ink-soft: #4b5b58;
  --gw-ink-faint: #7c8c88;
  --gw-rule: #d8e0dd;
  --gw-accent: #1e6f5c;
  --gw-accent-bg: #e4efea;
  --gw-good: #1baf7a;
  --gw-bad: #e34948;

  --gw-series-1: #2a78d6;
  --gw-series-2: #eb6834;
  --gw-series-3: #1baf7a;
  --gw-series-4: #eda100;
  --gw-series-5: #e87ba4;
  --gw-series-6: #008300;
  --gw-series-7: #4a3aa7;
  --gw-series-8: #e34948;

  color: var(--gw-ink);
  background: var(--gw-surface-2);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  padding: 16px;
  box-sizing: border-box;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .gw-root {
    --gw-surface: #171f1e;
    --gw-surface-2: #101615;
    --gw-ink: #e4ebe8;
    --gw-ink-soft: #a3b1ae;
    --gw-ink-faint: #7a8885;
    --gw-rule: #2b3735;
    --gw-accent: #58bc9e;
    --gw-accent-bg: #17302a;
    --gw-good: #199e70;
    --gw-bad: #e66767;

    --gw-series-1: #3987e5;
    --gw-series-2: #d95926;
    --gw-series-3: #199e70;
    --gw-series-4: #c98500;
    --gw-series-5: #d55181;
    --gw-series-6: #008300;
    --gw-series-7: #9085e9;
    --gw-series-8: #e66767;
  }
}

:root[data-theme="dark"] .gw-root {
  --gw-surface: #171f1e;
  --gw-surface-2: #101615;
  --gw-ink: #e4ebe8;
  --gw-ink-soft: #a3b1ae;
  --gw-ink-faint: #7a8885;
  --gw-rule: #2b3735;
  --gw-accent: #58bc9e;
  --gw-accent-bg: #17302a;
  --gw-good: #199e70;
  --gw-bad: #e66767;

  --gw-series-1: #3987e5;
  --gw-series-2: #d95926;
  --gw-series-3: #199e70;
  --gw-series-4: #c98500;
  --gw-series-5: #d55181;
  --gw-series-6: #008300;
  --gw-series-7: #9085e9;
  --gw-series-8: #e66767;
}

.gw-root *, .gw-root *::before, .gw-root *::after { box-sizing: border-box; }

.gw-title { font-size: 20px; font-weight: 650; letter-spacing: -0.01em; margin: 0 0 12px; }

.gw-filterbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  margin-bottom: 12px; min-height: 30px;
}
.gw-filterbar-empty { color: var(--gw-ink-faint); font-size: 13px; }
.gw-loading { color: var(--gw-ink-faint); font-size: 12px; margin-left: auto; }

.gw-chip {
  display: inline-flex; align-items: center; gap: 7px;
  border: 1px solid var(--gw-rule); background: var(--gw-surface);
  color: var(--gw-ink); border-radius: 999px; padding: 4px 11px;
  font: inherit; font-size: 12.5px; cursor: pointer;
}
.gw-chip:hover { border-color: var(--gw-accent); }
.gw-chip:focus-visible { outline: 2px solid var(--gw-accent); outline-offset: 2px; }
.gw-chip-label { color: var(--gw-ink-faint); }
.gw-chip-values { font-weight: 600; }
.gw-chip-clear { color: var(--gw-ink-soft); }

.gw-grid { display: grid; }

.gw-panel {
  background: var(--gw-surface);
  border: 1px solid var(--gw-rule);
  border-radius: 8px;
  padding: 12px 14px;
  min-width: 0; min-height: 0;
  display: flex; flex-direction: column; overflow: hidden;
}
.gw-panel-title {
  font-size: 12px; font-weight: 600; letter-spacing: 0.02em;
  text-transform: uppercase; color: var(--gw-ink-faint);
  margin: 0 0 8px; flex: none;
}
.gw-panel-body { flex: 1 1 auto; min-height: 0; position: relative; }

.gw-skeleton {
  width: 100%; height: 100%; min-height: 24px; border-radius: 6px;
  background: var(--gw-surface-2);
}

.gw-kpi { display: flex; flex-direction: column; justify-content: center; height: 100%; }
.gw-kpi-label {
  font-size: 11.5px; font-weight: 600; letter-spacing: 0.03em;
  text-transform: uppercase; color: var(--gw-ink-faint);
}
.gw-kpi-value {
  font-size: clamp(20px, 2.4vw, 30px); font-weight: 650;
  letter-spacing: -0.02em; line-height: 1.15; margin-top: 2px;
  font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis;
}
.gw-kpi-foot { display: flex; align-items: baseline; gap: 8px; margin-top: 4px; font-size: 12.5px; }
.gw-kpi-caption { color: var(--gw-ink-faint); }
.gw-delta { display: inline-flex; align-items: baseline; gap: 3px; font-variant-numeric: tabular-nums; }
.gw-delta-up { color: var(--gw-good); }
.gw-delta-down { color: var(--gw-bad); }
.gw-delta-flat { color: var(--gw-ink-faint); }

.gw-table-wrap { height: 100%; overflow: auto; }
.gw-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.gw-table th {
  position: sticky; top: 0; z-index: 1;
  background: var(--gw-surface); color: var(--gw-ink-faint);
  font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  padding: 6px 10px; border-bottom: 1px solid var(--gw-rule); white-space: nowrap;
}
.gw-table td {
  padding: 6px 10px; border-bottom: 1px solid var(--gw-rule);
  font-variant-numeric: tabular-nums; position: relative; white-space: nowrap;
}
.gw-zebra tbody tr:nth-child(even) { background: color-mix(in srgb, var(--gw-surface-2) 55%, transparent); }
.gw-table tbody tr { cursor: default; }
.gw-table tbody tr[role="button"] { cursor: pointer; }
.gw-table tbody tr[role="button"]:hover { background: var(--gw-accent-bg); }
.gw-table tbody tr:focus-visible { outline: 2px solid var(--gw-accent); outline-offset: -2px; }
.gw-row-on { background: var(--gw-accent-bg) !important; box-shadow: inset 2px 0 0 var(--gw-accent); }
.gw-tone-good { color: var(--gw-good); }
.gw-tone-bad { color: var(--gw-bad); }
.gw-tone-muted { color: var(--gw-ink-faint); }
.gw-cell-bar {
  position: absolute; left: 0; top: 3px; bottom: 3px;
  background: color-mix(in srgb, var(--gw-series-1) 18%, transparent);
  border-radius: 0 4px 4px 0; pointer-events: none;
}
.gw-cell-text { position: relative; }

.gw-chart { position: relative; width: 100%; height: 100%; }
.gw-svg { display: block; overflow: visible; }
.gw-grid-line, .gw-grid { stroke: var(--gw-rule); stroke-width: 1; }
.gw-axis { fill: var(--gw-ink-faint); font-size: 10.5px; }
.gw-crosshair { stroke: var(--gw-ink-faint); stroke-width: 1; stroke-dasharray: 3 3; }
.gw-series-label { fill: var(--gw-ink-soft); font-size: 11px; font-weight: 600; }
.gw-marker { stroke: var(--gw-surface); stroke-width: 2; }
.gw-marker-on { stroke-width: 2.5; }

.gw-bar { cursor: pointer; }
.gw-bar-fill { fill: var(--gw-series-1); transition: opacity 120ms ease; }
.gw-bar:hover .gw-bar-fill { opacity: 0.82; }
.gw-bar.gw-on .gw-bar-fill { fill: var(--gw-accent); }
.gw-bar.gw-dim .gw-bar-fill { opacity: 0.32; }
.gw-bar:focus-visible { outline: 2px solid var(--gw-accent); outline-offset: 1px; }
.gw-bar-label { fill: var(--gw-ink-soft); font-size: 11.5px; dominant-baseline: middle; }
.gw-bar-value {
  fill: var(--gw-ink); font-size: 11.5px; font-weight: 600;
  dominant-baseline: middle; font-variant-numeric: tabular-nums;
}

.gw-legend {
  display: flex; flex-wrap: wrap; gap: 4px 14px; list-style: none;
  margin: 6px 0 0; padding: 0; font-size: 11.5px; color: var(--gw-ink-soft);
}
.gw-legend li { display: inline-flex; align-items: center; gap: 5px; }
.gw-swatch { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
.gw-legend-more { color: var(--gw-ink-faint); }

.gw-tip {
  position: absolute; top: 4px; right: 4px; pointer-events: none;
  background: var(--gw-surface); border: 1px solid var(--gw-rule);
  border-radius: 6px; padding: 6px 9px; font-size: 12px;
  display: flex; flex-direction: column; gap: 1px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.08); max-width: 70%;
}
.gw-tip strong { font-weight: 650; }

.gw-empty, .gw-note { color: var(--gw-ink-faint); font-size: 12.5px; margin: 4px 0 0; }

.gw-bad {
  color: var(--gw-bad); font-size: 12.5px; height: 100%;
  display: flex; flex-direction: column; gap: 5px; overflow: auto;
}
.gw-bad-block { border: 1px solid currentColor; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
.gw-bad pre {
  margin: 0; white-space: pre-wrap; word-break: break-word;
  font-family: ui-monospace, monospace; font-size: 11.5px; color: var(--gw-ink-soft);
}

.gw-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .gw-root * { transition: none !important; animation: none !important; }
}
`;

/** Injects the stylesheet once per document. Safe to call from every mount. */
export function injectStyles(doc: Document = document, id = "gridwright-styles"): void {
  if (doc.getElementById(id)) return;
  const el = doc.createElement("style");
  el.id = id;
  el.textContent = styles;
  doc.head.appendChild(el);
}
