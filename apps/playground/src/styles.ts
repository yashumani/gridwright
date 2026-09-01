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

/* The whole page is the drop target — a newcomer aims at the words, not at a
   small dashed square, and missing the target reads as "it did not work". */
.pg-drop { flex: 1 1 auto; display: grid; place-items: center; padding: 40px 24px; }
.pg-drop-inner {
  text-align: center; max-width: 640px; width: 100%;
  border: 2px dashed transparent; border-radius: 16px;
  padding: 8px 24px 24px;
}
.pg-dragging .pg-drop-inner {
  border-color: var(--pg-accent);
  background: color-mix(in srgb, var(--pg-accent) 6%, var(--pg-surface));
}
.pg-drop h1 {
  font-size: clamp(24px, 3.4vw, 34px); letter-spacing: -0.02em; line-height: 1.15;
  margin: 0 0 12px; text-wrap: balance;
}
/* The builder carries its own brand for standalone use. Embedded here the page
   already has one, and two "Gridwright" bars stacked is the first thing a
   newcomer sees in Build. The host owns its own chrome. */
.pg-root .gwb-brand { display: none; }

.pg-lede {
  color: var(--pg-faint); font-size: 15px; line-height: 1.55;
  margin: 0 auto 24px !important; max-width: 52ch; text-wrap: pretty;
}
.pg-drop code {
  font-family: ui-monospace, monospace; font-size: 0.9em;
  background: var(--pg-ground); padding: 1px 5px; border-radius: 3px;
}

/* The one action that matters gets the size to say so. */
.pg-cta { font-size: 15px; padding: 11px 24px; border-radius: 8px; }

.pg-or {
  display: flex; align-items: center; gap: 14px;
  color: var(--pg-faint); font-size: 12.5px; margin: 32px 0 16px;
}
.pg-or::before, .pg-or::after {
  content: ""; flex: 1; height: 1px; background: var(--pg-rule);
}

/* Examples say what you will see, not what schema shape they are. */
.pg-examples { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; text-align: left; }
@media (max-width: 620px) { .pg-examples { grid-template-columns: 1fr; } }
.pg-example {
  display: flex; flex-direction: column; gap: 4px; cursor: pointer;
  padding: 14px 16px; font: inherit; text-align: left;
  background: var(--pg-surface); color: var(--pg-ink);
  border: 1px solid var(--pg-rule); border-radius: 10px;
}
.pg-example:hover:not(:disabled) { border-color: var(--pg-accent); }
.pg-example:disabled { opacity: 0.5; cursor: default; }
.pg-example:focus-visible { outline: 2px solid var(--pg-accent); outline-offset: 2px; }
.pg-example strong { font-size: 13.5px; }
.pg-example span { color: var(--pg-faint); font-size: 12.5px; line-height: 1.45; }

.pg-busy { color: var(--pg-faint); font-size: 12.5px; }
.pg-hint { color: var(--pg-faint); font-size: 12.5px; margin: 12px 0 0 !important; }

/* Says the dashboard was guessed, and offers the way to correct it. */
.pg-guessed {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  margin: 12px 16px 0; padding: 10px 14px; font-size: 13px; line-height: 1.5;
  background: var(--pg-surface); border: 1px solid var(--pg-rule);
  border-left: 3px solid var(--pg-accent); border-radius: 8px;
}
.pg-guessed strong { color: var(--pg-ink); }
.pg-guessed > div { color: var(--pg-faint); }
.pg-guessed .pg-button { flex: none; }

/* The file behind the dashboard. A newcomer cannot connect the two unless
   they can see them at the same time. */
.pg-scrim {
  position: absolute; inset: 0; z-index: 19;
  background: rgb(0 0 0 / 0.32);
}
.pg-sheet {
  position: absolute; inset: 8% 10%; z-index: 20;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--pg-surface); border: 1px solid var(--pg-rule);
  border-radius: 12px; box-shadow: 0 16px 48px rgb(0 0 0 / 0.24);
}
.pg-sheet header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
  padding: 14px 16px; border-bottom: 1px solid var(--pg-rule);
}
.pg-sheet header p {
  margin: 4px 0 0; color: var(--pg-faint); font-size: 12.5px; line-height: 1.5; max-width: 60ch;
}
.pg-sheet header code {
  font-family: ui-monospace, monospace; font-size: 0.92em;
  background: var(--pg-ground); padding: 1px 5px; border-radius: 3px;
}
.pg-sheet-actions { display: flex; gap: 8px; flex: none; }
.pg-sheet textarea {
  flex: 1; border: 0; resize: none; padding: 14px 16px; width: 100%;
  font-family: ui-monospace, monospace; font-size: 12.5px; line-height: 1.55;
  color: var(--pg-ink); background: var(--pg-surface);
}
.pg-sheet textarea:focus-visible { outline: 2px solid var(--pg-accent); outline-offset: -2px; }

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
