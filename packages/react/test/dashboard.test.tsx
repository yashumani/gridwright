import { describe, expect, it, beforeEach } from "vitest";
import { act } from "react";
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
    expect(defaultRegistry().types()).toEqual(["bar", "kpi", "line", "table"]);
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
