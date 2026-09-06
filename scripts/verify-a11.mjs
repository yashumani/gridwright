/**
 * A11 — responsive export and deployment, checked in a real browser.
 *
 * The scenario asks for desktop, tablet and phone evidence, keyboard and focus
 * flows, an error flow, source-subpath hosting and a clean-environment export.
 * None of that can be read off a diff, so this drives the built playground in
 * Chromium and reports what it saw.
 *
 * Deliberately a script rather than a test. It needs a browser binary and a
 * server, and CI installs neither; pretending otherwise would put a check in
 * the pipeline that silently never runs. Run it against a fresh build:
 *
 *   pnpm build && pnpm --filter @gridwright/playground build
 *   node scripts/verify-a11.mjs
 *
 * Exits non-zero if any check fails, so it can be wired into a release runbook
 * step where a browser is available.
 */
import { chromium } from "playwright";
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const DIST = resolve(process.cwd(), "apps/playground/dist");
/** Served under a project path, because that is where the demo actually lives. */
const PREFIX = "/gridwright";
const PORT = Number(process.env.A11_PORT ?? 4318);
const ORIGIN = `http://localhost:${PORT}`;

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".csv": "text/csv",
  ".yaml": "text/yaml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "phone", width: 390, height: 844 },
];

const results = [];
const record = (name, passed, detail) => {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/**
 * Serves the build under a subpath and nothing at the root.
 *
 * A root that 404s is the point: an asset referenced absolutely would work in
 * development and break here, which is exactly the deployment this has to
 * prove.
 */
function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (!url.startsWith(PREFIX)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found — this build is hosted under " + PREFIX);
      return;
    }
    const rel = url.slice(PREFIX.length) || "/";
    const candidate = join(DIST, rel);
    const file = existsSync(candidate) && !candidate.endsWith("/") ? candidate : join(DIST, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

const server = await serve();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium",
});

try {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const errors = [];
    const external = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("request", (r) => {
      if (!r.url().startsWith(ORIGIN) && !r.url().startsWith("data:")) external.push(r.url());
    });

    await page.goto(`${ORIGIN}${PREFIX}/`, { waitUntil: "networkidle" });

    // Subpath hosting: the app is running, not a blank page with a 404 script.
    const mounted = await page.locator("#root *").count();
    record(`${vp.name}: loads from ${PREFIX}/`, mounted > 0, `${mounted} nodes under #root`);

    // No sideways scroll. The single most common responsive defect, and the
    // one a screenshot at one width will not show you.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    record(`${vp.name}: no horizontal overflow`, overflow <= 0, `${overflow}px`);

    // Load an example, so the checks below run against a real dashboard rather
    // than the landing screen.
    await page.getByRole("button", { name: /Sales overview/ }).click();
    await page.waitForSelector("[data-panel]", { timeout: 20_000 });
    const panels = await page.locator("[data-panel]").count();
    record(`${vp.name}: renders the example dashboard`, panels > 0, `${panels} panels`);

    const overflowAfter = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    record(`${vp.name}: no horizontal overflow with a dashboard`, overflowAfter <= 0, `${overflowAfter}px`);

    // Keyboard and focus: something reachable by Tab, and visibly focused.
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        outline: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0,
        shadow: s.boxShadow !== "none",
      };
    });
    record(
      `${vp.name}: Tab reaches a control`,
      focus !== null,
      focus ? focus.tag : "focus stayed on body",
    );
    record(
      `${vp.name}: the focused control is visibly focused`,
      Boolean(focus && (focus.outline || focus.shadow)),
      focus ? `outline=${focus.outline} shadow=${focus.shadow}` : "no focus",
    );

    // Clean environment: the product guarantee is that the built page makes no
    // network requests at all after load. Everything must come from this origin.
    record(
      `${vp.name}: no external network requests`,
      external.length === 0,
      external.length ? external.slice(0, 3).join(", ") : "none",
    );

    record(`${vp.name}: no page errors`, errors.length === 0, errors.slice(0, 2).join(" | ") || "none");

    await page.close();
  }

  // Error flow, once: a file the app cannot read is reported, not swallowed and
  // not a crash.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${ORIGIN}${PREFIX}/`, { waitUntil: "networkidle" });
  await page.setInputFiles("input[type=file]", {
    name: "broken.gw.yaml",
    mimeType: "text/yaml",
    buffer: Buffer.from("gridwright: 1\npanels: this is not a list\n"),
  });
  await page.waitForTimeout(1500);
  const said = await page.locator("body").innerText();
  record(
    "error flow: an unreadable file is reported to the reader",
    /problem|invalid|could not|error|expected/i.test(said),
    said.slice(0, 90).replace(/\s+/g, " "),
  );
  record("error flow: the app did not crash", errors.length === 0, errors[0] ?? "none");
  await page.close();
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed:");
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
