import { describe, expect, it, beforeEach } from "vitest";
import { act, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseManifest, type Manifest } from "@gridwright/schema";
import { sourceFromText, type DataSource } from "@gridwright/engine";
import { PanelRegistry, defaultRegistry, formatValue, obj, str } from "./helpers.js";
import { Dashboard, FilterStore, styles } from "@gridwright/react";

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const refText = readFileSync(dir("../../../examples/sales-overview.gw.yaml"), "utf8");
const salesCsv = readFileSync(dir("../../../examples/sales.csv"), "utf8");

function fixture(): { manifest: Manifest; source: DataSource } {
  const r = parseManifest(refText);
  if (!r.ok) throw new Error(JSON.stringify(r.issues, null, 2));
  return { manifest: r.manifest, source: sourceFromText(r.manifest, { sales: salesCsv }) };
}

/** Renders and waits for the first query pass to settle. */
async function mount(over: Partial<React.ComponentProps<typeof Dashboard>> = {}) {
  const { manifest, source } = fixture();
  const store = over.store ?? new FilterStore();
  const view = render(<Dashboard manifest={manifest} source={source} store={store} {...over} />);
  await waitFor(() => expect(screen.queryByText("Updating…")).not.toBeInTheDocument());
  return { ...view, store, manifest };
}

beforeEach(cleanup);

describe("rendering the reference manifest", () => {
  it("renders every panel the manifest declares", async () => {
    await mount();
    expect(document.querySelectorAll(".gw-panel")).toHaveLength(7);
  });

  it("shows the dashboard title", async () => {
    await mount();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sales overview");
  });

  it("fills the KPI tiles with formatted values", async () => {
    await mount();
    const value = document.querySelector(".gw-kpi-value")!;
    // The revenue KPI carries a currency pattern, so it must not read as raw digits.
    expect(value.textContent).toMatch(/^\$[\d,]+$/);
  });

  it("places panels on the declared grid tracks", async () => {
    const { manifest } = await mount();
    const panels = [...document.querySelectorAll<HTMLElement>(".gw-panel")];
    manifest.panels.forEach((p, i) => {
      expect(panels[i]!.style.gridColumn).toBe(`${p.layout.x + 1} / span ${p.layout.w}`);
      expect(panels[i]!.style.gridRow).toBe(`${p.layout.y + 1} / span ${p.layout.h}`);
    });
  });

  it("renders the table with one row per group", async () => {
    await mount();
    const table = document.querySelector(".gw-table")!;
    // Five regions in the fixture data.
    expect(within(table as HTMLElement).getAllByRole("button")).toHaveLength(5);
  });

  it("draws bars for every channel", async () => {
    await mount();
    const bars = document.querySelectorAll(".gw-bar .gw-bar-fill");
    expect(bars.length).toBe(4);
  });
});

