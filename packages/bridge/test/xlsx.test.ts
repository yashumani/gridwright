import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readWorkbook, parseAddress, XlsxError, DEFAULT_XLSX_LIMITS } from "../src/xlsx.js";
import { writeWorkbook, columnLetter } from "./support/write-xlsx.js";

const fixture = (p: string) => fileURLToPath(new URL(`../../../fixtures/support-ops/${p}`, import.meta.url));

describe("addresses", () => {
  it("reads A1 notation, including past Z", () => {
    expect(parseAddress("A1")).toEqual({ column: 1, row: 1 });
    expect(parseAddress("B7")).toEqual({ column: 2, row: 7 });
    expect(parseAddress("Z1")).toEqual({ column: 26, row: 1 });
    // Bijective base-26: AA is 27, not 26.
    expect(parseAddress("AA1")).toEqual({ column: 27, row: 1 });
    expect(parseAddress("AB10")).toEqual({ column: 28, row: 10 });
  });

  it("round-trips against the writer's own column letters", () => {
    for (const n of [1, 25, 26, 27, 52, 53, 702, 703]) {
      expect(parseAddress(`${columnLetter(n)}1`).column).toBe(n);
    }
  });

  it("refuses an address that is not A1 form", () => {
    for (const bad of ["1A", "", "A", "7", "A1:B2"]) {
      expect(() => parseAddress(bad)).toThrow(XlsxError);
    }
  });
});

describe("reading values", () => {
  it("reads each type as itself, not as a string", () => {
    const wb = readWorkbook(
      "types.xlsx",
      writeWorkbook([{ name: "S", rows: [["text", 42, true, null]] }]),
    );
    const row = wb.sheets[0]!.rows[0]!;
    expect(row.map((c) => [c.kind, c.value])).toEqual([
      ["string", "text"],
      ["number", 42],
      ["boolean", true],
      ["blank", null],
    ]);
  });

  it("keeps a blank cell rather than dropping it", () => {
    // R14 turns on this: an empty configured row must survive to the report,
    // so an empty cell cannot vanish on the way in.
    const wb = readWorkbook("blank.xlsx", writeWorkbook([{ name: "S", rows: [[null, "after"]] }]));
    const row = wb.sheets[0]!.rows[0]!;
    expect(row).toHaveLength(2);
    expect(row[0]!.kind).toBe("blank");
    expect(row[0]!.value).toBeNull();
  });

  it("does not let a self-closed empty row swallow the next one", () => {
    // Excel writes an empty row as <row r="2"/>, and `[^>]*` will match
    // `r="2"/` and then take the `>` — so with the paired form tried first the
    // scan runs on to the *next* row's </row> and eats it. The writer here
    // emits <row r="2"></row>, so only a hand-built part exposes this.
    const wb = readWorkbook(
      "selfclosed.xlsx",
      writeWorkbook([{ name: "S", rows: [["x"]] }], {
        overrides: {
          "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>first</t></is></c></row><row r="2"/><row r="3"><c r="A3" t="inlineStr"><is><t>third</t></is></c></row></sheetData></worksheet>`,
        },
      }),
    );
    const rows = wb.sheets[0]!.rows;
    expect(rows).toHaveLength(3);
    expect(rows[0]![0]!.value).toBe("first");
    expect(rows[1]).toEqual([]);
    expect(rows[2]![0]!.value).toBe("third");
  });

  it("gives every value its workbook, sheet, address and row", () => {
    const wb = readWorkbook("prov.xlsx", writeWorkbook([{ name: "Skeleton", rows: [["a"], ["b"]] }]));
    expect(wb.sheets[0]!.rows[1]![0]!.ref).toEqual({
      workbook: "prov.xlsx",
      sheet: "Skeleton",
      address: "A2",
      row: 2,
      column: 1,
    });
  });

  it("decodes the five XML entities and nothing else", () => {
    const wb = readWorkbook(
      "ent.xlsx",
      writeWorkbook([{ name: "S", rows: [['a & b < c > d "e"']] }]),
    );
    expect(wb.sheets[0]!.rows[0]![0]!.value).toBe('a & b < c > d "e"');
  });

  it("reads more than one sheet, in the workbook's own order", () => {
    const wb = readWorkbook(
      "two.xlsx",
      writeWorkbook([
        { name: "First", rows: [["1"]] },
        { name: "Second", rows: [["2"]] },
      ]),
    );
    expect(wb.sheets.map((s) => s.name)).toEqual(["First", "Second"]);
  });
});

