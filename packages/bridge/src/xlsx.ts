import { ZipArchive, ZipError, type ZipLimits, DEFAULT_ZIP_LIMITS } from "./zip.js";

/**
 * Reads the small part of SpreadsheetML that a configuration table needs, and
 * refuses the rest by name.
 *
 * R10 asks for configuration tables read "with workbook/sheet/table/row
 * provenance", with macros, external links and arbitrary formulas not
 * executed, and unsupported constructs rejected clearly. That shapes every
 * decision here:
 *
 *   - **Nothing is evaluated.** A formula cell carries Excel's own cached
 *     result. That value is read and the formula is recorded as text, so a
 *     reviewer can see what produced it; the expression is never interpreted.
 *     A formula with no cached value is a diagnostic, because the alternative
 *     is inventing a number.
 *   - **Macros are refused at the container.** A workbook carrying
 *     `vbaProject.bin` is rejected before any sheet is read.
 *   - **External links are refused**, since a cell whose value depends on
 *     another workbook is not configuration this bridge can reproduce.
 *   - **Every value keeps its address.** A cell is worthless in a diagnostic
 *     without "which workbook, which sheet, which row", which is the whole
 *     point of `CellRef`.
 *
 * The XML is scanned, not parsed into a document. The accepted grammar is
 * small enough to state — rows, cells, types, values, inline strings — and a
 * scanner cannot be talked into resolving an entity or following a reference,
 * which a general XML parser must be configured not to do. A DOCTYPE is
 * rejected outright rather than ignored.
 */

export interface XlsxLimits extends ZipLimits {
  /** Most rows read from one sheet. */
  maxRows: number;
  /** Most columns read from one row. */
  maxColumns: number;
  /** Longest single cell string. */
  maxCellChars: number;
  /** Most entries in the shared string table. */
  maxSharedStrings: number;
}

export const DEFAULT_XLSX_LIMITS: XlsxLimits = {
  ...DEFAULT_ZIP_LIMITS,
  maxRows: 50_000,
  maxColumns: 256,
  maxCellChars: 32_768,
  maxSharedStrings: 200_000,
};

/** Where a value came from, so a diagnostic can name it. */
export interface CellRef {
  /** The workbook's own file name, as supplied by the caller. */
  workbook: string;
  sheet: string;
  /** The A1 address, e.g. "B7". */
  address: string;
  /** 1-based, matching what a person sees in Excel. */
  row: number;
  column: number;
}

export type CellKind = "string" | "number" | "boolean" | "blank" | "error";

export interface Cell {
  ref: CellRef;
  kind: CellKind;
  /** Blank cells carry null rather than being dropped: R14 keeps empty rows. */
  value: string | number | boolean | null;
  /**
   * The formula text, when the cell had one. Recorded, never evaluated — a
   * reviewer can see what Excel computed the cached value from.
   */
  formula?: string;
}

export interface SheetRead {
  name: string;
  /** Rows in sheet order. A row absent from the file is absent here. */
  rows: Cell[][];
}

export interface WorkbookRead {
  workbook: string;
  sheets: SheetRead[];
  /**
   * Everything skipped or refused, in words. Never empty by accident: an
   * unsupported construct produces a line here rather than a silent default.
   */
  diagnostics: string[];
}

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxError";
  }
}

/** "B7" -> { column: 2, row: 7 }. Excel's column letters are base-26 bijective. */
export function parseAddress(address: string): { column: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(address);
  if (!m) throw new XlsxError(`cell address "${address}" is not in A1 form`);
  let column = 0;
  for (const ch of m[1]!) column = column * 26 + (ch.charCodeAt(0) - 64);
  return { column, row: Number(m[2]) };
}

