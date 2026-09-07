/**
 * The workspace's own stylesheet.
 *
 * Kept with the demo rather than in `@gridwright/workspace` for the same reason
 * the dashboard's styles are injectable: a consumer embedding the workspace in
 * their own product has a design system already, and a package that ships
 * opinionated chrome makes that a fight rather than a choice.
 *
 * Both themes are defined at token level on `:root`, with the dark set
 * redefined under `prefers-color-scheme` and again under an explicit
 * `data-theme`, so a page renders correctly whether the viewer chose a theme or
 * left it on system.
 */
export const styles = `
:root {
  --gww-ground: #f6f8f7;
  --gww-surface: #ffffff;
  --gww-ink: #14201e;
  --gww-ink-soft: #3d4d4a;
  --gww-faint: #6b7a77;
  --gww-rule: #dce4e1;
  --gww-accent: #1e6f5c;
  --gww-accent-bg: #e6f0ec;
  --gww-alarm: #b3261e;
  --gww-alarm-bg: #fbeceb;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --gww-ground: #0e1413; --gww-surface: #161e1d; --gww-ink: #e5ebe9;
    --gww-ink-soft: #b9c5c2; --gww-faint: #7b8986; --gww-rule: #2a3634;
    --gww-accent: #58bc9e; --gww-accent-bg: #16302a;
    --gww-alarm: #e88b84; --gww-alarm-bg: #2c1614;
  }
}
:root[data-theme="dark"] {
  --gww-ground: #0e1413; --gww-surface: #161e1d; --gww-ink: #e5ebe9;
  --gww-ink-soft: #b9c5c2; --gww-faint: #7b8986; --gww-rule: #2a3634;
  --gww-accent: #58bc9e; --gww-accent-bg: #16302a;
  --gww-alarm: #e88b84; --gww-alarm-bg: #2c1614;
}

body { margin: 0; background: var(--gww-ground); color: var(--gww-ink); }
.gww-root {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px; line-height: 1.55;
  max-width: 1240px; margin: 0 auto; padding: 24px 20px 64px;
}
.gww-root *, .gww-root *::before, .gww-root *::after { box-sizing: border-box; }

.gww-head { border-bottom: 1px solid var(--gww-rule); padding-bottom: 16px; margin-bottom: 18px; }
.gww-head h1 { font-size: 24px; line-height: 1.2; margin: 0 0 12px; text-wrap: balance; }
.gww-root h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--gww-faint); margin: 0 0 10px; }
.gww-root h3 { font-size: 13px; margin: 16px 0 6px; }

/* The scope every surface shares, stated once at the top so a reader never has
   to work out which period a figure belongs to. */
.gww-scope { display: flex; flex-wrap: wrap; gap: 6px 28px; margin: 0; }
/* Each entry may be narrower than its content — a filter list is one long
   string, and a flex item defaults to min-width:auto, which refuses to shrink
   below it and pushes the whole document sideways. */
.gww-scope > div { min-width: 0; max-width: 100%; }
.gww-scope dd { overflow-wrap: anywhere; }
.gww-scope dt { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--gww-faint); }
.gww-scope dd { margin: 0; font-variant-numeric: tabular-nums; }

.gww-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); gap: 24px; }
.gww-chat, .gww-report {
  background: var(--gww-surface); border: 1px solid var(--gww-rule);
  border-radius: 10px; padding: 16px 18px; min-width: 0;
}
/* The table scrolls inside its own box rather than widening the page. */
.gww-report { overflow-x: auto; }
.gww-table-scroll { overflow-x: auto; max-width: 100%; }

.gww-claims { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
.gww-statement { margin: 0 0 3px; font-size: 15px; }
.gww-receipt { margin: 0; font-size: 11.5px; color: var(--gww-faint); }
.gww-receipt code { font-family: ui-monospace, monospace; color: var(--gww-accent); }
.gww-receipt-label { text-transform: uppercase; letter-spacing: 0.07em; font-size: 10px; }
.gww-untraceable { color: var(--gww-alarm); }

/* Loud, and above the numbers. A quiet warning underneath is how a page gets
   screenshotted without the warning. */
.gww-disagreement {
  background: var(--gww-alarm-bg); border: 1px solid var(--gww-alarm);
  border-radius: 8px; padding: 12px 16px; margin-bottom: 18px;
}
.gww-disagreement strong { color: var(--gww-alarm); display: block; margin-bottom: 6px; }
.gww-disagreement ul { margin: 0; padding-left: 18px; }
.gww-partial {
  background: var(--gww-accent-bg); border-left: 3px solid var(--gww-accent);
  padding: 8px 14px; margin: 0 0 18px; border-radius: 0 6px 6px 0;
}

.gww-evidence { border-top: 1px solid var(--gww-rule); margin-top: 18px; padding-top: 8px; }
.gww-evidence ul { margin: 0 0 10px; padding-left: 18px; }
.gww-citations q { color: var(--gww-ink-soft); }
.gww-source, .gww-freshness { color: var(--gww-faint); font-size: 12px; }
.gww-caveats { color: var(--gww-ink-soft); font-size: 13px; }
.gww-denied { color: var(--gww-ink-soft); border-left: 3px solid var(--gww-faint); padding-left: 12px; }
.gww-empty { color: var(--gww-faint); }

.gww-diagnostics {
  margin: 24px 0 0; padding: 12px 18px 12px 34px; font-size: 12.5px; color: var(--gww-faint);
  background: var(--gww-surface); border: 1px solid var(--gww-rule); border-radius: 8px;
}

@media (max-width: 860px) {
  .gww-body { grid-template-columns: minmax(0, 1fr); }
  .gww-head h1 { font-size: 20px; }
}
`;
