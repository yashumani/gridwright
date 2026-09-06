import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  Revisions,
  RevisionError,
  type ConfigurationSource,
} from "../src/revisions.js";
import { fillReport, type ViewRow } from "../src/fill.js";
import type { BindingSpec, MetadataSnapshot } from "../src/bindings.js";

const fixturePath = (p: string) =>
  fileURLToPath(new URL(`../../../fixtures/support-ops/${p}`, import.meta.url));
const readJson = (p: string) => JSON.parse(readFileSync(fixturePath(p), "utf8"));

function preparedView(): ViewRow[] {
  const [header, ...lines] = readFileSync(fixturePath("prepared-view.csv"), "utf8")
    .trim()
    .split(/\r?\n/);
  const columns = header!.split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? null])) as ViewRow;
  });
}

function source(): ConfigurationSource {
  const raw = readJson("sql-metadata.json");
  const metadata: MetadataSnapshot = { ...raw.snapshot, metrics: raw.metrics, views: raw.views };
  return {
    workbook: readFileSync(fixturePath("skeleton.xlsx")),
    metadata,
    bindings: readJson("bindings.json") as BindingSpec,
  };
}

/** A fixed clock, so a history is reproducible. */
let tick = 0;
const clock = { now: () => `2026-09-06T00:00:${String(tick++).padStart(2, "0")}Z` };
const fresh = () => {
  tick = 0;
  return Revisions.open(source(), clock);
};

describe("opening", () => {
  it("starts a history from a configuration that compiles", () => {
    const r = fresh();
    expect(r.current().version).toBe(1);
    expect(r.current().status).toBe("valid");
    expect(r.preview().rows).toHaveLength(4);
  });

  it("refuses to open a configuration that does not", () => {
    // A history whose first entry is broken has nothing to preview and nothing
    // to roll back to.
    const broken = source();
    broken.bindings = { ...broken.bindings, metric: "no_such_metric" };
    expect(() => Revisions.open(broken, clock)).toThrow(RevisionError);
    try {
      Revisions.open(broken, clock);
    } catch (e) {
      expect((e as RevisionError).problems.map((p) => p.code)).toContain("metric-unknown");
    }
  });
});

describe("a metadata-only revision", () => {
  it("changes the output without any bridge code changing", () => {
    // A02: change a label, regenerate. The only thing that moved is the
    // workbook's own contents.
    const r = fresh();
    expect(r.preview().rows[0]!.heading).toBe("Queue A");

    const edited = source();
    // Rewrite the skeleton's first heading, as an author would in Excel.
    const xml = readFileSync(fixturePath("skeleton.xlsx"));
    expect(xml.length).toBeGreaterThan(0);
    edited.bindings = { ...edited.bindings };
    // Relabelling through metadata: the metric's label, which the definition
    // carries through untouched.
    edited.metadata = {
      ...edited.metadata,
      metrics: edited.metadata.metrics.map((m) => ({ ...m, label: "Cases closed" })),
    };

    const revision = r.revise(edited);
    expect(revision.status).toBe("valid");
    expect(r.preview().metric.label).toBe("Cases closed");
    expect(r.current().version).toBe(2);
  });

  it("changes a calculation and regenerates", () => {
    const r = fresh();
    const withCalc = { ...source(), calculated: [{ rowKey: "total", expr: "measure(queue_a) * 2" }] };
    expect(r.revise(withCalc).status).toBe("valid");

    const filled = fillReport(r.preview(), {
      rows: preparedView(),
      keyColumn: "queue_key",
      periodColumn: "period",
    });
    expect(filled.rows.find((x) => x.rowKey === "total")!.cells["actual"]!.value).toBe(140);
  });

  it("changes a binding and regenerates", () => {
    const r = fresh();
    const rebound = source();
    rebound.bindings = {
      ...rebound.bindings,
      rows: rebound.bindings.rows.map((b) =>
        b.rowKey === "queue_a" ? { ...b, viewKey: "queue_b" } : b,
      ),
    };
    // queue_a and queue_b would now both read queue_b, which is refused.
    expect(r.revise(rebound).status).toBe("invalid");
    expect(r.current().problems!.map((p) => p.code)).toContain("duplicate-view-key");
  });
});

describe("an invalid draft is kept apart from the last valid version", () => {
  it("records the draft without moving what everyone reads", () => {
    const r = fresh();
    const broken = { ...source(), calculated: [{ rowKey: "total", expr: "measure(nope)" }] };

    const draft = r.revise(broken);
    expect(draft.status).toBe("invalid");
    expect(draft.problems!.map((p) => p.code)).toContain("reference-unknown");

    // Current is the draft, so its author can see what they broke...
    expect(r.current().version).toBe(2);
    expect(r.current().status).toBe("invalid");
    // ...and the preview is still the version that worked.
    expect(r.lastValid().version).toBe(1);
    expect(r.preview().rows).toHaveLength(4);
  });

  it("keeps the draft's problems rather than only a failure flag", () => {
    const r = fresh();
    r.revise({ ...source(), calculated: [{ rowKey: "total", expr: "1 +" }] });
    expect(r.current().problems!.length).toBeGreaterThan(0);
    expect(r.current().definition).toBeUndefined();
  });
});