/** The five entity references XML defines. No others are resolved, ever. */
function decodeXmlText(s: string): string {
  return s.replace(/&(lt|gt|amp|quot|apos|#x?[0-9A-Fa-f]+);/g, (whole, body: string) => {
    switch (body) {
      case "lt": return "<";
      case "gt": return ">";
      case "amp": return "&";
      case "quot": return '"';
      case "apos": return "'";
      default: {
        const code = body.startsWith("#x") || body.startsWith("#X")
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
        // Only well-formed scalar values; anything else stays literal rather
        // than becoming a surrogate half or a control character.
        return Number.isFinite(code) && code >= 0x20 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
    }
  });
}

/**
 * A DOCTYPE is how XXE arrives. This reader never resolves entities, so a
 * declaration could only be inert — but accepting one quietly would mean the
 * next reader of this code cannot tell that from a reader that does.
 */
function rejectDoctype(xml: string, part: string): void {
  if (/<!DOCTYPE/i.test(xml)) {
    throw new XlsxError(`${part} contains a DOCTYPE declaration, which is not accepted`);
  }
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXmlText(m[1]!) : undefined;
}

/** The shared string table: `<si>` entries, each possibly split across runs. */
function readSharedStrings(xml: string, limits: XlsxLimits): string[] {
  rejectDoctype(xml, "sharedStrings.xml");
  const out: string[] = [];
  const si = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = si.exec(xml)) !== null) {
    if (out.length >= limits.maxSharedStrings) {
      throw new XlsxError(`shared string table is over the limit of ${limits.maxSharedStrings}`);
    }
    const body = m[1] ?? "";
    // A string can be one <t>, or many <t> inside <r> runs when parts of it
    // are formatted differently. Both mean the same text.
    let text = "";
    const t = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = t.exec(body)) !== null) text += decodeXmlText(tm[1]!);
    out.push(text.slice(0, limits.maxCellChars));
  }
  return out;
}

function cellValue(
  tag: string,
  body: string,
  shared: readonly string[],
  limits: XlsxLimits,
): { kind: CellKind; value: string | number | boolean | null } {
  const type = attr(tag, "t") ?? "n";

  const vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
  const raw = vm ? decodeXmlText(vm[1]!) : undefined;

  if (type === "inlineStr") {
    let text = "";
    const t = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = t.exec(body)) !== null) text += decodeXmlText(tm[1]!);
    return { kind: "string", value: text.slice(0, limits.maxCellChars) };
  }

  if (raw === undefined) return { kind: "blank", value: null };

  switch (type) {
    case "s": {
      const i = Number(raw);
      if (!Number.isInteger(i) || i < 0 || i >= shared.length) {
        throw new XlsxError(`cell references shared string ${raw}, which does not exist`);
      }
      return { kind: "string", value: shared[i]! };
    }
    case "str":
      return { kind: "string", value: raw.slice(0, limits.maxCellChars) };
    case "b":
      return { kind: "boolean", value: raw === "1" || raw.toLowerCase() === "true" };
    case "e":
      // #REF!, #DIV/0! and friends. Carried as an error, never as a number and
      // never as zero.
      return { kind: "error", value: raw };
    case "n":
    default: {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        return { kind: "error", value: raw };
      }
      return { kind: "number", value: n };
    }
  }
}

function readSheet(
  xml: string,
  sheetName: string,
  workbook: string,
  shared: readonly string[],
  limits: XlsxLimits,
  diagnostics: string[],
): SheetRead {
  rejectDoctype(xml, `sheet "${sheetName}"`);
  const rows: Cell[][] = [];

  // The self-closing form is tried first here and for cells and formulas
  // below, and the order is load-bearing: `[^>]*` will match `r="2"/` and
  // then take the `>` of `<row r="2"/>`, so with the paired form first an
  // empty self-closed row runs on to the next row's </row> and swallows it.
  const rowRe = /<row\b([^>]*)\/>|<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;

  while ((rm = rowRe.exec(xml)) !== null) {
    if (rows.length >= limits.maxRows) {
      throw new XlsxError(
        `sheet "${sheetName}" has more than ${limits.maxRows} rows, over the limit`,
      );
    }
    const rowTag = rm[1] ?? rm[2] ?? "";
    const rowBody = rm[3] ?? "";
    const declaredRow = Number(attr(`<row ${rowTag}>`, "r") ?? rows.length + 1);

    const cells: Cell[] = [];
    const cellRe = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cm: RegExpExecArray | null;

    while ((cm = cellRe.exec(rowBody)) !== null) {
      if (cells.length >= limits.maxColumns) {
        throw new XlsxError(
          `row ${declaredRow} of sheet "${sheetName}" has more than ${limits.maxColumns} columns`,
        );
      }
      const cellTag = `<c ${cm[1] ?? cm[2] ?? ""}>`;
      const cellBody = cm[3] ?? "";
      const address = attr(cellTag, "r");
      if (!address) {
        diagnostics.push(`sheet "${sheetName}" row ${declaredRow}: a cell has no address; skipped`);
        continue;
      }
      const { column, row } = parseAddress(address);

      const fm = /<f\b([^>]*)\/>|<f\b([^>]*)>([\s\S]*?)<\/f>/.exec(cellBody);
      let formula: string | undefined;
      if (fm) {
        const fTag = `<f ${fm[1] ?? fm[2] ?? ""}>`;
        const kind = attr(fTag, "t");
        // A shared or array formula's text lives in another cell, and a data
        // table's is generated. None of them can be shown honestly here, and
        // none is evaluated, so each is named rather than half-reported.
        if (kind && kind !== "normal") {
          diagnostics.push(
            `sheet "${sheetName}" ${address}: ${kind} formula not read; its cached value is used`,
          );
        }
        formula = decodeXmlText(fm[3] ?? "").slice(0, limits.maxCellChars);
      }

      const { kind, value } = cellValue(cellTag, cellBody, shared, limits);

      if (formula !== undefined && kind === "blank") {
        diagnostics.push(
          `sheet "${sheetName}" ${address}: formula with no cached value; left blank rather than computed`,
        );
      }

      cells.push({
        ref: { workbook, sheet: sheetName, address, row, column },
        kind,
        value,
        ...(formula !== undefined ? { formula } : {}),
      });
    }

    rows.push(cells);
  }

  return { name: sheetName, rows };
}