describe("cross-filtering", () => {
  it("moves every panel when a table row is clicked", async () => {
    await mount();
    const before = document.querySelector(".gw-kpi-value")!.textContent;

    const row = within(document.querySelector(".gw-table") as HTMLElement).getAllByRole("button")[0]!;
    await act(async () => { fireEvent.click(row); });
    await waitFor(() => {
      expect(document.querySelector(".gw-kpi-value")!.textContent).not.toBe(before);
    });

    // The bar chart shares no dataset with the table, so this is the real
    // cross-filter path: a selection on one panel re-queried another.
    const barValues = [...document.querySelectorAll(".gw-bar-value")].map((n) => n.textContent);
    expect(barValues.every((v) => v && v !== "—")).toBe(true);
  });

  it("marks the clicked row as selected", async () => {
    await mount();
    const row = within(document.querySelector(".gw-table") as HTMLElement).getAllByRole("button")[0]!;
    await act(async () => { fireEvent.click(row); });
    await waitFor(() => expect(document.querySelector(".gw-row-on")).toBeTruthy());
    expect(row.getAttribute("aria-pressed")).toBe("true");
  });

  it("clears the selection when the same row is clicked again", async () => {
    const { store } = await mount();
    const table = () => document.querySelector(".gw-table") as HTMLElement;
    const row = () => within(table()).getAllByRole("button")[0]!;

    await act(async () => { fireEvent.click(row()); });
    await waitFor(() => expect(store.isEmpty()).toBe(false));
    await act(async () => { fireEvent.click(row()); });
    await waitFor(() => expect(store.isEmpty()).toBe(true));
  });

  it("filters on the dimension the interaction names", async () => {
    const { store } = await mount();
    const bar = document.querySelectorAll(".gw-bar")[0]!;
    await act(async () => { fireEvent.click(bar); });
    // channels.click declares a filter on `channel`, not on whatever was emitted.
    await waitFor(() => expect(Object.keys(store.getSnapshot())).toEqual(["channel"]));
  });

  it("ANDs selections across dimensions", async () => {
    const { store } = await mount();
    await act(async () => {
      fireEvent.click(within(document.querySelector(".gw-table") as HTMLElement).getAllByRole("button")[0]!);
    });
    await act(async () => { fireEvent.click(document.querySelectorAll(".gw-bar")[0]!); });
    await waitFor(() => {
      expect(Object.keys(store.getSnapshot()).sort()).toEqual(["channel", "region"]);
    });
    expect(store.toFilters()).toHaveLength(2);
  });

  it("reads the target dimension's own value from the clicked row", async () => {
    // The panel emits its first dimension, but the interaction names a
    // different one. Filtering `channel` by a region name is not a narrower
    // dashboard, it is an empty one.
    const { manifest, source } = fixture();
    manifest.datasets["by_region"]!.dimensions = ["region", "channel"];
    manifest.interactions = [
      { on: "regions.rowClick", do: [{ action: "filter", dimension: "channel", from: "row" }] },
    ];
    manifest.panels = manifest.panels.filter((p) => p.id === "regions");
    manifest.panels[0]!.props = {
      columns: [{ ref: "region" }, { ref: "channel" }, { ref: "revenue" }],
    };

    const store = new FilterStore();
    render(<Dashboard manifest={manifest} source={source} store={store} />);
    await waitFor(() => expect(screen.queryByText("Updating…")).not.toBeInTheDocument());

    const table = document.querySelector(".gw-table") as HTMLElement;
    const row = within(table).getAllByRole("button")[0]!;
    const cells = row.querySelectorAll("td");
    const region = cells[0]!.textContent;
    const channel = cells[1]!.textContent;
    expect(region).not.toBe(channel);

    await act(async () => { fireEvent.click(row); });
    await waitFor(() => expect(store.getSnapshot()["channel"]).toBeTruthy());
    expect(store.getSnapshot()["channel"]).toEqual([channel]);
  });

  it("drops an action for a dimension the clicked row cannot supply", async () => {
    // No value the panel emitted belongs to `month`, so no filter is better
    // than one built from a channel name.
    const { manifest, source } = fixture();
    manifest.interactions = [
      { on: "channels.click", do: [{ action: "filter", dimension: "month", from: "row" }] },
    ];
    const store = new FilterStore();
    render(<Dashboard manifest={manifest} source={source} store={store} />);
    await waitFor(() => expect(screen.queryByText("Updating…")).not.toBeInTheDocument());

    await act(async () => { fireEvent.click(document.querySelectorAll(".gw-bar")[0]!); });
    expect(store.isEmpty()).toBe(true);
  });

  it("shows a chip per active selection and clears it on click", async () => {
    const { store } = await mount();
    await act(async () => {
      fireEvent.click(within(document.querySelector(".gw-table") as HTMLElement).getAllByRole("button")[0]!);
    });
    await waitFor(() => expect(document.querySelector(".gw-chip")).toBeTruthy());

    const chip = document.querySelector(".gw-chip") as HTMLElement;
    expect(chip.textContent).toContain("Region");
    await act(async () => { fireEvent.click(chip); });
    await waitFor(() => expect(store.isEmpty()).toBe(true));
  });

  it("clears everything from the clear-all control", async () => {
    const { store } = await mount();
    await act(async () => {
      fireEvent.click(within(document.querySelector(".gw-table") as HTMLElement).getAllByRole("button")[0]!);
    });
    await act(async () => { fireEvent.click(document.querySelectorAll(".gw-bar")[0]!); });
    await waitFor(() => expect(store.toFilters()).toHaveLength(2));

    await act(async () => { fireEvent.click(screen.getByText("Clear all")); });
    await waitFor(() => expect(store.isEmpty()).toBe(true));
  });

  it("does not filter a panel by its own selection", async () => {
    await mount();
    const barsBefore = document.querySelectorAll(".gw-bar .gw-bar-fill").length;
    await act(async () => { fireEvent.click(document.querySelectorAll(".gw-bar")[0]!); });
    await waitFor(() => expect(document.querySelector(".gw-chip")).toBeTruthy());
    // Every channel stays on screen, so a second value is still selectable.
    expect(document.querySelectorAll(".gw-bar .gw-bar-fill")).toHaveLength(barsBefore);
  });

  it("marks the selected mark and dims the rest", async () => {
    await mount();
    await act(async () => { fireEvent.click(document.querySelectorAll(".gw-bar")[0]!); });
    await waitFor(() => expect(document.querySelector(".gw-bar.gw-on")).toBeTruthy());
    expect(document.querySelectorAll(".gw-bar.gw-dim").length).toBeGreaterThan(0);
  });

  it("supports selecting a second value from the same chart", async () => {
    const { store } = await mount();
    const bars = () => document.querySelectorAll(".gw-bar");
    await act(async () => { fireEvent.click(bars()[0]!); });
    await waitFor(() => expect(store.getSnapshot()["channel"]).toHaveLength(1));
    await act(async () => { fireEvent.click(bars()[1]!); });
    await waitFor(() => expect(store.getSnapshot()["channel"]).toHaveLength(2));
  });

  it("still narrows a panel by a selection made elsewhere", async () => {
    await mount();
    const before = document.querySelector(".gw-kpi-value")!.textContent;
    await act(async () => { fireEvent.click(document.querySelectorAll(".gw-bar")[0]!); });
    await waitFor(() => {
      expect(document.querySelector(".gw-kpi-value")!.textContent).not.toBe(before);
    });
  });

  it("keeps the previous data visible while the next query runs", async () => {
    await mount();
    const before = document.querySelectorAll(".gw-panel").length;
    await act(async () => {
      fireEvent.click(within(document.querySelector(".gw-table") as HTMLElement).getAllByRole("button")[0]!);
    });
    // No panel is replaced by a skeleton mid-update.
    expect(document.querySelectorAll(".gw-panel")).toHaveLength(before);
    expect(document.querySelectorAll(".gw-skeleton")).toHaveLength(0);
  });
});

