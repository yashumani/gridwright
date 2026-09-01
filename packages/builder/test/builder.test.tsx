import { describe, expect, it, beforeEach } from "vitest";
import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseManifest, type Manifest, type PanelDef } from "@gridwright/schema";
import { sourceFromText } from "@gridwright/engine";
import { defaultRegistry } from "@gridwright/panels";
import {
  Builder, PropertyForm, blankFor, checkManifest, exportManifest, initialState,
  nextPanelId, placePanel, reduce, toYaml, type EditorState, type JsonSchema,
} from "@gridwright/builder";

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const refText = readFileSync(dir("../../../examples/sales-overview.gw.yaml"), "utf8");
const salesCsv = readFileSync(dir("../../../examples/sales.csv"), "utf8");

function manifest(): Manifest {
  const r = parseManifest(refText);
  if (!r.ok) throw new Error(JSON.stringify(r.issues, null, 2));
  return r.manifest;
}

const state = (): EditorState => initialState(manifest());

beforeEach(cleanup);

describe("round trip", () => {
  it("re-imports an untouched export unchanged", () => {
    const original = manifest();
    const { yaml, ok } = exportManifest(original);
    expect(ok).toBe(true);

    const back = parseManifest(yaml);
    expect(back.ok, back.ok ? "" : JSON.stringify(back.issues)).toBe(true);
    expect(back.ok && back.manifest).toEqual(original);
  });

  it("re-imports an edited export unchanged", () => {
    // The guarantee that matters: edit visually, export, re-open, and the
    // manifest you get back is the one the editor was holding.
    let s = state();
    s = reduce(s, { type: "select", id: "kpi_rev" });
    s = reduce(s, { type: "updatePanel", id: "kpi_rev", patch: { title: "Total revenue" } });
    s = reduce(s, { type: "resizePanel", id: "kpi_rev", w: 4, h: 3 });
    s = reduce(s, { type: "updateProps", id: "regions", props: { columns: [{ ref: "region" }] } });

    const { yaml, ok } = exportManifest(s.manifest);
    expect(ok, "edited manifest no longer validates").toBe(true);

    const back = parseManifest(yaml);
    expect(back.ok, back.ok ? "" : JSON.stringify(back.issues)).toBe(true);
    expect(back.ok && back.manifest).toEqual(s.manifest);
  });

  it("survives repeated export and import without drifting", () => {
    let current = manifest();
    for (let i = 0; i < 3; i++) {
      const r = parseManifest(toYaml(current));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      current = r.manifest;
    }
    expect(current).toEqual(manifest());
  });

  it("writes keys in the format's reading order", () => {
    const keys = [...toYaml(manifest()).matchAll(/^(\w+):/gm)].map((m) => m[1]);
    expect(keys).toEqual(["gridwright", "title", "source", "model", "datasets", "grid", "panels", "interactions"]);
  });

  it("reports issues rather than emitting an invalid manifest silently", () => {
    const broken = manifest();
    broken.panels[0]!.dataset = "ghost";
    const r = exportManifest(broken);
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/unknown dataset "ghost"/);
  });
});

