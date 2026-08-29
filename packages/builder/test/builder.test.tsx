import { describe, expect, it, beforeEach } from "vitest";
import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseManifest, type Manifest, type PanelDef } from "@gridwright/schema";
import { sourceFromText } from "@gridwright/engine";
import { defaultRegistry } from "@gridwright/panels";
import {
  Builder, PropertyForm, blankFor, exportManifest, initialState,
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
