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

.gwb-hint { color: var(--gwb-faint); font-size: 12.5px; }

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
