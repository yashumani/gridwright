import { deflateRawSync, crc32 } from "node:zlib";

/**
 * A minimal `.xlsx` writer, for tests and fixtures only.
 *
 * The reader is the product; this exists so the reader can be tested against
 * real archive bytes rather than a hand-mocked object, and so the fixture
 * workbook is reviewable as code instead of arriving as an opaque binary.
 * It writes the smallest workbook Excel will open: no styles, no shared
 * strings unless asked, inline strings elsewhere.
 */

export type CellValue = string | number | boolean | null;

export interface SheetSpec {
  name: string;
  /** Rows of values. `null` writes a cell that exists and is empty. */
  rows: CellValue[][];
}

interface FileEntry {
  name: string;
  data: Buffer;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 1 -> "A", 27 -> "AA". Excel's columns are bijective base-26. */
export function columnLetter(n: number): string {
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function sheetXml(spec: SheetSpec): string {
  const rows = spec.rows
    .map((cells, r) => {
      const rowNumber = r + 1;
      const body = cells
        .map((v, c) => {
          const ref = `${columnLetter(c + 1)}${rowNumber}`;
          if (v === null) return `<c r="${ref}"/>`;
          if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
          if (typeof v === "boolean") return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(v)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowNumber}">${body}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

/** ZIP local header + central directory, store or deflate, no ZIP64. */
function zip(entries: FileEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const deflated = deflateRawSync(entry.data);
    // Only take the compression if it actually helps; a tiny part can grow.
    const useDeflate = deflated.length < entry.data.length;
    const body = useDeflate ? deflated : entry.data;
    const method = useDeflate ? 8 : 0;
    const sum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // disk
  end.writeUInt16LE(0, 6); // disk with central dir
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralBuf, end]);
}

export interface WorkbookOptions {
  /** Extra archive members, for testing what the reader refuses. */
  extraEntries?: FileEntry[];
  /** Replace a generated part wholesale, for malformed-XML tests. */
  overrides?: Record<string, string>;
}

export function writeWorkbook(sheets: SheetSpec[], options: WorkbookOptions = {}): Buffer {
  const sheetTags = sheets
    .map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");

  const parts: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("")}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("")}</Relationships>`,
  };

  sheets.forEach((s, i) => {
    parts[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s);
  });

  Object.assign(parts, options.overrides ?? {});

  const entries: FileEntry[] = Object.entries(parts).map(([name, xml]) => ({
    name,
    data: Buffer.from(xml, "utf8"),
  }));

  return zip([...entries, ...(options.extraEntries ?? [])]);
}