describe("editing", () => {
  it("adds a panel and selects it", () => {
    const s = state();
    const panel: PanelDef = {
      id: "new_1", type: "kpi", dataset: "totals",
      layout: { x: 0, y: 20, w: 3, h: 2 }, props: { measure: "revenue" },
    };
    const next = reduce(s, { type: "addPanel", panel });
    expect(next.manifest.panels).toHaveLength(s.manifest.panels.length + 1);
    expect(next.selected).toBe("new_1");
  });

  it("refuses a duplicate panel id", () => {
    const s = state();
    const clone = { ...s.manifest.panels[0]! };
    expect(reduce(s, { type: "addPanel", panel: clone })).toBe(s);
  });

  it("removes interactions that pointed at a deleted panel", () => {
    // A dangling interaction would fail validation on the next export.
    const s = state();
    expect(s.manifest.interactions?.some((i) => i.on.startsWith("regions."))).toBe(true);
    const next = reduce(s, { type: "removePanel", id: "regions" });
    expect(next.manifest.interactions?.some((i) => i.on.startsWith("regions."))).toBe(false);
    expect(exportManifest(next.manifest).ok).toBe(true);
  });

  it("clears the selection when the selected panel is deleted", () => {
    let s = reduce(state(), { type: "select", id: "regions" });
    s = reduce(s, { type: "removePanel", id: "regions" });
    expect(s.selected).toBeNull();
  });

  it("moves and resizes without disturbing the other layout fields", () => {
    let s = reduce(state(), { type: "movePanel", id: "trend", x: 2, y: 9 });
    s = reduce(s, { type: "resizePanel", id: "trend", w: 6, h: 5 });
    const p = s.manifest.panels.find((x) => x.id === "trend")!;
    expect(p.layout).toEqual({ x: 2, y: 9, w: 6, h: 5 });
  });

  it("ignores edits to a panel that does not exist", () => {
    const s = state();
    expect(reduce(s, { type: "movePanel", id: "ghost", x: 1, y: 1 })).toBe(s);
  });

  it("never mutates the manifest it was given", () => {
    const original = manifest();
    const snapshot = structuredClone(original);
    reduce(initialState(original), { type: "movePanel", id: "trend", x: 5, y: 5 });
    expect(original).toEqual(snapshot);
  });
});

describe("undo and redo", () => {
  it("restores the previous manifest", () => {
    const s = state();
    const moved = reduce(s, { type: "movePanel", id: "trend", x: 4, y: 4 });
    const undone = reduce(moved, { type: "undo" });
    expect(undone.manifest).toEqual(s.manifest);
  });

  it("replays an undone edit", () => {
    const moved = reduce(state(), { type: "movePanel", id: "trend", x: 4, y: 4 });
    const again = reduce(reduce(moved, { type: "undo" }), { type: "redo" });
    expect(again.manifest).toEqual(moved.manifest);
  });

  it("drops the redo stack once a new edit lands", () => {
    let s = reduce(state(), { type: "movePanel", id: "trend", x: 4, y: 4 });
    s = reduce(s, { type: "undo" });
    expect(s.future).toHaveLength(1);
    s = reduce(s, { type: "movePanel", id: "trend", x: 1, y: 1 });
    expect(s.future).toHaveLength(0);
  });

  it("is a no-op at either end of the history", () => {
    const s = state();
    expect(reduce(s, { type: "undo" })).toBe(s);
    expect(reduce(s, { type: "redo" })).toBe(s);
  });

  it("does not record selection changes as undoable edits", () => {
    const s = reduce(state(), { type: "select", id: "trend" });
    expect(s.past).toHaveLength(0);
  });
});

describe("placement helpers", () => {
  it("places a new panel below everything already there", () => {
    const m = manifest();
    const bottom = Math.max(...m.panels.map((p) => p.layout.y + p.layout.h));
    expect(placePanel(m, 4, 3)).toEqual({ x: 0, y: bottom, w: 4, h: 3 });
  });

  it("clamps a new panel to the grid width", () => {
    expect(placePanel(manifest(), 40, 3).w).toBe(12);
  });

  it("picks an id that does not collide", () => {
    const m = manifest();
    expect(nextPanelId(m, "kpi")).toBe("kpi_1");
    m.panels.push({ id: "kpi_1", type: "kpi", dataset: "totals", layout: { x: 0, y: 0, w: 2, h: 2 } });
    expect(nextPanelId(m, "kpi")).toBe("kpi_2");
  });
});