describe("rollback", () => {
  it("discards a broken draft and returns to the last valid version", () => {
    const r = fresh();
    r.revise({ ...source(), calculated: [{ rowKey: "total", expr: "measure(nope)" }] });
    expect(r.current().status).toBe("invalid");

    const back = r.rollback();
    expect(back.version).toBe(1);
    expect(back.status).toBe("valid");
    expect(r.all()).toHaveLength(1);
  });

  it("does not throw away a valid revision", () => {
    // Abandoning a broken draft and stepping back over working history are
    // different operations; conflating them loses work silently.
    const r = fresh();
    r.revise({ ...source(), calculated: [{ rowKey: "total", expr: "measure(queue_a)" }] });
    expect(r.current().status).toBe("valid");
    expect(r.rollback().version).toBe(2);
    expect(r.all()).toHaveLength(2);
  });

  it("clears a run of consecutive drafts in one call", () => {
    const r = fresh();
    r.revise({ ...source(), calculated: [{ rowKey: "total", expr: "measure(a)" }] });
    r.revise({ ...source(), calculated: [{ rowKey: "total", expr: "measure(b)" }] });
    expect(r.all()).toHaveLength(3);
    expect(r.rollback().version).toBe(1);
    expect(r.all()).toHaveLength(1);
  });
});

describe("export and reopen", () => {
  it("round-trips a configuration to the same definition", () => {
    const r = fresh();
    const pkg = r.export();
    tick = 0;
    const reopened = Revisions.reopen(pkg, clock);
    expect(JSON.stringify(reopened.preview())).toBe(JSON.stringify(r.preview()));
  });

  it("leaves business data out unless asked, and says so either way", () => {
    // R27: data inclusion is an explicit choice, and a reader should not have
    // to notice a missing key to learn whether data travelled.
    const r = fresh();
    const without = r.export();
    expect(without.dataIncluded).toBe(false);
    expect(without.rows).toBeUndefined();

    const with_ = r.export({ includeData: true, rows: preparedView() });
    expect(with_.dataIncluded).toBe(true);
    expect(with_.rows).toHaveLength(4);
  });

  it("refuses to claim data is included when none was supplied", () => {
    expect(() => fresh().export({ includeData: true })).toThrow(/no rows were supplied/);
  });

  it("carries version metadata for the snapshot it was written against", () => {
    const pkg = fresh().export();
    expect(pkg.formatVersion).toBe(1);
    expect(pkg.snapshot).toMatchObject({ source: "synthetic://support-ops", version: "0.1" });
  });

  it("exports the last valid version, not a broken draft", () => {
    const r = fresh();
    r.revise({ ...source(), calculated: [{ rowKey: "total", expr: "measure(nope)" }] });
    expect(r.export().version).toBe(1);
  });

  it("refuses a package format it does not know", () => {
    const pkg = { ...fresh().export(), formatVersion: 99 as unknown as 1 };
    expect(() => Revisions.reopen(pkg, clock)).toThrow(/format 99 is not supported/);
  });

  it("survives the workbook going through base64", () => {
    const r = fresh();
    const reopened = Revisions.reopen(r.export(), clock);
    // The cell provenance is only right if the real bytes came back.
    expect(reopened.preview().provenance["queue_c"]!.skeleton.address).toBe("A7");
  });
});

describe("binding a second compatible view", () => {
  it("reconciles independently, with no bridge code changed", () => {
    // A02's second half: reuse through configuration, not a fork.
    const r = fresh();
    const second = source();
    const view = second.metadata.views[0]!;
    second.metadata = {
      ...second.metadata,
      views: [...second.metadata.views, { ...view, id: "vw_closed_cases_by_queue_v2" }],
    };
    second.bindings = { ...second.bindings, view: "vw_closed_cases_by_queue_v2" };

    const revision = r.revise(second);
    expect(revision.status).toBe("valid");
    expect(r.preview().execution.view).toBe("vw_closed_cases_by_queue_v2");

    // And it produces the same numbers from the same data, which is what
    // "reconcile independently" has to mean for two compatible views.
    const filled = fillReport(r.preview(), {
      rows: preparedView(),
      keyColumn: "queue_key",
      periodColumn: "period",
    });
    expect(filled.rows.find((x) => x.rowKey === "total")!.cells["actual"]!.value).toBe(120);
  });

  it("refuses a second view that is not actually compatible", () => {
    const r = fresh();
    const bad = source();
    const view = bad.metadata.views[0]!;
    bad.metadata = {
      ...bad.metadata,
      views: [
        ...bad.metadata.views,
        {
          ...view,
          id: "vw_other",
          columns: view.columns.filter((c) => c.role !== "measure"),
        },
      ],
    };
    bad.bindings = { ...bad.bindings, view: "vw_other" };
    expect(r.revise(bad).status).toBe("invalid");
    expect(r.current().problems!.map((p) => p.code)).toContain("view-missing-column");
  });
});
