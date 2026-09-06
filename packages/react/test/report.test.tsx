import { describe, expect, it, beforeEach } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compileReport,
  fillReport,
  readWorkbook,
  resolveBindings,
  type BindingSpec,
  type MetadataSnapshot,
  type ReportResult,
  type ViewRow,
} from "@gridwright/bridge";
import { Report } from "@gridwright/react";

// Resolved from the working directory rather than import.meta.url: this file
// runs under jsdom, where that URL is not the module's path on disk.
const fixturePath = (p: string) => resolve(process.cwd(), "fixtures/support-ops", p);
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

function result(): ReportResult {
  const wb = readWorkbook("skeleton.xlsx", readFileSync(fixturePath("skeleton.xlsx")));
  const raw = readJson("sql-metadata.json");
  const metadata: MetadataSnapshot = { ...raw.snapshot, metrics: raw.metrics, views: raw.views };
  const bindings: BindingSpec = readJson("bindings.json");

  const resolved = resolveBindings(wb, metadata, bindings);
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.problems));
  const compiled = compileReport(wb, resolved.resolution, {});
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
  return fillReport(compiled.definition, {
    rows: preparedView(),
    keyColumn: "queue_key",
    periodColumn: "period",
  });
}

const cellsOf = (rowKey: string) =>
  [...document.querySelectorAll(`[data-row-key="${rowKey}"] td`)].map((td) => td.textContent);

beforeEach(cleanup);

describe("the rendered report keeps the skeleton", () => {
  it("draws every configured row in order, including the empty one", () => {
    render(<Report result={result()} title="Closed cases by queue" />);
    const keys = [...document.querySelectorAll("[data-row-key]")].map((r) =>
      r.getAttribute("data-row-key"),
    );
    expect(keys).toEqual(["queue_a", "queue_b", "queue_c", "total"]);
  });

  it("shows each row's configured heading", () => {
    render(<Report result={result()} />);
    const headings = [...document.querySelectorAll("[data-row-key] th")].map((h) => h.textContent);
    expect(headings).toEqual(["Queue A", "Queue B", "Queue C", "Total"]);
  });

  it("indents from the configured level rather than from the row's kind", () => {
    render(<Report result={result()} />);
    const queueA = document.querySelector('[data-row-key="queue_a"] th') as HTMLElement;
    const total = document.querySelector('[data-row-key="total"] th') as HTMLElement;
    // Indent 1 and indent 0 in the workbook.
    expect(queueA.style.paddingLeft).toBe("24px");
    expect(total.style.paddingLeft).toBe("10px");
  });

  it("marks the total row so it can carry weight", () => {
    render(<Report result={result()} />);
    expect(document.querySelector('[data-row-key="total"]')!.className).toContain("gw-rpt-total");
  });
});

describe("the numbers on screen", () => {
  it("shows the golden values", () => {
    render(<Report result={result()} />);
    expect(cellsOf("queue_a")).toEqual(["70", "60", "+10"]);
    expect(cellsOf("queue_b")).toEqual(["50", "40", "+10"]);
    expect(cellsOf("total")).toEqual(["120", "100", "+20"]);
  });

  it("draws a missing value as missing, not as blank and not as zero", () => {
    // An empty cell reads as a zero somebody forgot to format; a 0 is a
    // measurement the source never made. Neither is true of Queue C.
    render(<Report result={result()} />);
    const cells = document.querySelectorAll('[data-row-key="queue_c"] td');
    for (const td of cells) {
      expect(td.getAttribute("data-availability")).toBe("not_available");
      expect(td.textContent).toContain("—");
      expect(td.textContent).not.toBe("0");
      expect(within(td as HTMLElement).getByText("not available")).toBeTruthy();
    }
  });

  it("keeps availability inspectable even when a policy supplies a number", () => {
    const base = result();
    const zeroed: ReportResult = {
      ...base,
      rows: base.rows.map((r) =>
        r.rowKey === "queue_c"
          ? {
              ...r,
              cells: Object.fromEntries(
                Object.entries(r.cells).map(([k, c]) => [
                  k,
                  { ...c, value: 0 as number | null },
                ]),
              ),
            }
          : r,
      ),
    };
    render(<Report result={zeroed} />);
    const td = document.querySelector('[data-row-key="queue_c"] td')!;
    expect(td.textContent).toBe("0");
    // The number says zero; the attribute still says the source said nothing.
    expect(td.getAttribute("data-availability")).toBe("not_available");
  });

  it("signs a variance without judging it", () => {
    // R09: polarity belongs to the approved metric definition, and this
    // fixture's is unset. A green +20 would assert a verdict nobody approved.
    render(<Report result={result()} />);
    const variance = document.querySelector('[data-row-key="total"] td:last-child')!;
    expect(variance.textContent).toBe("+20");
    expect(variance.className).not.toMatch(/good|bad|up|down|positive|negative/);
  });
});

describe("accessibility of the table", () => {
  it("names the columns and scopes the row headers", () => {
    render(<Report result={result()} periodLabels={{ actual: "Actual", comparison: "Prior" }} />);
    const columns = [...document.querySelectorAll("thead th")].map((h) => h.textContent!.trim());
    expect(columns.slice(1)).toEqual(["Actual", "Prior", "Variance"]);
    for (const th of document.querySelectorAll("tbody th")) {
      expect(th.getAttribute("scope")).toBe("row");
    }
  });

  it("gives a missing cell a spoken label rather than only a dash", () => {
    render(<Report result={result()} />);
    const td = document.querySelector('[data-row-key="queue_c"] td')!;
    expect(td.querySelector(".gw-sr-only")!.textContent).toBe("not available");
    expect(td.querySelector('[aria-hidden="true"]')!.textContent).toBe("—");
  });
});