describe("schema-driven property form", () => {
  const render1 = (schema: JsonSchema, value: unknown, onChange = () => {}) =>
    render(<PropertyForm schema={schema} value={value} onChange={onChange} />);

  it("renders a text input for a string", () => {
    render1({ type: "object", properties: { measure: { type: "string" } } }, {});
    expect(screen.getByLabelText("Measure")).toHaveAttribute("type", "text");
  });

  it("renders a select for an enum", () => {
    render1(
      { type: "object", properties: { align: { type: "string", enum: ["left", "right"] } } },
      {},
    );
    const select = screen.getByLabelText("Align");
    expect(select.tagName).toBe("SELECT");
    expect([...select.querySelectorAll("option")].map((o) => o.value)).toEqual(["", "left", "right"]);
  });

  it("renders a checkbox for a boolean and a number input for a number", () => {
    render1(
      { type: "object", properties: { area: { type: "boolean" }, maxBars: { type: "integer", minimum: 1 } } },
      {},
    );
    expect(screen.getByLabelText("Area")).toHaveAttribute("type", "checkbox");
    expect(screen.getByLabelText("Max Bars")).toHaveAttribute("type", "number");
  });

  it("edits a value through onChange rather than mutating", () => {
    const seen: unknown[] = [];
    render1({ type: "object", properties: { measure: { type: "string" } } }, {}, (v) => seen.push(v));
    fireEvent.change(screen.getByLabelText("Measure"), { target: { value: "revenue" } });
    expect(seen).toEqual([{ measure: "revenue" }]);
  });

  it("drops a key when its input is cleared", () => {
    const seen: unknown[] = [];
    render(
      <PropertyForm
        schema={{ type: "object", properties: { caption: { type: "string" } } }}
        value={{ caption: "hi" }}
        onChange={(v) => seen.push(v)}
      />,
    );
    fireEvent.change(screen.getByLabelText("Caption"), { target: { value: "" } });
    expect(seen).toEqual([{}]);
  });

  it("adds and removes array items", () => {
    const seen: unknown[] = [];
    render(
      <PropertyForm
        schema={{ type: "array", items: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] } }}
        value={[{ ref: "a" }]}
        label="Columns"
        onChange={(v) => seen.push(v)}
      />,
    );
    fireEvent.click(screen.getByText("Add"));
    expect(seen.at(-1)).toEqual([{ ref: "a" }, { ref: "" }]);
    fireEvent.click(screen.getByLabelText("Remove item 1"));
    expect(seen.at(-1)).toEqual([]);
  });

  it("offers dataset columns wherever a field names a reference", () => {
    render(
      <PropertyForm
        schema={{ type: "object", properties: { measure: { type: "string" } } }}
        value={{}}
        suggestions={{ refs: ["revenue", "orders"] }}
        onChange={() => {}}
      />,
    );
    const input = screen.getByLabelText("Measure");
    const list = document.getElementById(input.getAttribute("list")!)!;
    expect([...list.querySelectorAll("option")].map((o) => o.getAttribute("value")))
      .toEqual(["revenue", "orders"]);
  });

  it("builds a blank value that satisfies the schema's required keys", () => {
    expect(blankFor({ type: "object", properties: { ref: { type: "string" } }, required: ["ref"] }))
      .toEqual({ ref: "" });
    expect(blankFor({ type: "array" })).toEqual([]);
    expect(blankFor({ type: "string", enum: ["a", "b"] })).toBe("a");
  });

  it("generates a form for every built-in panel without special-casing", () => {
    // The point of the mechanism: no panel needs bespoke editing UI.
    for (const spec of defaultRegistry().all()) {
      cleanup();
      const { container } = render(
        <PropertyForm schema={spec.schema.jsonSchema() as JsonSchema} value={{}} onChange={() => {}} />,
      );
      expect(container.querySelectorAll("input, select").length, spec.type).toBeGreaterThan(0);
    }
  });
});

