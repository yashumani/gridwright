/**
 * Smoke test for the deployed demo — R26's "verified same-commit artifact".
 *
 * The other checkers drive a build on loopback. This one drives whatever is
 * actually published, which is a different claim: a deploy can serve a stale
 * commit, lose an asset to a wrong base path, or answer over a redirect chain
 * that only breaks for someone else's browser. None of that shows up locally.
 *
 * The same-commit check is the one worth explaining. `apps/playground/dist`
 * names its bundle with a content hash, so if the file the live page pulls has
 * the same name as the file this working tree just built, the deploy is
 * serving this commit's artifact. A matching hash is evidence; a mismatch says
 * the deploy is behind and names both.
 *
 *   pnpm build && pnpm --filter @gridwright/playground build
 *   node scripts/verify-deploy.mjs [--origin https://host/path/]
 *
 * Exits non-zero if any check fails.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const arg = process.argv.indexOf("--origin");
const ORIGIN = (arg > -1 ? process.argv[arg + 1] : process.env.DEPLOY_ORIGIN ?? "https://yashumani.github.io/gridwright/").replace(/\/?$/, "/");
const DIST = resolve(process.cwd(), "apps/playground/dist");

/** The bundle this working tree built, by name. */
const localBundle = (readFileSync(resolve(DIST, "index.html"), "utf8").match(/assets\/index-[A-Za-z0-9_-]+\.js/) ?? [])[0];
if (!localBundle) {
  console.error("no bundle in apps/playground/dist/index.html — build the playground first");
  process.exit(2);
}

const results = [];
const record = (name, passed, detail) => {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium",
  // The session reaches the internet through a policy proxy whose CA is
  // already in the browser's trust store. Verification stays on.
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } } : {}),
});

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const bad = [];
  const errors = [];
  page.on("response", (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  const response = await page.goto(ORIGIN, { waitUntil: "networkidle", timeout: 45_000 });
  record("the demo answers", response?.status() === 200, `${response?.status()} ${ORIGIN}`);

  const served = await page.evaluate(() =>
    [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")).join(" "),
  );
  record(
    "the deploy is serving this commit's bundle",
    served.includes(localBundle.replace("assets/", "")),
    served.includes(localBundle.replace("assets/", "")) ? localBundle : `live ${served || "none"} vs local ${localBundle}`,
  );

  record("no asset is missing", bad.length === 0, bad.slice(0, 3).join(" | ") || "none");
  record("no page errors", errors.length === 0, errors.slice(0, 2).join(" | ") || "none");

  const heading = (await page.locator("h1").first().textContent())?.trim() ?? "";
  record("the landing screen rendered", heading.length > 0, heading || "no h1");

  // The demo exists so a stranger can open a dashboard without installing
  // anything, so that is the journey to check, not just that HTML arrived.
  await page.getByRole("button", { name: /Sales overview/ }).click();
  await page.waitForSelector("[data-panel]", { timeout: 20_000 });
  const panels = await page.locator("[data-panel]").count();
  record("a bundled example opens and draws panels", panels > 0, `${panels} panels`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  record("no horizontal overflow on a phone", overflow <= 0, `${overflow}px`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
