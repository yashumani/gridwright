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
 *   node scripts/verify-deploy.mjs [--origin https://host/path/] [--mirror]
 *
 * `--mirror` exists for one specific reason. In a sandbox whose outbound
 * traffic goes through an egress proxy, Chromium may not be able to reach the
 * origin at all — every tunnel dies mid-handshake, including the browser's own
 * background requests — while an ordinary HTTP client gets through fine. In
 * that case the check would otherwise be unrunnable. `--mirror` fetches every
 * file this build produced from the live origin, compares it byte for byte
 * against the local artifact, and then drives *those bytes* in the browser.
 * That is two claims — the origin serves exactly this, and exactly this
 * renders — and the output says which mode ran, because a fallback that hides
 * itself is worse than no fallback.
 *
 * Exits non-zero if any check fails.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { serveDist } from "./lib/serve-dist.mjs";

const MIRROR = process.argv.includes("--mirror");
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

/** Every file in the built artifact, as paths relative to dist. */
function builtFiles(dir, prefix = "") {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    return statSync(abs).isDirectory() ? builtFiles(abs, `${prefix}${name}/`) : [`${prefix}${name}`];
  });
}

/**
 * Pulls the whole artifact off the live origin and compares it to this build.
 *
 * Byte equality is a stronger claim than the filename check the browser stage
 * makes: a matching content hash says the deploy is current, matching bytes
 * say nothing rewrote them in transit.
 */
function mirror(origin) {
  const root = mkdtempSync(join(tmpdir(), "gridwright-live-"));
  const differ = [];
  const files = builtFiles(DIST);
  for (const file of files) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    let code = "000";
    try {
      code = execFileSync("curl", ["-sS", "-o", target, "-w", "%{http_code}", `${origin}${file}`], { encoding: "utf8" }).trim();
    } catch (e) {
      differ.push(`${file} (${String(e).split("\n")[0]})`);
      continue;
    }
    if (code !== "200") differ.push(`${file} (http ${code})`);
    else if (!readFileSync(target).equals(readFileSync(join(DIST, file)))) differ.push(`${file} (bytes differ)`);
  }
  record(
    `every deployed file is byte-identical to this build`,
    differ.length === 0,
    differ.length === 0 ? `${files.length}/${files.length} files from ${origin}` : differ.slice(0, 3).join(" | "),
  );
  return root;
}

let served;
let target = ORIGIN;
if (MIRROR) {
  const root = mirror(ORIGIN);
  served = await serveDist({ root, port: 0, prefix: "/mirror" });
  target = `http://127.0.0.1:${served.address().port}/mirror/`;
  console.log(`      (the browser stage below drives those mirrored bytes, not ${ORIGIN})`);
}

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

  const response = await page.goto(target, { waitUntil: "networkidle", timeout: 45_000 });
  record("the demo answers", response?.status() === 200, `${response?.status()} ${target}`);

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
  if (served) served.close();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