describe("the builder shell", () => {
  const source = () => sourceFromText(manifest(), { sales: salesCsv });

  async function mountBuilder() {
    const view = render(<Builder manifest={manifest()} source={source()} />);
    await waitFor(() => expect(screen.queryByText("Updating…")).not.toBeInTheDocument());
    return view;
  }

  it("previews the dashboard it is editing", async () => {
    await mountBuilder();
    expect(document.querySelectorAll(".gw-panel")).toHaveLength(7);
  });

  it("lists every panel and selects one on click", async () => {
    await mountBuilder();
    const items = document.querySelectorAll(".gwb-listitem");
    expect(items).toHaveLength(7);
    await act(async () => { fireEvent.click(items[0]!); });
    expect(document.querySelector(".gwb-listitem.gwb-on")).toBeTruthy();
  });

  it("names an untitled panel by what it draws, not by its id", async () => {
    // Four of the reference panels carry no title, so the list falls back.
    // Falling back to `kpi_rtn` tells a newcomer nothing; the measure it shows
    // has a label already, and that is the thing they recognise.
    await mountBuilder();
    const names = [...document.querySelectorAll(".gwb-listitem")].map(
      (el) => el.lastElementChild!.textContent,
    );
    expect(names.slice(0, 4)).toEqual(["Revenue", "Orders", "Avg order", "Return rate"]);
    expect(names.join()).not.toMatch(/kpi_/);
    // A titled panel still wins.
    expect(names).toContain("Revenue by month");
  });

  it("falls back to the panel type when nothing it draws is recognisable", async () => {
    const m = manifest();
    m.panels = [{ id: "p1", type: "kpi", dataset: "totals", layout: { x: 0, y: 0, w: 3, h: 2 }, props: {} }];
    render(<Builder manifest={m} source={source()} />);
    await waitFor(() => expect(screen.queryByText("Updating…")).not.toBeInTheDocument());
    expect(document.querySelector(".gwb-listitem")!.lastElementChild!.textContent).toBe("KPI");
  });

  it("shows the selected panel's own settings form", async () => {
    await mountBuilder();
    await act(async () => { fireEvent.click(document.querySelectorAll(".gwb-listitem")[0]!); });
    expect(screen.getByText("KPI settings")).toBeTruthy();
    expect(screen.getByLabelText("Measure")).toBeTruthy();
  });

  it("edits a title and reports the new manifest", async () => {
    const seen: Manifest[] = [];
    render(<Builder manifest={manifest()} source={source()} onChange={(m) => seen.push(m)} />);
    await waitFor(() => expect(screen.queryByText("Updating…")).not.toBeInTheDocument());
    await act(async () => { fireEvent.click(document.querySelectorAll(".gwb-listitem")[0]!); });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Revenue" } });
    });
    expect(seen.at(-1)!.panels[0]!.title).toBe("Revenue");
  });

  it("closes the export dialog on Escape", async () => {
    await mountBuilder();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Export" })); });
    expect(screen.getByRole("dialog", { name: /exported manifest/i })).toBeTruthy();
    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(screen.queryByRole("dialog", { name: /exported manifest/i })).toBeNull();
  });

  it("adds a panel from the toolbar", async () => {
    await mountBuilder();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Add a panel"), { target: { value: "bar" } });
    });
    await waitFor(() => expect(document.querySelectorAll(".gwb-listitem")).toHaveLength(8));
  });

  it("exports a manifest the parser accepts", async () => {
    await mountBuilder();
    await act(async () => { fireEvent.click(screen.getByText("Export")); });
    const text = (screen.getByRole("dialog").querySelector("textarea") as HTMLTextAreaElement).value;
    expect(parseManifest(text).ok).toBe(true);
  });
});

