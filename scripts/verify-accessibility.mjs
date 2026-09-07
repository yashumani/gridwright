/**
 * Accessibility evidence for T19, against the built pages.
 *
 * Deterministic checks rather than an audit tool, for one reason worth stating:
 * an automated pass is not an accessible page, and a script that prints "0
 * violations" invites treating it as one. These are the specific failures this
 * project can actually commit — a skipped heading level, a table without header
 * scope, a control nobody can see the focus on, body text at three-to-one — and
 * each is reported with the element that caused it so it can be fixed rather
 * than counted.
 *
 * What it does not cover, and no script does: whether the reading order makes
 * sense, whether a label says something useful, whether a chart's meaning
 * survives without colour. Those need a person.
 *
 *   pnpm build && pnpm --filter @yashumani/gridwright-playground build \
 *     && pnpm --filter @yashumani/gridwright-workspace-demo build
 *   node scripts/verify-accessibility.mjs
 */
import { chromium } from "playwright";
import { resolve } from "node:path";
import { serveDist } from "./lib/serve-dist.mjs";

const TARGETS = [
  { name: "workspace", dist: "apps/workspace-demo/dist", port: 4360, open: null },
  {
    name: "playground",
    dist: "apps/playground/dist",
    port: 4361,
    open: async (page) => {
      await page.getByRole("button", { name: /Sales overview/ }).click();
      await page.waitForSelector("[data-panel]", { timeout: 20_000 });
    },
  },
];

const SIZES = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "phone", width: 390, height: 844 },
];

/**
 * Both themes, because a token set that clears the ratio in one can fail the
 * other — and the dark palette is the one nobody looks at while designing.
 */
const SCHEMES = ["light", "dark"];

const results = [];
const record = (name, passed, detail) => {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const serve = (dist, port) => serveDist({ root: resolve(process.cwd(), dist), port });

/** Runs in the page. Returns findings, not a score. */
const AUDIT = () => {
  const findings = [];
  const say = (rule, detail) => findings.push({ rule, detail });

  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (css) => {
    const m = css.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(",").map((n) => parseFloat(n));
    return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 };
  };
  /** The first ancestor that actually paints a background. */
  const ground = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) return c.rgb;
    }
    return [255, 255, 255];
  };
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  // --- one h1, and no skipped levels ------------------------------------
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")];
  const h1s = headings.filter((h) => h.tagName === "H1");
  if (h1s.length !== 1) say("one-h1", `${h1s.length} level-one headings`);
  let previous = 0;
  for (const h of headings) {
    const level = Number(h.tagName[1]);
    if (previous && level > previous + 1) {
      say("heading-order", `h${previous} followed by h${level}: ${h.textContent?.trim().slice(0, 40)}`);
    }
    previous = level;
  }

  // --- landmarks ---------------------------------------------------------
  if (!document.querySelector("main, [role=main]")) say("landmark-main", "no main landmark");

  // --- tables declare their headers -------------------------------------
  for (const table of document.querySelectorAll("table")) {
    const ths = [...table.querySelectorAll("th")];
    if (ths.length === 0) { say("table-headers", "a table has no th"); continue; }
    const unscoped = ths.filter((th) => !th.getAttribute("scope"));
    if (unscoped.length > 0) {
      say("table-scope", `${unscoped.length} th without scope: ${unscoped[0].textContent?.trim().slice(0, 30)}`);
    }
  }

  // --- controls are labelled --------------------------------------------
  for (const el of document.querySelectorAll("button, a[href], select, input, [role=button]")) {
    const label =
      (el.textContent ?? "").trim() ||
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()) ||
      // A control wrapped in a label is labelled by it. Missing this reports a
      // file input inside its own button as unlabelled, which is a finding
      // about the checker rather than the page.
      el.closest("label")?.textContent?.trim();
    if (!label && el.getAttribute("aria-hidden") !== "true") {
      say("unlabelled-control", `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""}`);
    }
  }

  // --- nobody forces a tab order ----------------------------------------
  for (const el of document.querySelectorAll("[tabindex]")) {
    if (Number(el.getAttribute("tabindex")) > 0) say("positive-tabindex", el.tagName.toLowerCase());
  }

  // --- text is readable against what is behind it -----------------------
  const seen = new Set();
  for (const el of document.querySelectorAll("p,li,td,th,h1,h2,h3,dd,dt,span,strong,code,q")) {
    const text = (el.textContent ?? "").trim();
    if (!text || el.children.length > 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(fg.rgb, ground(el));
    const key = `${cs.color}|${size}`;
    if (got < need && !seen.has(key)) {
      seen.add(key);
      say("contrast", `${got.toFixed(2)}:1 needs ${need}:1 — ${size}px "${text.slice(0, 30)}"`);
    }
  }

  return findings;
};

/** Tab through the page and confirm every stop is visibly focused. */
const FOCUS = async (page) => {
  const invisible = [];
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        visible:
          (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ||
          cs.boxShadow !== "none" ||
          cs.textDecorationLine !== "none",
      };
    });
    if (!state) break;
    if (!state.visible) invisible.push(state.tag);
  }
  return invisible;
};

for (const target of TARGETS) {
  const server = await serve(target.dist, target.port);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium" });
  try {
    for (const size of SIZES) {
     for (const scheme of SCHEMES) {
      const page = await browser.newPage({
        viewport: { width: size.width, height: size.height },
        colorScheme: scheme,
      });
      await page.goto(`http://localhost:${target.port}/`, { waitUntil: "networkidle" });
      if (target.open) await target.open(page);
      await page.waitForTimeout(300);

      const findings = await page.evaluate(AUDIT);
      const byRule = findings.reduce((m, f) => m.set(f.rule, [...(m.get(f.rule) ?? []), f.detail]), new Map());
      for (const rule of ["one-h1", "heading-order", "landmark-main", "table-headers", "table-scope", "unlabelled-control", "positive-tabindex", "contrast"]) {
        const hits = byRule.get(rule) ?? [];
        record(`${target.name} ${size.name} ${scheme}: ${rule}`, hits.length === 0, hits[0] ?? "none");
      }

      const invisible = await FOCUS(page);
      record(`${target.name} ${size.name} ${scheme}: focus visible at every stop`, invisible.length === 0, invisible[0] ?? "none");

      await page.close();
     }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed:");
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