describe("the formula policy", () => {
  /** A sheet part with a formula cell, written by hand so we control <f>. */
  const withFormula = (inner: string) =>
    writeWorkbook([{ name: "S", rows: [[1]] }], {
      overrides: {
        "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${inner}</row></sheetData></worksheet>`,
      },
    });

  it("uses the cached value and records the formula without evaluating it", () => {
    const wb = readWorkbook("f.xlsx", withFormula('<c r="A1"><f>SUM(B1:B9)</f><v>120</v></c>'));
    const cell = wb.sheets[0]!.rows[0]![0]!;
    expect(cell.value).toBe(120);
    expect(cell.formula).toBe("SUM(B1:B9)");
  });

  it("leaves a formula with no cached value blank, and says so", () => {
    // The alternative is inventing a number, which is the thing this whole
    // package exists not to do.
    const wb = readWorkbook("f.xlsx", withFormula('<c r="A1"><f>SUM(B1:B9)</f></c>'));
    expect(wb.sheets[0]!.rows[0]![0]!.kind).toBe("blank");
    expect(wb.diagnostics.join(" ")).toMatch(/A1: formula with no cached value/);
  });

  it("carries an error cell as an error, never as zero", () => {
    const wb = readWorkbook("f.xlsx", withFormula('<c r="A1" t="e"><f>1/0</f><v>#DIV/0!</v></c>'));
    const cell = wb.sheets[0]!.rows[0]![0]!;
    expect(cell.kind).toBe("error");
    expect(cell.value).toBe("#DIV/0!");
  });

  it("names a shared or array formula instead of half-reporting it", () => {
    const wb = readWorkbook("f.xlsx", withFormula('<c r="A1"><f t="shared" si="0"/><v>7</v></c>'));
    expect(wb.sheets[0]!.rows[0]![0]!.value).toBe(7);
    expect(wb.diagnostics.join(" ")).toMatch(/shared formula not read/);
  });
});