describe("model editing", () => {
  // The manifest's own shape, for reference while reading the expectations:
  //   dimensions region, channel, month(order_date, grain month)
  //   measures   revenue, orders, aov, returns, rtn_rate, rev_share, rev_run, rev_mom
  //   datasets   totals, by_region, by_month, by_channel

  it("adds a measure through the model slice", () => {
    let s = state();
    const model = s.manifest.model;
    s = reduce(s, {
      type: "setModel",
      model: { ...model, measures: [...model.measures, { id: "gross", expr: "sum(amount)" }] },
    });
    expect(s.manifest.model.measures.map((m) => m.id)).toContain("gross");
    expect(checkManifest(s.manifest).ok).toBe(true);
  });

  it("renames a measure through every structural reference", () => {
    let s = state();
    s = reduce(s, { type: "renameMeasure", from: "revenue", to: "net_revenue" });

    expect(s.manifest.model.measures.some((m) => m.id === "net_revenue")).toBe(true);
    expect(s.manifest.datasets["by_region"]!.measures).toContain("net_revenue");
    expect(s.manifest.datasets["by_region"]!.measures).not.toContain("revenue");
    // by_region sorts on revenue desc; the sort has to follow the rename.
    expect(s.manifest.datasets["by_region"]!.sort).toEqual([{ measure: "net_revenue", dir: "desc" }]);
  });

  it("leaves expressions alone on a rename, and says what broke", () => {
    // aov is "measure(revenue) / measure(orders)". Rewriting somebody's formula
    // is a guess, not a cascade — so the reference is reported, not rewritten.
    let s = state();
    s = reduce(s, { type: "renameMeasure", from: "revenue", to: "net_revenue" });

    const aov = s.manifest.model.measures.find((m) => m.id === "aov")!;
    expect(aov.expr).toBe("measure(revenue) / measure(orders)");

    const health = checkManifest(s.manifest);
    expect(health.ok).toBe(false);
    expect(health.issues.some((i) => i.message.includes("revenue"))).toBe(true);
  });

  it("removes a dimension from the datasets and interactions that name it", () => {
    let s = state();
    expect(s.manifest.datasets["by_region"]!.dimensions).toEqual(["region"]);
    expect(s.manifest.interactions!.some((i) => i.do.some((a) => a.dimension === "region"))).toBe(true);

    s = reduce(s, { type: "removeDimension", id: "region" });

    expect(s.manifest.model.dimensions.some((d) => d.id === "region")).toBe(false);
    expect(s.manifest.datasets["by_region"]!.dimensions).toEqual([]);
    // regions.rowClick did nothing but filter region, so it goes rather than
    // being left with an empty action list the schema would reject.
    expect(s.manifest.interactions!.some((i) => i.on === "regions.rowClick")).toBe(false);
    expect(s.manifest.interactions!.some((i) => i.on === "channels.click")).toBe(true);
  });

  it("takes a dimension's dimensions with the field they read", () => {
    let s = state();
    s = reduce(s, { type: "removeField", name: "order_date" });
    expect(s.manifest.model.fields.some((f) => f.name === "order_date")).toBe(false);
    // `month` was a named view of order_date and has no meaning without it.
    expect(s.manifest.model.dimensions.some((d) => d.id === "month")).toBe(false);
    expect(s.manifest.datasets["by_month"]!.dimensions).toEqual([]);
  });

  it("takes the panels bound to a dataset when it goes", () => {
    let s = state();
    const onTotals = s.manifest.panels.filter((p) => p.dataset === "totals").map((p) => p.id);
    expect(onTotals.length).toBeGreaterThan(0);

    s = reduce(s, { type: "removeDataset", name: "totals" });
    expect(s.manifest.datasets["totals"]).toBeUndefined();
    expect(s.manifest.panels.some((p) => onTotals.includes(p.id))).toBe(false);
  });

  it("keeps dataset order across a rename", () => {
    let s = state();
    const before = Object.keys(s.manifest.datasets);
    s = reduce(s, { type: "renameDataset", from: "by_region", to: "regions_ds" });
    const after = Object.keys(s.manifest.datasets);
    expect(after).toEqual(before.map((k) => (k === "by_region" ? "regions_ds" : k)));
    expect(s.manifest.panels.find((p) => p.id === "regions")!.dataset).toBe("regions_ds");
  });

  it("drops the relations key rather than exporting an empty list", () => {
    let s = state();
    s = reduce(s, { type: "setRelations", relations: [{ left: "a.b", right: "c.d" }] });
    expect(s.manifest.source.relations).toHaveLength(1);
    s = reduce(s, { type: "setRelations", relations: [] });
    expect("relations" in s.manifest.source).toBe(false);
  });

  it("keeps a no-op off the undo stack", () => {
    const s = state();
    expect(reduce(s, { type: "removeDimension", id: "nope" })).toBe(s);
    expect(reduce(s, { type: "renameMeasure", from: "revenue", to: "revenue" })).toBe(s);
    // A rename onto a name already taken would silently merge two measures.
    expect(reduce(s, { type: "renameMeasure", from: "revenue", to: "orders" })).toBe(s);
  });

  it("undoes a model edit like any other", () => {
    let s = state();
    s = reduce(s, { type: "removeMeasure", id: "rev_share" });
    expect(s.manifest.model.measures.some((m) => m.id === "rev_share")).toBe(false);
    s = reduce(s, { type: "undo" });
    expect(s.manifest.model.measures.some((m) => m.id === "rev_share")).toBe(true);
  });

  it("re-imports a model edit unchanged", () => {
    // The round-trip guarantee has to hold for the model half too.
    let s = state();
    s = reduce(s, { type: "renameDimension", from: "channel", to: "sales_channel" });
    s = reduce(s, {
      type: "setModel",
      model: {
        ...s.manifest.model,
        measures: [...s.manifest.model.measures, { id: "gross", expr: "sum(amount)", format: "$#,##0" }],
      },
    });
    s = reduce(s, {
      type: "setDatasets",
      datasets: {
        ...s.manifest.datasets,
        by_channel: { ...s.manifest.datasets["by_channel"]!, measures: ["revenue", "orders", "gross"] },
      },
    });

    const { yaml, ok, issues } = exportManifest(s.manifest, s.source);
    expect(ok, issues.join("\n")).toBe(true);
    const back = parseManifest(yaml);
    expect(back.ok, back.ok ? "" : JSON.stringify(back.issues)).toBe(true);
    expect(back.ok && back.manifest).toEqual(s.manifest);
  });
});