describe("the newer chart forms", () => {
  /** Swaps one panel for another type, keeping everything else the same. */
  async function withPanel(type: string, props: Record<string, unknown>, dataset = "by_channel") {
    const { manifest, source } = fixture();
    manifest.panels = [{
      id: "p", type, dataset, layout: { x: 0, y: 0, w: 12, h: 6 }, props,
    }];
    manifest.interactions = [];
    render(<Dashboard manifest={manifest} source={source} store={new FilterStore()} />);
    await waitFor(() => expect(screen.queryByText("Updating…")).not.toBeInTheDocument());
  }

  it("stacks segments to the full width of the bar in share mode", async () => {
    await withPanel("stack", { category: "channel", values: ["revenue", "orders"], mode: "share" });
    const bars = document.querySelectorAll(".gw-stack");
    expect(bars.length).toBeGreaterThan(1);
    for (const bar of bars) {
      const widths = [...bar.querySelectorAll("rect")].map((r) => Number(r.getAttribute("width")));
      const total = widths.reduce((a, b) => a + b, 0);
      // Every bar normalises to the same length; only the split differs.
      expect(total).toBeGreaterThan(0);
    }
    const totals = [...bars].map((b) =>
      [...b.querySelectorAll("rect")].reduce((a, r) => a + Number(r.getAttribute("width")), 0));
    // Within the 2px gap per segment.
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThan(3);
  });

  it("keeps the totals comparable when it is not normalising", async () => {
    await withPanel("stack", { category: "channel", values: ["revenue", "orders"] });
    const totals = [...document.querySelectorAll(".gw-stack")].map((b) =>
      [...b.querySelectorAll("rect")].reduce((a, r) => a + Number(r.getAttribute("width")), 0));
    // Channels differ in revenue, so the bars must differ in length.
    expect(Math.max(...totals) - Math.min(...totals)).toBeGreaterThan(3);
  });

  it("names every segment, so identity is never colour alone", async () => {
    await withPanel("stack", { category: "channel", values: ["revenue", "orders"] });
    const legend = [...document.querySelectorAll(".gw-legend li")].map((l) => l.textContent);
    expect(legend).toEqual(["Revenue", "Orders"]);
  });

  it("draws a heatmap cell per combination the query returned", async () => {
    const { manifest, source } = fixture();
    manifest.datasets["grid"] = {
      dimensions: ["region", "channel"],
      measures: ["revenue"],
      sort: [{ dimension: "region", dir: "asc" }],
    };
    manifest.panels = [{
      id: "h", type: "heatmap", dataset: "grid",
      layout: { x: 0, y: 0, w: 12, h: 6 },
      props: { x: "channel", y: "region", value: "revenue" },
    }];
    manifest.interactions = [];
    render(<Dashboard manifest={manifest} source={source} store={new FilterStore()} />);
    await waitFor(() => expect(screen.queryByText("Updating…")).not.toBeInTheDocument());

    // 5 regions × 4 channels in the reference data.
    expect(document.querySelectorAll(".gw-cell").length).toBe(20);
    // Shade comes from the ramp, never from a categorical hue: magnitude is not
    // identity, and a rainbow invents an order the eye does not agree on.
    const fills = [...document.querySelectorAll(".gw-cell-fill")]
      .map((c) => c.getAttribute("fill"));
    expect(fills.every((f) => f?.startsWith("var(--gw-ramp-"))).toBe(true);
    // And every cell says its number as well as its shade.
    expect(document.querySelectorAll(".gw-cell-value").length).toBe(20);
  });

  it("recesses everything but the highlighted bar", async () => {
    await withPanel("bar", { category: "channel", value: "revenue", emphasise: "Direct" });
    const lead = document.querySelectorAll(".gw-bar.gw-on");
    const rest = document.querySelectorAll(".gw-bar.gw-dim");
    expect(lead).toHaveLength(1);
    expect(rest.length).toBeGreaterThan(0);
    expect(lead[0]!.querySelector(".gw-bar-label")?.textContent).toBe("Direct");
  });

  it("leaves every bar equal when nothing is highlighted", async () => {
    await withPanel("bar", { category: "channel", value: "revenue" });
    expect(document.querySelectorAll(".gw-bar.gw-dim")).toHaveLength(0);
    expect(document.querySelectorAll(".gw-bar.gw-on")).toHaveLength(0);
  });

  it("draws a sparkline from the measure's own series", async () => {
    await withPanel("kpi", { measure: "revenue", sparkline: true }, "by_month");
    const path = document.querySelector(".gw-spark-line");
    expect(path).toBeTruthy();
    // 24 months in the reference data, so 24 points.
    expect(path!.getAttribute("d")!.match(/[ML]/g)).toHaveLength(24);
  });

  it("draws no sparkline where there is no series to draw", async () => {
    // A totals dataset is one row. Two points is a segment, not a trend.
    await withPanel("kpi", { measure: "revenue", sparkline: true }, "totals");
    expect(document.querySelector(".gw-spark-line")).toBeNull();
    // The number is still there — the option degrades rather than failing.
    expect(document.querySelector(".gw-kpi-value")?.textContent).toMatch(/\$/);
  });

  it("reads the last point of a series, not the first", async () => {
    // A KPI beside a trend means "now", not "when the window opened". The two
    // months differ by fifty thousand, so reading the wrong end is not a
    // rounding difference — it is a different number on the dashboard.
    await withPanel("kpi", { measure: "revenue" }, "by_month");
    expect(document.querySelector(".gw-kpi-value")!.textContent).toBe("$221,948");

    // And a single-row dataset still reads that row.
    cleanup();
    await withPanel("kpi", { measure: "revenue" }, "totals");
    expect(document.querySelector(".gw-kpi-value")!.textContent).toBe("$4,282,970");
  });
});

