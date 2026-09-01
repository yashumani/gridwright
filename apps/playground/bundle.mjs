/**
 * Produces one self-contained HTML file: the app, its styles and the example
 * data all inlined, so the page runs with no network access whatsoever.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dist = "dist";
const assets = readdirSync(join(dist, "assets"));
const js = readFileSync(join(dist, "assets", assets.find((f) => f.endsWith(".js"))), "utf8");

const files = [
  "sales-overview.gw.yaml", "sales.csv",
  "orders-star.gw.yaml", "orders.csv", "customers.csv", "products.csv",
];
const embedded = Object.fromEntries(
  files.map((f) => [f, readFileSync(join("../../examples", f), "utf8")]),
);

// A literal </script> inside either payload would close the tag early.
const safe = (s) => s.replaceAll("</script", "<\\/script");

// The app paints its own surfaces once mounted; these tokens cover the moment
// before that, so the page never flashes the host's ground. Both themes are
// declared at :root so the un-stamped "system" state resolves correctly.
// The charset has to be declared in the document. Opened from file://, or
// from any host that serves HTML without one, there is no header to say what
// the bytes mean — the browser falls back to a legacy encoding and every
// em-dash, ellipsis and "×" in the app renders as mojibake. It must also come
// within the first 1024 bytes, which is why it leads.
const html = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gridwright Playground</title>
<style>
  :root { --boot-bg: #f5f7f6; --boot-ink: #15211f; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { --boot-bg: #101615; --boot-ink: #e4ebe8; }
  }
  :root[data-theme="dark"] { --boot-bg: #101615; --boot-ink: #e4ebe8; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--boot-bg); color: var(--boot-ink); }
  #root { height: 100%; }
</style>
<div id="root"></div>
<script>window.__GW_FILES__ = ${safe(JSON.stringify(embedded))};</script>
<script type="module">${safe(js)}</script>
`;

writeFileSync("dist/standalone.html", html);
console.log(`standalone.html: ${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB`);