describe("checkManifest", () => {
  it("passes the reference manifest", () => {
    expect(checkManifest(manifest()).ok).toBe(true);
  });

  it("catches a half-typed expression", () => {
    const m = manifest();
    m.model.measures[0]!.expr = "sum(amount";
    const health = checkManifest(m);
    expect(health.ok).toBe(false);
    expect(health.issues[0]!.message).toMatch(/expected|character/i);
  });

  it("catches a cycle no single expression reveals", () => {
    // Each of these parses and analyses cleanly on its own; only compiling the
    // model together shows they refer to each other.
    const m = manifest();
    m.model.measures.push({ id: "ping", expr: "measure(pong) + 1" });
    m.model.measures.push({ id: "pong", expr: "measure(ping) + 1" });
    const health = checkManifest(m);
    expect(health.ok).toBe(false);
    expect(health.issues.map((i) => i.message).join(" ")).toMatch(/circular|cycle/i);
  });
});

describe("the model tab", () => {
  const source = () => sourceFromText(manifest(), { sales: salesCsv });

  /** A section's own disclosure header — "Measures" also names a dataset fieldset. */
  const section = (name: string): HTMLElement => {
    const hit = [...document.querySelectorAll<HTMLElement>(".gwb-section > summary")]
      .find((el) => el.textContent?.startsWith(name));
    if (!hit) throw new Error(`no model section named ${name}`);
    return hit;
  };

  async function mountModel() {
    const seen: Manifest[] = [];
    const view = render(
      <Builder manifest={manifest()} source={source()} onChange={(m) => seen.push(m)} />,
    );
    await waitFor(() => expect(screen.queryByText("Updating…")).not.toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Model" })); });
    return { ...view, seen };
  }

  it("offers the model beside the panels", async () => {
    await mountModel();
    for (const name of ["Fields", "Dimensions", "Measures", "Datasets", "Relations"]) {
      expect(section(name)).toBeTruthy();
    }
  });

  it("edits a measure expression and re-queries the preview", async () => {
    const { seen } = await mountModel();
    await act(async () => { fireEvent.click(section("Measures")); });

    const expr = screen.getByLabelText("Measure 1 expression");
    expect((expr as HTMLTextAreaElement).value).toBe("sum(amount)");
    await act(async () => { fireEvent.change(expr, { target: { value: "sum(amount) * 2" } }); });

    expect(seen.at(-1)!.model.measures[0]!.expr).toBe("sum(amount) * 2");
    // The preview is live, so the doubled revenue reaches the KPI. Not twice
    // the displayed $4,282,970: that figure is itself rounded for display.
    await waitFor(() => {
      expect(document.querySelector(".gw-kpi-value")!.textContent).toBe("$8,565,941");
    });
  });

  it("says what an expression resolved to while it is being typed", async () => {
    await mountModel();
    await act(async () => { fireEvent.click(section("Measures")); });
    expect(screen.getAllByText("Folds raw rows").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Runs after grouping").length).toBeGreaterThan(0);
  });

  it("keeps the preview alive through a half-typed expression", async () => {
    // The reason the preview is gated at all: `new Engine()` compiles the
    // measure model synchronously during render, and every expression is
    // briefly invalid while somebody types it.
    await mountModel();
    await act(async () => { fireEvent.click(section("Measures")); });

    const before = document.querySelector(".gw-kpi-value")!.textContent;
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Measure 1 expression"), { target: { value: "sum(amoun" } });
    });

    // Still standing, still showing the last version that ran, and saying so.
    expect(document.querySelectorAll(".gw-panel")).toHaveLength(7);
    expect(document.querySelector(".gw-kpi-value")!.textContent).toBe(before);
    expect(screen.getByRole("alert").textContent).toContain("last version that ran");

    // And it catches up as soon as the expression makes sense again.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Measure 1 expression"), { target: { value: "sum(amount)" } });
    });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("commits an id on blur, not on every keystroke", async () => {
    const { seen } = await mountModel();
    await act(async () => { fireEvent.click(section("Dimensions")); });

    const id = screen.getByLabelText("Dimension 1 id");
    const count = seen.length;
    await act(async () => { fireEvent.change(id, { target: { value: "sales_region" } }); });
    // Typing alone must not rename: a cascade per keystroke would rewrite the
    // manifest once for every letter.
    expect(seen.length).toBe(count);

    await act(async () => { fireEvent.blur(id); });
    expect(seen.at(-1)!.model.dimensions[0]!.id).toBe("sales_region");
    expect(seen.at(-1)!.datasets["by_region"]!.dimensions).toEqual(["sales_region"]);
  });

  it("offers grain only on a date field", async () => {
    await mountModel();
    await act(async () => { fireEvent.click(section("Dimensions")); });
    // region and channel are strings; month reads order_date.
    expect(screen.queryByLabelText("Dimension 1 grain")).toBeNull();
    expect(screen.getByLabelText("Dimension 3 grain")).toBeTruthy();
  });

  it("picks a real column from the loaded file", async () => {
    await mountModel();
    await act(async () => { fireEvent.click(section("Fields")); });
    const column = screen.getByLabelText("Field 1 column") as HTMLSelectElement;
    // Introspection is async, so this also proves it landed.
    await waitFor(() => expect(column.tagName).toBe("SELECT"));
    expect([...column.options].map((o) => o.value)).toContain("amount");
  });

  it("removes a dataset and the panels that drew it", async () => {
    const { seen } = await mountModel();
    await act(async () => { fireEvent.click(section("Datasets")); });
    await act(async () => { fireEvent.click(screen.getAllByText("Remove dataset")[0]!); });

    const next = seen.at(-1)!;
    expect(next.datasets["totals"]).toBeUndefined();
    expect(next.panels.some((p) => p.dataset === "totals")).toBe(false);
    await waitFor(() => expect(document.querySelectorAll(".gw-panel")).toHaveLength(3));
  });

  it("exports a model edit as YAML that re-imports", async () => {
    await mountModel();
    await act(async () => { fireEvent.click(section("Measures")); });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Measure 1 label"), { target: { value: "Net revenue" } });
    });
    await act(async () => { fireEvent.click(screen.getByText("Export")); });

    const yaml = (screen.getByRole("dialog").querySelector("textarea") as HTMLTextAreaElement).value;
    expect(yaml).toContain("Net revenue");
    const back = parseManifest(yaml);
    expect(back.ok, back.ok ? "" : JSON.stringify(back.issues)).toBe(true);
  });
});