describe("misconfiguration is contained", () => {
  it("reports an unknown panel type without taking the dashboard down", async () => {
    const { manifest, source } = fixture();
    manifest.panels[0]!.type = "sunburst";
    render(<Dashboard manifest={manifest} source={source} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain('Unknown panel type "sunburst"');
    expect(document.querySelectorAll(".gw-panel")).toHaveLength(7);
  });

  it("reports invalid props against the panel's own schema", async () => {
    const { manifest, source } = fixture();
    manifest.panels[0]!.props = { measure: 42 };
    render(<Dashboard manifest={manifest} source={source} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/expected string/);
  });

  it("names a measure that is not in the panel's dataset", async () => {
    const { manifest, source } = fixture();
    manifest.panels[0]!.props = { measure: "not_here" };
    render(<Dashboard manifest={manifest} source={source} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/not in this dataset/);
  });

  it("isolates a panel that throws so its siblings keep rendering", async () => {
    const { manifest, source } = fixture();
    const registry = defaultRegistry().register({
      type: "boom",
      label: "Boom",
      description: "Always throws.",
      schema: obj({}),
      defaults: () => ({}),
      Component: () => { throw new Error("panel exploded"); },
    });
    manifest.panels[0]!.type = "boom";
    manifest.panels[0]!.props = {};
    render(<Dashboard manifest={manifest} source={source} registry={registry} />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("panel exploded");
    // The other six panels are unaffected.
    expect(document.querySelectorAll(".gw-kpi").length).toBe(3);
  });

  it("surfaces an engine failure as a dashboard-level error", async () => {
    const { manifest } = fixture();
    const broken: DataSource = {
      name: "broken",
      capabilities: () => ({ windowFunctions: true, pushdownLimit: false, maxRows: 0 }),
      introspect: async () => [],
      execute: async () => { throw new Error("source unavailable"); },
    };
    render(<Dashboard manifest={manifest} source={broken} />);
    await waitFor(() => {
      expect(screen.getByText("The dashboard could not load")).toBeTruthy();
    });
  });

  it("reports that failure once, even when onError re-renders the host", async () => {
    // Reporting from the render phase re-enters: a host that turns onError
    // into state re-renders the card, which reports again.
    const { manifest } = fixture();
    const broken: DataSource = {
      name: "broken",
      capabilities: () => ({ windowFunctions: true, pushdownLimit: false, maxRows: 0 }),
      introspect: async () => [],
      execute: async () => { throw new Error("source unavailable"); },
    };

    let calls = 0;
    function Host() {
      const [, setSeen] = useState<Error | null>(null);
      return (
        <Dashboard
          manifest={manifest}
          source={broken}
          onError={(e) => { calls++; setSeen(e); }}
        />
      );
    }

    render(<Host />);
    await waitFor(() => expect(calls).toBeGreaterThan(0));
    // Settle any renders the callback itself provoked before counting.
    await act(async () => { await Promise.resolve(); });
    expect(calls).toBe(1);
  });
});

describe("accessibility", () => {
  it("labels each panel region", async () => {
    await mount();
    const regions = [...document.querySelectorAll(".gw-panel")];
    for (const r of regions) expect(r.getAttribute("aria-label")).toBeTruthy();
  });

  it("gives charts a descriptive role and label", async () => {
    await mount();
    for (const svg of document.querySelectorAll("svg")) {
      expect(svg.getAttribute("role")).toBe("img");
      expect(svg.getAttribute("aria-label")).toBeTruthy();
    }
  });

  it("does not rely on colour alone for trend direction", async () => {
    await mount();
    const delta = document.querySelector(".gw-delta");
    if (delta) {
      expect(delta.textContent).toMatch(/[↑↓→]/);
      expect(delta.querySelector(".gw-sr-only")?.textContent).toMatch(/increase|decrease|no change/);
    }
  });

  it("makes clickable marks keyboard reachable", async () => {
    await mount();
    const bar = document.querySelector(".gw-bar")!;
    expect(bar.getAttribute("tabindex")).toBe("0");
    expect(bar.getAttribute("role")).toBe("button");
  });

  it("selects with the keyboard as well as the mouse", async () => {
    const { store } = await mount();
    const bar = document.querySelector(".gw-bar")!;
    await act(async () => { fireEvent.keyDown(bar, { key: "Enter" }); });
    await waitFor(() => expect(store.isEmpty()).toBe(false));
  });

  it("ships dark-mode tokens under both the media query and the theme attribute", () => {
    expect(styles).toContain("prefers-color-scheme: dark");
    expect(styles).toContain('[data-theme="dark"]');
    // Dark series steps are selected for the dark surface, not flipped.
    expect(styles).toContain("#3987e5");
  });
});

describe("registry", () => {
  it("lists the built-in panel types", () => {
    expect(defaultRegistry().types())
      .toEqual(["bar", "heatmap", "kpi", "line", "stack", "table"]);
  });

  it("accepts a custom panel type", () => {
    const r = new PanelRegistry().register({
      type: "gauge", label: "Gauge", description: "",
      schema: obj({ measure: str() }),
      defaults: () => ({ measure: "" }),
      Component: () => null,
    });
    expect(r.has("gauge")).toBe(true);
    expect(r.validateProps("gauge", { measure: "x" })).toEqual([]);
    expect(r.validateProps("gauge", {})).toHaveLength(1);
  });
});

describe("value formatting", () => {
  it("treats # after the point as an optional decimal, as Excel does", () => {
    // `0.##` used to fall through into the suffix and print a literal "##"
    // beside the number, which is how an inferred manifest first showed
    // "4,282,970.##" on a KPI.
    expect(formatValue(5, "#,##0.##")).toBe("5");
    expect(formatValue(5.25, "#,##0.##")).toBe("5.25");
    expect(formatValue(4282970.5, "#,##0.##")).toBe("4,282,970.5");
    // A zero still pins the place, so money keeps its cents.
    expect(formatValue(5, "$#,##0.00")).toBe("$5.00");
  });

  it("applies Excel-style patterns", () => {
    expect(formatValue(1234567, "$#,##0", "en-US")).toBe("$1,234,567");
    expect(formatValue(0.0834, "0.0%", "en-US")).toBe("8.3%");
    expect(formatValue(12.345, "$#,##0.00", "en-US")).toBe("$12.35");
    expect(formatValue(1234, "#,##0", "en-US")).toBe("1,234");
  });

  it("renders nulls as an em dash rather than the word null", () => {
    expect(formatValue(null)).toBe("—");
    expect(formatValue(Number.NaN, "#,##0")).toBe("—");
  });

  it("passes strings and booleans through readably", () => {
    expect(formatValue("North")).toBe("North");
    expect(formatValue(true)).toBe("Yes");
  });
});
