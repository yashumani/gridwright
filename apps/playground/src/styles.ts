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
.pg-brand { display: flex; align-items: center; gap: 8px; }
.pg-brand strong { font-size: 15px; letter-spacing: -0.015em; font-weight: 650; }
.pg-brand span {
  color: var(--pg-faint); font-size: 11px; letter-spacing: 0.08em;
  text-transform: uppercase; padding-top: 1px;
}
/* Four cells, one filled — the grid, and the panel you are about to place in
   it. Drawn in CSS-reachable colour so it follows the theme like everything
   else, rather than baking a fill into the markup. */
.pg-mark { width: 17px; height: 17px; flex: none; display: block; }
.pg-mark rect { fill: var(--pg-rule); }
.pg-mark .pg-mark-on { fill: var(--pg-accent); }
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
/* ── the landing ──────────────────────────────────────────────────────────
   The one screen every announcement links to, so appearance is function here.

   No web font. The standalone build promises no network requests at all after
   load, and that promise is worth more than a typeface — so the identity is
   carried by scale, spacing, colour and one drawn mark instead. The system
   stack is set deliberately: tight tracking at display sizes, a monospace
   eyebrow, and a real step between each level.                              */

.pg-drop {
  position: relative; flex: 1 1 auto; display: grid; place-items: center;
  padding: 40px 24px; isolation: isolate;
}
/* A grid, because the product is a grid engine — the one decorative move on the
   page, and it says something true about the subject.

   It lives on a pseudo-element rather than on .pg-drop itself: a mask set on
   the container masks its children too, which faded the headline's edges and
   half the example cards along with the decoration. */
.pg-drop::before {
  content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background-image:
    linear-gradient(to right, var(--pg-rule) 1px, transparent 1px),
    linear-gradient(to bottom, var(--pg-rule) 1px, transparent 1px);
  background-size: 56px 56px;
  background-position: center;
  -webkit-mask-image: radial-gradient(ellipse 76% 60% at 50% 40%, #000 15%, transparent 76%);
  mask-image: radial-gradient(ellipse 76% 60% at 50% 40%, #000 15%, transparent 76%);
}
/* The drop target is the whole page, so its active state has to read without
   a visible box sitting there the rest of the time. */
.pg-drop-inner {
  text-align: center; max-width: 660px; width: 100%;
  border: 2px dashed transparent; border-radius: 18px;
  padding: 8px 24px 24px;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.pg-dragging .pg-drop-inner {
  border-color: var(--pg-accent);
  background: color-mix(in srgb, var(--pg-accent) 7%, var(--pg-surface));
}

.pg-eyebrow {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--pg-accent); margin: 0 0 16px;
}
.pg-drop h1 {
  font-size: clamp(30px, 5.2vw, 46px); letter-spacing: -0.032em; line-height: 1.04;
  font-weight: 700; margin: 0 0 16px; text-wrap: balance;
}

/* The builder carries its own brand for standalone use. Embedded here the page
   already has one, and two "Gridwright" bars stacked is the first thing a
   newcomer sees in Build. The host owns its own chrome. */
.pg-root .gwb-brand { display: none; }

.pg-lede {
  color: var(--pg-faint); font-size: 16px; line-height: 1.6;
  margin: 0 auto 28px !important; max-width: 50ch; text-wrap: pretty;
}
.pg-drop code {
  font-family: ui-monospace, monospace; font-size: 0.9em;
  background: var(--pg-ground); padding: 1px 5px; border-radius: 3px;
}

/* The one action that matters gets the size to say so. */
.pg-cta {
  font-size: 15.5px; font-weight: 600; padding: 13px 28px; border-radius: 9px;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.07), 0 6px 18px color-mix(in srgb, var(--pg-accent) 26%, transparent);
  transition: transform 100ms ease, box-shadow 120ms ease;
}
.pg-cta:hover { transform: translateY(-1px); }
.pg-cta:active { transform: translateY(0); }

.pg-or {
  display: flex; align-items: center; gap: 14px;
  color: var(--pg-faint); font-size: 11.5px; letter-spacing: 0.06em;
  text-transform: uppercase; margin: 40px 0 16px;
}
.pg-or::before, .pg-or::after {
  content: ""; flex: 1; height: 1px; background: var(--pg-rule);
}

/* Examples say what you will see, not what schema shape they are. */
/* Three of them, so the columns have to flex: a fixed pair leaves the third
   stranded alone on a second row, which reads as an afterthought. */
.pg-examples {
  display: grid; gap: 10px; text-align: left;
  grid-template-columns: repeat(auto-fit, minmax(196px, 1fr));
}
.pg-example {
  display: grid; grid-template-columns: auto 1fr; column-gap: 11px; row-gap: 3px;
  cursor: pointer; padding: 14px 16px; font: inherit; text-align: left;
  background: var(--pg-surface); color: var(--pg-ink);
  border: 1px solid var(--pg-rule); border-radius: 10px;
  transition: border-color 120ms ease, transform 100ms ease;
}
.pg-example:hover:not(:disabled) { border-color: var(--pg-accent); transform: translateY(-1px); }
.pg-example:disabled { opacity: 0.5; cursor: default; }
.pg-example:focus-visible { outline: 2px solid var(--pg-accent); outline-offset: 2px; }
.pg-example strong { font-size: 13.5px; align-self: center; }
.pg-example span:last-child { grid-column: 2; color: var(--pg-faint); font-size: 12.5px; line-height: 1.45; }

/* Each example gets the shape of the thing it demonstrates rather than an icon
   borrowed from somewhere: one flat table, two joined, a mixed set of forms. */
.pg-example-mark {
  /* Aligned to the title rather than centred on the card: the three titles wrap
     to different depths, and centring put each mark at a different height. */
  grid-row: 1 / span 2; align-self: start; margin-top: 1px;
  width: 26px; height: 26px; flex: none; border-radius: 5px;
  background: var(--pg-accent-bg, color-mix(in srgb, var(--pg-accent) 12%, transparent));
  background-repeat: no-repeat; background-position: center;
}
.pg-mark-flat {
  background-image:
    linear-gradient(var(--pg-accent) 0 0), linear-gradient(var(--pg-accent) 0 0),
    linear-gradient(var(--pg-accent) 0 0);
  background-size: 13px 2px, 13px 2px, 13px 2px;
  background-position: center 8px, center 12.5px, center 17px;
}
.pg-mark-join {
  background-image:
    linear-gradient(var(--pg-accent) 0 0), linear-gradient(var(--pg-accent) 0 0),
    linear-gradient(var(--pg-accent) 0 0);
  background-size: 6px 6px, 6px 6px, 7px 2px;
  background-position: 5px center, 15px center, center center;
}
.pg-mark-forms {
  background-image:
    linear-gradient(var(--pg-accent) 0 0), linear-gradient(var(--pg-accent) 0 0),
    linear-gradient(var(--pg-accent) 0 0);
  background-size: 3px 7px, 3px 12px, 3px 5px;
  /* Four-value background-position has to name both edges. Written as
     "7px bottom 7px" it is three values with a keyword, which is invalid — the
     declaration was dropped and the three bars rendered as one. */
  background-position: left 6px bottom 7px, left 11.5px bottom 7px, left 17px bottom 7px;
}

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
