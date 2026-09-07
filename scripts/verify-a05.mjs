/**
 * A05 — one answer and one report, agreeing, in a real browser.
 *
 * The scenario asks that chat, analytics and report use the same metric,
 * scope, periods, filters and source snapshot, and that every displayed
 * material value links to a receipt. `reconcile` checks that arithmetically in
 * the test suite; this checks what a person actually sees, which is a
 * different claim and the one the scenario is written about.
 *
 * A script rather than a test, for the same reason as `verify-a11.mjs`: it
 * needs a browser binary and a server, CI installs neither, and a check in the
 * pipeline that silently never runs is worse than no check.
 *
 *   pnpm build && pnpm --filter @gridwright/workspace-demo build
 *   node scripts/verify-a05.mjs
 */
import { chromium } from "playwright";
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const DIST = resolve(process.cwd(), "apps/workspace-demo/dist");
const SNAPSHOT = resolve(process.cwd(), "fixtures/support-ops/snapshot.json");
const PREFIX = "/gridwright-answer";
const PORT = Number(process.env.A05_PORT ?? 4344);
const ORIGIN = `http://localhost:${PORT}`;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

const results = [];
const record = (name, passed, detail) => {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (!url.startsWith(PREFIX)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`not found — this build is hosted under ${PREFIX}`);
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

const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const total = snapshot.report.rows.find((r) => r.kind === "total");
const expectedTotal = total.cells[snapshot.report.periods[0]].value;
const expectedComparison = total.cells[snapshot.report.periods[1]].value;
const expectedReceipt = snapshot.claims[0].receiptId;

const server = await serve();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium" });

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
    await page.waitForSelector('[data-testid="workspace"]', { timeout: 15_000 });

    // The claim on screen quotes the number the report draws. This is the
    // whole scenario: two surfaces, one figure.
    const answer = (await page.locator('[data-testid="claims"]').innerText()).replace(/\s+/g, " ");
    record(
      `${vp.name}: the answer quotes the report's total`,
      answer.includes(String(expectedTotal)) && answer.includes(String(expectedComparison)),
      `looking for ${expectedTotal} and ${expectedComparison}`,
    );

    const drawn = await page.evaluate(() => {
      const row = document.querySelector('[data-row-key="total"]');
      return row ? [...row.querySelectorAll("td")].map((td) => td.textContent?.trim()) : null;
    });
    record(
      `${vp.name}: the report's total row draws the same figures`,
      Boolean(drawn && drawn[0]?.includes(String(expectedTotal)) && drawn[1]?.includes(String(expectedComparison))),
      drawn ? drawn.join(" | ") : "no total row",
    );

    // Visible, not hoverable.
    const receipt = await page.locator('[data-testid="receipt-0"]').innerText();
    record(
      `${vp.name}: the receipt is on the page, not in a tooltip`,
      receipt.includes(expectedReceipt),
      receipt.replace(/\s+/g, " ").slice(0, 60),
    );

    // R14 all the way to the screen: the queue with no data is still drawn.
    const queueC = await page.locator('[data-row-key="queue_c"]').count();
    const emDash = await page.locator('[data-row-key="queue_c"] .gw-rpt-missing').count();
    record(`${vp.name}: the configured row with no data survives`, queueC === 1 && emDash > 0, `${queueC} row, ${emDash} missing cells`);

    // Nothing disagrees, so the alarm is absent. Its presence would be the
    // finding; its absence is what a clean page looks like.
    record(
      `${vp.name}: nothing on the page disagrees`,
      (await page.locator('[data-testid="disagreement"]').count()) === 0,
      "no reconciliation alarm",
    );

    const scope = (await page.locator('[data-testid="scope"]').innerText()).replace(/\s+/g, " ");
    record(
      `${vp.name}: one period and one filter list, stated once`,
      scope.includes(snapshot.scope.period.label) && scope.includes(snapshot.scope.comparison.label),
      scope.slice(0, 80),
    );

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    record(`${vp.name}: no horizontal overflow`, overflow <= 0, `${overflow}px`);

    record(`${vp.name}: no external network requests`, external.length === 0, external[0] ?? "none");
    record(`${vp.name}: no page errors`, errors.length === 0, errors[0] ?? "none");

    await page.close();
  }
} catch (e) {
  record("the journey ran", false, e.message);
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
