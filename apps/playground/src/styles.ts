export const appStyles = `
:root { color-scheme: light dark; }
html, body, #root { height: 100%; margin: 0; }

.pg-root {
  --pg-surface: #ffffff; --pg-ground: #f5f7f6; --pg-ink: #15211f;
  --pg-faint: #7c8c88; --pg-rule: #d8e0dd; --pg-accent: #1e6f5c; --pg-bad: #b3261e;
  display: flex; flex-direction: column; height: 100%;
  background: var(--pg-ground); color: var(--pg-ink);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .pg-root {
    --pg-surface: #171f1e; --pg-ground: #101615; --pg-ink: #e4ebe8;
    --pg-faint: #7a8885; --pg-rule: #2b3735; --pg-accent: #58bc9e; --pg-bad: #e66767;
  }
}
:root[data-theme="dark"] .pg-root {
  --pg-surface: #171f1e; --pg-ground: #101615; --pg-ink: #e4ebe8;
  --pg-faint: #7a8885; --pg-rule: #2b3735; --pg-accent: #58bc9e; --pg-bad: #e66767;
}

.pg-root *, .pg-root *::before, .pg-root *::after { box-sizing: border-box; }

.pg-head {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 10px 16px; background: var(--pg-surface);
  border-bottom: 1px solid var(--pg-rule); flex: none;
}
.pg-brand { display: flex; align-items: baseline; gap: 7px; }
.pg-brand strong { font-size: 15px; letter-spacing: -0.01em; }
.pg-brand span { color: var(--pg-faint); font-size: 12.5px; }
.pg-actions { display: flex; align-items: center; gap: 8px; }

.pg-seg { display: inline-flex; border: 1px solid var(--pg-rule); border-radius: 6px; overflow: hidden; }
.pg-seg button {
  padding: 5px 12px; font: inherit; font-size: 12.5px; cursor: pointer;
  background: var(--pg-surface); color: var(--pg-ink); border: 0;
}
.pg-seg button + button { border-left: 1px solid var(--pg-rule); }
.pg-seg .pg-on { background: var(--pg-accent); color: #fff; }

.pg-button, .pg-select {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; font: inherit; font-size: 12.5px; cursor: pointer;
  background: var(--pg-surface); color: var(--pg-ink);
  border: 1px solid var(--pg-rule); border-radius: 6px;
}
.pg-button:hover { border-color: var(--pg-accent); }
.pg-button input[type="file"] { display: none; }
.pg-primary { background: var(--pg-accent); border-color: var(--pg-accent); color: #fff; }
.pg-primary:hover { filter: brightness(1.06); }

.pg-body { flex: 1 1 auto; min-height: 0; overflow: auto; position: relative; }
.pg-body > .gwb-root { height: 100%; }

.pg-drop { flex: 1 1 auto; display: grid; place-items: center; padding: 32px; }
.pg-drop-inner {
  text-align: center; max-width: 460px;
  border: 2px dashed var(--pg-rule); border-radius: 14px;
  padding: 48px 32px; background: var(--pg-surface);
}
.pg-dragging .pg-drop-inner { border-color: var(--pg-accent); background: var(--pg-surface); }
.pg-drop h1 { font-size: 20px; letter-spacing: -0.01em; margin: 0 0 8px; }
.pg-drop p { color: var(--pg-faint); font-size: 13.5px; line-height: 1.5; margin: 0 0 18px; }
.pg-drop code {
  font-family: ui-monospace, monospace; font-size: 0.9em;
  background: var(--pg-ground); padding: 1px 5px; border-radius: 3px;
}

.pg-examples { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.pg-hint { color: var(--pg-faint); font-size: 12.5px; margin: 14px 0 0 !important; }

.pg-issues {
  margin: 12px 16px 0; padding: 12px 14px;
  border: 1px solid var(--pg-bad); border-radius: 8px;
  background: var(--pg-surface); color: var(--pg-bad);
}
.pg-issues pre {
  margin: 6px 0 0; white-space: pre-wrap; word-break: break-word;
  font-family: ui-monospace, monospace; font-size: 12px; color: var(--pg-ink);
}
`;
