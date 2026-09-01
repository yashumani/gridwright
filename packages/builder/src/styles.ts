/** Builder chrome. The dashboard inside it brings its own stylesheet. */
export const builderStyles = `
.gwb-root {
  --gwb-surface: #ffffff; --gwb-ground: #f5f7f6; --gwb-ink: #15211f;
  --gwb-faint: #7c8c88; --gwb-rule: #d8e0dd; --gwb-accent: #1e6f5c;
  --gwb-accent-bg: #e4efea; --gwb-danger: #b3261e;
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  background: var(--gwb-ground); color: var(--gwb-ink);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13.5px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .gwb-root {
    --gwb-surface: #171f1e; --gwb-ground: #101615; --gwb-ink: #e4ebe8;
    --gwb-faint: #7a8885; --gwb-rule: #2b3735; --gwb-accent: #58bc9e;
    --gwb-accent-bg: #17302a; --gwb-danger: #e66767;
  }
}
:root[data-theme="dark"] .gwb-root {
  --gwb-surface: #171f1e; --gwb-ground: #101615; --gwb-ink: #e4ebe8;
  --gwb-faint: #7a8885; --gwb-rule: #2b3735; --gwb-accent: #58bc9e;
  --gwb-accent-bg: #17302a; --gwb-danger: #e66767;
}

.gwb-root *, .gwb-root *::before, .gwb-root *::after { box-sizing: border-box; }

.gwb-toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 8px 14px; background: var(--gwb-surface);
  border-bottom: 1px solid var(--gwb-rule); flex: none;
}
.gwb-brand { font-weight: 650; letter-spacing: -0.01em; }
.gwb-tools { display: flex; align-items: center; gap: 8px; }

.gwb-body { display: flex; flex: 1 1 auto; min-height: 0; }
.gwb-preview { flex: 1 1 auto; min-width: 0; overflow: auto; }
.gwb-inspector {
  flex: none; width: 320px; overflow: auto; padding: 14px;
  background: var(--gwb-surface); border-left: 1px solid var(--gwb-rule);
}

.gwb-heading {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  font-size: 11.5px; font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase;
  color: var(--gwb-faint); margin: 16px 0 8px;
}
.gwb-heading:first-child { margin-top: 0; }

.gwb-list { list-style: none; margin: 0 0 4px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.gwb-listitem {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  padding: 6px 8px; border: 1px solid transparent; border-radius: 6px;
  background: none; color: inherit; font: inherit; cursor: pointer;
}
.gwb-listitem:hover { background: var(--gwb-ground); }
.gwb-listitem.gwb-on { background: var(--gwb-accent-bg); border-color: var(--gwb-accent); }
.gwb-listitem:focus-visible { outline: 2px solid var(--gwb-accent); outline-offset: 1px; }
.gwb-listtype {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--gwb-faint); border: 1px solid var(--gwb-rule);
  border-radius: 3px; padding: 1px 5px; flex: none;
}

.gwb-row { display: grid; grid-template-columns: 92px 1fr; align-items: center; gap: 8px; margin-bottom: 6px; }
.gwb-label { color: var(--gwb-faint); font-size: 12px; }
.gwb-control { min-width: 0; }
.gwb-input {
  width: 100%; padding: 5px 8px; font: inherit; font-size: 12.5px;
  color: var(--gwb-ink); background: var(--gwb-ground);
  border: 1px solid var(--gwb-rule); border-radius: 5px;
}
.gwb-input:focus-visible { outline: 2px solid var(--gwb-accent); outline-offset: -1px; }

.gwb-fieldset { border: 1px solid var(--gwb-rule); border-radius: 6px; padding: 10px; margin: 0 0 10px; }
.gwb-fieldset legend { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--gwb-faint); padding: 0 4px; }
.gwb-item { border-left: 2px solid var(--gwb-rule); padding-left: 8px; margin-bottom: 8px; }
.gwb-group { display: contents; }

.gwb-mini {
  padding: 4px 10px; font: inherit; font-size: 12px; cursor: pointer;
  color: var(--gwb-ink); background: var(--gwb-surface);
  border: 1px solid var(--gwb-rule); border-radius: 5px;
}
.gwb-mini:hover:not(:disabled) { border-color: var(--gwb-accent); }
.gwb-mini:disabled { opacity: 0.45; cursor: default; }
.gwb-primary { background: var(--gwb-accent); border-color: var(--gwb-accent); color: #fff; }
.gwb-danger { color: var(--gwb-danger); }

.gwb-hint { color: var(--gwb-faint); font-size: 12.5px; line-height: 1.5; }
.gwb-hint strong { color: var(--gwb-ink); font-weight: 600; }

/* ---- inspector tabs ---- */
.gwb-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
.gwb-tab {
  flex: 1; padding: 6px 10px; font: inherit; font-size: 12.5px; cursor: pointer;
  color: var(--gwb-faint); background: none;
  border: 1px solid var(--gwb-rule); border-radius: 6px;
}
.gwb-tab:hover { color: var(--gwb-ink); }
.gwb-tab.gwb-on {
  color: var(--gwb-accent); background: var(--gwb-accent-bg); border-color: var(--gwb-accent);
  font-weight: 600;
}
.gwb-tab:focus-visible { outline: 2px solid var(--gwb-accent); outline-offset: 1px; }

/* ---- validation ---- */
.gwb-issues {
  border: 1px solid var(--gwb-danger); border-radius: 6px;
  padding: 8px 10px; margin-bottom: 12px; font-size: 12px;
}
.gwb-issues strong { color: var(--gwb-danger); display: block; margin-bottom: 4px; }
.gwb-issues ul { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 3px; }
.gwb-issues code { font-family: ui-monospace, monospace; font-size: 11px; color: var(--gwb-faint); }
.gwb-issues p { margin: 6px 0 0; }

/* ---- model editor ---- */
.gwb-section { border-bottom: 1px solid var(--gwb-rule); padding: 8px 0; }
.gwb-section > summary {
  cursor: pointer; font-size: 11.5px; font-weight: 650;
  letter-spacing: 0.05em; text-transform: uppercase; color: var(--gwb-faint);
  display: flex; align-items: center; gap: 8px;
}
.gwb-section > summary::-webkit-details-marker { display: none; }
.gwb-section > summary::marker { content: ""; }
.gwb-section > summary::before {
  content: ""; flex: none; width: 0; height: 0;
  border-left: 4px solid currentColor;
  border-top: 3.5px solid transparent; border-bottom: 3.5px solid transparent;
  transition: transform 120ms ease; transform-origin: 25% 50%;
}
.gwb-section[open] > summary::before { transform: rotate(90deg); }
.gwb-section > summary:hover { color: var(--gwb-ink); }
.gwb-section > summary:focus-visible { outline: 2px solid var(--gwb-accent); outline-offset: 2px; }
.gwb-section[open] > summary { margin-bottom: 10px; color: var(--gwb-ink); }
.gwb-count {
  font-size: 10px; letter-spacing: 0; color: var(--gwb-faint);
  border: 1px solid var(--gwb-rule); border-radius: 8px; padding: 0 6px;
}

/* Eight measures in a row need more air between them than the property form's
   nested groups do, or the list reads as one wall of inputs. */
.gwb-model .gwb-item { margin-bottom: 16px; padding-bottom: 4px; }
.gwb-model .gwb-item:last-of-type { margin-bottom: 10px; }

.gwb-modelnote { margin: 0 0 14px; }

.gwb-pair { display: flex; gap: 6px; align-items: center; }
.gwb-pair > .gwb-input { flex: 1 1 0; min-width: 0; }
.gwb-pair > .gwb-mini { flex: none; }

.gwb-expr {
  font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.45;
  resize: vertical; display: block;
}

.gwb-checks {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-wrap: wrap; gap: 2px 10px;
}
.gwb-check { display: flex; align-items: center; gap: 5px; font-size: 12.5px; cursor: pointer; }

/* An expression answers as it is typed: what it resolved to, or what is wrong. */
.gwb-issue { margin: 2px 0 8px; font-size: 12px; color: var(--gwb-danger); }
.gwb-ok { margin: 2px 0 8px; font-size: 12px; color: var(--gwb-faint); }

/* ---- brand colours ---- */

.gwb-swatchrow {
  display: grid; grid-template-columns: 30px 1fr auto auto; gap: 8px;
  align-items: center; margin-bottom: 8px;
}
.gwb-swatch {
  width: 30px; height: 26px; padding: 0; border: 1px solid var(--gwb-rule);
  border-radius: 5px; background: none; cursor: pointer;
}
/* The native swatch inset leaves a border inside a border. */
.gwb-swatch::-webkit-color-swatch-wrapper { padding: 2px; }
.gwb-swatch::-webkit-color-swatch { border: 0; border-radius: 3px; }
.gwb-swatch::-moz-color-swatch { border: 0; border-radius: 3px; }
.gwb-hex { font-family: ui-monospace, monospace; text-transform: lowercase; }
.gwb-brandrow { grid-template-columns: 30px 1fr auto; }

.gwb-verdict { font-size: 11px; font-weight: 650; }
.gwb-verdict-pass { color: var(--gwb-accent); }
.gwb-verdict-warn { color: #9a6700; }
.gwb-verdict-fail { color: var(--gwb-danger); }
:root[data-theme="dark"] .gwb-verdict-warn { color: #d4a017; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .gwb-verdict-warn { color: #d4a017; }
}

/* The explanation belongs under the colour it is about, across the full row. */
.gwb-verdict-note {
  grid-column: 1 / -1; margin: 2px 0 8px;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
}
.gwb-dot {
  display: inline-block; width: 11px; height: 11px; border-radius: 50%;
  border: 1px solid var(--gwb-rule); flex: none;
}
.gwb-pairs { margin-top: 10px; }
.gwb-paste { resize: vertical; font-family: ui-monospace, monospace; min-height: 56px; }

.gwb-presets { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.gwb-preset {
  display: flex; align-items: center; gap: 10px; text-align: left;
  padding: 7px 9px; border: 1px solid var(--gwb-rule); border-radius: 6px;
  background: var(--gwb-surface); color: var(--gwb-ink); cursor: pointer;
  font: inherit;
}
.gwb-preset:hover { border-color: var(--gwb-accent); }
.gwb-preset:focus-visible { outline: 2px solid var(--gwb-accent); outline-offset: 1px; }
.gwb-preset-swatches { display: flex; flex: none; border-radius: 3px; overflow: hidden; }
.gwb-preset-swatches span { width: 13px; height: 15px; }

.gwb-modes { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.gwb-ramp { display: flex; border-radius: 4px; overflow: hidden; margin-top: 3px; }
.gwb-ramp span { flex: 1; height: 22px; }

/* ---- direct manipulation ---- */

/* The chrome sits over the panel but lets every click through, so a bar still
   cross-filters while you are editing. Only the grip and the eight handles take
   the pointer, and they are the only things that need it. */
.gwb-chrome { position: absolute; inset: 0; pointer-events: none; border-radius: 8px; }
.gwb-chrome::after {
  content: ""; position: absolute; inset: 0; border-radius: 8px;
  border: 2px solid transparent; transition: border-color 120ms ease;
}
.gw-panel:hover .gwb-chrome::after { border-color: var(--gwb-rule); }
.gwb-chrome.gwb-on::after { border-color: var(--gwb-accent); }

.gwb-grip {
  position: absolute; top: 0; left: 0; right: 0; height: 18px;
  pointer-events: auto; cursor: grab; touch-action: none;
  display: flex; align-items: center; justify-content: center;
  border: 0; background: transparent; padding: 0;
  opacity: 0; transition: opacity 120ms ease;
  border-radius: 8px 8px 0 0;
}
.gw-panel:hover .gwb-grip, .gwb-chrome.gwb-on .gwb-grip { opacity: 1; }
.gwb-grip:focus-visible { opacity: 1; outline: 2px solid var(--gwb-accent); outline-offset: -2px; }
.gwb-grip:active { cursor: grabbing; }
.gwb-grip-dots {
  width: 26px; height: 4px; border-radius: 2px;
  background: var(--gwb-faint); opacity: 0.55;
  /* Two rows of dots, drawn rather than shipped as an image. */
  background-image: radial-gradient(circle, var(--gwb-surface) 0.8px, transparent 0.9px);
  background-size: 4px 4px;
}

.gwb-handle {
  position: absolute; pointer-events: auto; touch-action: none;
  border: 0; padding: 0; background: transparent;
  opacity: 0; transition: opacity 120ms ease;
}
.gw-panel:hover .gwb-handle, .gwb-chrome.gwb-on .gwb-handle { opacity: 1; }

/* Edges take a thin strip; corners take a square that sits on top of both. */
.gwb-handle-n, .gwb-handle-s { left: 10px; right: 10px; height: 8px; cursor: ns-resize; }
.gwb-handle-e, .gwb-handle-w { top: 10px; bottom: 10px; width: 8px; cursor: ew-resize; }
.gwb-handle-n { top: 0; }
.gwb-handle-s { bottom: 0; }
.gwb-handle-e { right: 0; }
.gwb-handle-w { left: 0; }

.gwb-handle-ne, .gwb-handle-nw, .gwb-handle-se, .gwb-handle-sw { width: 14px; height: 14px; }
.gwb-handle-nw { top: 0; left: 0; cursor: nwse-resize; }
.gwb-handle-ne { top: 0; right: 0; cursor: nesw-resize; }
.gwb-handle-sw { bottom: 0; left: 0; cursor: nesw-resize; }
.gwb-handle-se { bottom: 0; right: 0; cursor: nwse-resize; }

/* Only the corners are drawn. Eight visible pips around every panel is a lot of
   furniture for a dashboard you are also trying to read. */
.gwb-handle-ne::after, .gwb-handle-nw::after,
.gwb-handle-se::after, .gwb-handle-sw::after {
  content: ""; position: absolute; inset: 3px;
  background: var(--gwb-surface); border: 1.5px solid var(--gwb-accent); border-radius: 2px;
}

/* The panel under the pointer steps back so the ghost is the thing you read. */
.gwb-gesturing .gw-panel { opacity: 0.55; transition: opacity 80ms ease; }
.gwb-gesturing .gw-panel * { pointer-events: none; }

.gwb-ghost {
  border: 2px dashed var(--gwb-accent); border-radius: 8px;
  background: var(--gwb-accent-bg); opacity: 0.9;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; color: var(--gwb-accent);
  font-variant-numeric: tabular-nums; pointer-events: none;
}

.gwb-scrim { position: absolute; inset: 0; z-index: 19; background: rgb(0 0 0 / 0.32); }
.gwb-export {
  position: absolute; inset: 10% 12%; display: flex; flex-direction: column;
  background: var(--gwb-surface); border: 1px solid var(--gwb-rule);
  border-radius: 10px; box-shadow: 0 12px 40px rgb(0 0 0 / 0.22); overflow: hidden;
}
.gwb-export header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid var(--gwb-rule);
}
.gwb-export textarea {
  flex: 1; border: 0; resize: none; padding: 14px;
  font-family: ui-monospace, monospace; font-size: 12.5px; line-height: 1.5;
  color: var(--gwb-ink); background: var(--gwb-surface);
}
`;
