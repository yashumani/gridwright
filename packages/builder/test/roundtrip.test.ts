import { describe, expect, it } from "vitest";
import { parseManifest, type Manifest } from "@gridwright/schema";
import { exportManifest, initialState, reduce, toYaml } from "@gridwright/builder";

/**
 * Comment-preserving round trip.
 *
 * When engineers hand-write manifests and analysts edit them visually, the
 * first visual save must not delete the notes somebody wrote to explain a
 * measure. A comment in YAML belongs to a node, so the export edits the
 * original document in place rather than re-serialising a fresh one.
 */

const COMMENTED = `# Revenue dashboard
# Owner: the analytics team — ask before changing the measure definitions.
gridwright: 1
title: Sales overview

source:
  kind: file
  files:
    # Exported nightly from the warehouse.
    - { id: sales, path: ./sales.csv, format: csv }

model:
  fields:
    - { name: region, type: string, from: sales.region }   # trailing note
    - { name: amount, type: number, from: sales.amount }

  dimensions:
    - { id: region, field: region, label: Region }

  measures:
    # Gross, not net of returns. See the finance definition doc.
    - { id: revenue, label: Revenue, expr: "sum(amount)", format: "$#,##0" }
    - { id: orders, label: Orders, expr: "count()" }

datasets:
  by_region:
    dimensions: [region]
    measures: [revenue, orders]

panels:
  # The headline number.
  - { id: kpi, type: kpi, dataset: by_region, layout: { x: 0, y: 0, w: 3, h: 2 },
      props: { measure: revenue } }
  # Detail table below it.
  - { id: tbl, type: table, dataset: by_region, layout: { x: 0, y: 2, w: 12, h: 5 },
      props: { columns: [{ ref: region }, { ref: revenue }] } }
`;

function load(): Manifest {
  const r = parseManifest(COMMENTED);
  if (!r.ok) throw new Error(JSON.stringify(r.issues, null, 2));
  return r.manifest;
}

const COMMENTS = [
  "# Revenue dashboard",
  "# Owner: the analytics team",
  "# Exported nightly from the warehouse.",
  "# trailing note",
  "# Gross, not net of returns.",
  "# The headline number.",
  "# Detail table below it.",
];

const keepsAllComments = (yaml: string) => {
  for (const c of COMMENTS) expect(yaml, `lost: ${c}`).toContain(c);
};

describe("comments survive an export", () => {
  it("keeps every comment when nothing changed", () => {
    keepsAllComments(toYaml(load(), COMMENTED));
  });

  it("keeps comments when a panel title changes", () => {
    let s = initialState(load(), COMMENTED);
    s = reduce(s, { type: "updatePanel", id: "kpi", patch: { title: "Revenue" } });
    const yaml = toYaml(s.manifest, s.source);
    keepsAllComments(yaml);
    expect(yaml).toContain("Revenue");
    expect(parseManifest(yaml).ok).toBe(true);
  });

  it("keeps comments when a panel is resized", () => {
    let s = initialState(load(), COMMENTED);
    s = reduce(s, { type: "resizePanel", id: "kpi", w: 6, h: 3 });
    keepsAllComments(toYaml(s.manifest, s.source));
  });

  it("keeps the surviving panels' comments when one is deleted", () => {
    let s = initialState(load(), COMMENTED);
    s = reduce(s, { type: "removePanel", id: "kpi" });
    const yaml = toYaml(s.manifest, s.source);
    expect(yaml).toContain("# Detail table below it.");
    expect(yaml).toContain("# Gross, not net of returns.");
    expect(yaml).not.toContain("id: kpi");
    expect(parseManifest(yaml).ok).toBe(true);
  });

  it("keeps comments when a panel is added", () => {
    let s = initialState(load(), COMMENTED);
    s = reduce(s, {
      type: "addPanel",
      panel: {
        id: "bar", type: "bar", dataset: "by_region",
        layout: { x: 0, y: 7, w: 6, h: 4 },
        props: { category: "region", value: "revenue" },
      },
    });
    const yaml = toYaml(s.manifest, s.source);
    keepsAllComments(yaml);
    expect(yaml).toContain("id: bar");
    expect(parseManifest(yaml).ok).toBe(true);
  });

  it("keeps model comments when only a panel changed", () => {
    let s = initialState(load(), COMMENTED);
    s = reduce(s, { type: "movePanel", id: "tbl", x: 2, y: 3 });
    const yaml = toYaml(s.manifest, s.source);
    // The whole model section is untouched, so it must come back verbatim.
    expect(yaml).toContain('# Gross, not net of returns. See the finance definition doc.');
    expect(yaml).toContain("# trailing note");
  });

  it("still round-trips to an equal manifest", () => {
    let s = initialState(load(), COMMENTED);
    s = reduce(s, { type: "updatePanel", id: "kpi", patch: { title: "Revenue" } });
    s = reduce(s, { type: "resizePanel", id: "tbl", w: 8, h: 4 });

    const { yaml, ok } = exportManifest(s.manifest, s.source);
    expect(ok).toBe(true);
    const back = parseManifest(yaml);
    expect(back.ok, back.ok ? "" : JSON.stringify(back.issues)).toBe(true);
    expect(back.ok && back.manifest).toEqual(s.manifest);
  });

  it("survives repeated edit-and-export cycles without losing comments", () => {
    let text = COMMENTED;
    for (let i = 0; i < 4; i++) {
      const parsed = parseManifest(text);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      let s = initialState(parsed.manifest, text);
      s = reduce(s, { type: "updatePanel", id: "tbl", patch: { title: `Pass ${i}` } });
      text = toYaml(s.manifest, s.source);
    }
    keepsAllComments(text);
    expect(text).toContain("Pass 3");
  });
});

describe("falling back to a fresh document", () => {
  it("writes valid YAML with no original to work from", () => {
    const yaml = toYaml(load());
    expect(parseManifest(yaml).ok).toBe(true);
    // No comment lines — but `#` still appears inside format strings like
    // "$#,##0", so this checks for comments rather than for the character.
    const commentLines = yaml.split("\n").filter((l) => /^\s*#/.test(l));
    expect(commentLines).toEqual([]);
  });

  it("does not fail an export because the original is unparseable", () => {
    const yaml = toYaml(load(), "gridwright: 1\n  : broken: [");
    expect(parseManifest(yaml).ok).toBe(true);
  });

  it("ignores an empty original", () => {
    expect(parseManifest(toYaml(load(), "   ")).ok).toBe(true);
  });

  it("writes fresh documents in the format's reading order", () => {
    const keys = [...toYaml(load()).matchAll(/^(\w+):/gm)].map((m) => m[1]);
    expect(keys).toEqual(["gridwright", "title", "source", "model", "datasets", "panels"]);
  });
});

describe("reordering", () => {
  it("rewrites a list whose order changed, and still validates", () => {
    // Matching by id cannot preserve per-item comments through a reorder;
    // rewriting the list is the honest outcome rather than misattributing them.
    const m = load();
    m.panels = [m.panels[1]!, m.panels[0]!];
    const yaml = toYaml(m, COMMENTED);
    const back = parseManifest(yaml);
    expect(back.ok, back.ok ? "" : JSON.stringify(back.issues)).toBe(true);
    expect(back.ok && back.manifest.panels.map((p) => p.id)).toEqual(["tbl", "kpi"]);
    // Comments outside the reordered list are untouched.
    expect(yaml).toContain("# Gross, not net of returns.");
  });
});