describe("what the reader refuses", () => {
  it("refuses a macro-enabled workbook at the container", () => {
    const wb = writeWorkbook([{ name: "S", rows: [["x"]] }], {
      extraEntries: [{ name: "xl/vbaProject.bin", data: Buffer.from("MZ fake macro") }],
    });
    expect(() => readWorkbook("macro.xlsm", wb)).toThrow(/contains macros/);
  });

  it("refuses a workbook that links to another workbook", () => {
    const wb = writeWorkbook([{ name: "S", rows: [["x"]] }], {
      extraEntries: [
        { name: "xl/externalLinks/externalLink1.xml", data: Buffer.from("<externalLink/>") },
      ],
    });
    expect(() => readWorkbook("linked.xlsx", wb)).toThrow(/external links are not accepted/);
  });

  it("refuses a DOCTYPE declaration rather than ignoring it", () => {
    // This reader resolves no entities, so a declaration could only be inert.
    // Accepting one quietly would leave the next reader of this code unable to
    // tell that from a parser that does resolve them.
    const wb = writeWorkbook([{ name: "S", rows: [["x"]] }], {
      overrides: {
        "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>`,
      },
    });
    expect(() => readWorkbook("xxe.xlsx", wb)).toThrow(/DOCTYPE/);
  });

  it("refuses a file that is not a workbook", () => {
    expect(() => readWorkbook("nope.xlsx", Buffer.from("not a zip"))).toThrow(XlsxError);
  });

  it("refuses a shared-string reference that points nowhere", () => {
    const wb = writeWorkbook([{ name: "S", rows: [["x"]] }], {
      overrides: {
        "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>99</v></c></row></sheetData></worksheet>`,
      },
    });
    expect(() => readWorkbook("dangling.xlsx", wb)).toThrow(/shared string 99, which does not exist/);
  });

  it("stops a sheet with more rows than the limit", () => {
    const rows = Array.from({ length: 30 }, (_, i) => [i]);
    expect(() =>
      readWorkbook("many.xlsx", writeWorkbook([{ name: "S", rows }]), {
        ...DEFAULT_XLSX_LIMITS,
        maxRows: 10,
      }),
    ).toThrow(/more than 10 rows/);
  });

  it("stops a row with more columns than the limit", () => {
    const wide = [Array.from({ length: 30 }, (_, i) => i)];
    expect(() =>
      readWorkbook("wide.xlsx", writeWorkbook([{ name: "S", rows: wide }]), {
        ...DEFAULT_XLSX_LIMITS,
        maxColumns: 8,
      }),
    ).toThrow(/more than 8 columns/);
  });

  it("reports a declared sheet whose part is missing, and keeps the rest", () => {
    const wb = writeWorkbook([
      { name: "Present", rows: [["a"]] },
      { name: "Gone", rows: [["b"]] },
    ]);
    // Blank the second sheet's part so the relationship dangles.
    const broken = writeWorkbook(
      [
        { name: "Present", rows: [["a"]] },
        { name: "Gone", rows: [["b"]] },
      ],
      { overrides: { "xl/worksheets/sheet2.xml": "" } },
    );
    expect(readWorkbook("ok.xlsx", wb).sheets).toHaveLength(2);
    // An empty part still parses to zero rows rather than vanishing; the point
    // is that the reader does not throw away the sheet that is fine.
    expect(readWorkbook("half.xlsx", broken).sheets[0]!.name).toBe("Present");
  });
});

describe("the support-operations fixture", () => {
  const bytes = readFileSync(fixture("skeleton.xlsx"));

  it("reads the committed workbook the build script produced", () => {
    const wb = readWorkbook("skeleton.xlsx", bytes);
    expect(wb.sheets.map((s) => s.name)).toEqual(["Skeleton", "Config"]);
    expect(wb.diagnostics).toEqual([]);
  });

  it("preserves the skeleton's row order and headings", () => {
    // R14 in miniature: this order is the deliverable, before any data exists.
    const wb = readWorkbook("skeleton.xlsx", bytes);
    const skeleton = wb.sheets[0]!;
    const keys = skeleton.rows.slice(4).map((r) => r[0]?.value);
    expect(keys).toEqual(["queue_a", "queue_b", "queue_c", "total"]);
    const headings = skeleton.rows.slice(4).map((r) => r[1]?.value);
    expect(headings).toEqual(["Queue A", "Queue B", "Queue C", "Total"]);
  });

  it("keeps Queue C, the row the view returns nothing for", () => {
    // The whole reason the fixture has three queues and two rows of data.
    const wb = readWorkbook("skeleton.xlsx", bytes);
    const queueC = wb.sheets[0]!.rows.find((r) => r[0]?.value === "queue_c");
    expect(queueC).toBeDefined();
    expect(queueC![1]!.value).toBe("Queue C");
    expect(queueC![1]!.ref.address).toBe("B7");
  });

  it("reads the declared additivity as a boolean, not a word", () => {
    // R08: a metric is additive because the configuration says so.
    const wb = readWorkbook("skeleton.xlsx", bytes);
    const config = wb.sheets[1]!;
    const additive = config.rows.find((r) => r[0]?.value === "additive");
    expect(additive![1]!.kind).toBe("boolean");
    expect(additive![1]!.value).toBe(true);
  });

  it("leaves polarity unset, because direction is not the fixture's to assert", () => {
    const wb = readWorkbook("skeleton.xlsx", bytes);
    const polarity = wb.sheets[1]!.rows.find((r) => r[0]?.value === "polarity");
    expect(polarity![1]!.value).toBe("unset");
  });
});