/**
 * Opens a workbook and reads its sheets.
 *
 * `name` is the file's own name; it travels into every `CellRef` so a
 * diagnostic from three layers up can still say which workbook it means.
 */
export function readWorkbook(
  name: string,
  bytes: Uint8Array,
  limits: XlsxLimits = DEFAULT_XLSX_LIMITS,
): WorkbookRead {
  let zip: ZipArchive;
  try {
    zip = ZipArchive.open(bytes, limits);
  } catch (e) {
    if (e instanceof ZipError) throw new XlsxError(`${name}: ${e.message}`);
    throw e;
  }

  const diagnostics: string[] = [];
  const entries = zip.names();

  // Refused at the container, before a single sheet is read.
  const macro = entries.find((n) => /vbaProject\.bin$/i.test(n));
  if (macro) {
    throw new XlsxError(
      `${name}: workbook contains macros (${macro}); macro-enabled workbooks are not accepted`,
    );
  }
  const external = entries.filter((n) => /^xl\/externalLinks\//i.test(n));
  if (external.length > 0) {
    throw new XlsxError(
      `${name}: workbook links to ${external.length} external workbook(s); external links are not accepted`,
    );
  }

  if (!zip.has("xl/workbook.xml")) {
    throw new XlsxError(`${name}: not a workbook (no xl/workbook.xml)`);
  }

  const workbookXml = zip.readText("xl/workbook.xml");
  rejectDoctype(workbookXml, "workbook.xml");

  // Sheet name -> relationship id, in the workbook's own order.
  const sheetTags = [...workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => `<sheet ${m[1]}>`);
  if (sheetTags.length === 0) throw new XlsxError(`${name}: workbook declares no sheets`);

  const relsXml = zip.has("xl/_rels/workbook.xml.rels")
    ? zip.readText("xl/_rels/workbook.xml.rels")
    : "";
  if (relsXml) rejectDoctype(relsXml, "workbook.xml.rels");
  const targets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const tag = `<Relationship ${m[1]}>`;
    const id = attr(tag, "Id");
    const target = attr(tag, "Target");
    if (id && target) targets.set(id, target.replace(/^\/?(xl\/)?/, ""));
  }

  const shared = zip.has("xl/sharedStrings.xml")
    ? readSharedStrings(zip.readText("xl/sharedStrings.xml"), limits)
    : [];

  const sheets: SheetRead[] = [];
  for (const tag of sheetTags) {
    const sheetName = attr(tag, "name");
    if (!sheetName) {
      diagnostics.push("workbook declares a sheet with no name; skipped");
      continue;
    }
    const rid = attr(tag, "r:id") ?? attr(tag, "id");
    const target = rid ? targets.get(rid) : undefined;
    const path = target ? `xl/${target}` : `xl/worksheets/${sheetName}.xml`;

    if (!zip.has(path)) {
      diagnostics.push(`sheet "${sheetName}" is declared but its part (${path}) is missing; skipped`);
      continue;
    }
    sheets.push(readSheet(zip.readText(path), sheetName, name, shared, limits, diagnostics));
  }

  if (sheets.length === 0) throw new XlsxError(`${name}: no readable sheets`);
  return { workbook: name, sheets, diagnostics };
}
