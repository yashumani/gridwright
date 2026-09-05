import { describe, expect, it } from "vitest";
import { deflateRawSync, crc32 } from "node:zlib";
import { ZipArchive, ZipError, DEFAULT_ZIP_LIMITS } from "../src/zip.js";
import { writeWorkbook } from "./support/write-xlsx.js";

/**
 * The reader's limits are the reason it exists, so they are tested by building
 * archives that violate them — not by asserting the constants.
 */

/** A one-entry archive with whatever bytes and declared sizes we want. */
function archive(
  name: string,
  data: Buffer,
  o: { method?: number; declaredSize?: number; flags?: number } = {},
): Buffer {
  const method = o.method ?? 8;
  const body = method === 8 ? deflateRawSync(data) : data;
  const declared = o.declaredSize ?? data.length;
  const nameBuf = Buffer.from(name, "utf8");
  const sum = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(o.flags ?? 0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(sum, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(declared, 22);
  local.writeUInt16LE(nameBuf.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(o.flags ?? 0, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(sum, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(declared, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);

  const offset = local.length + nameBuf.length + body.length;
  const centralLength = central.length + nameBuf.length;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralLength, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([local, nameBuf, body, central, nameBuf, end]);
}

describe("reading a well-formed archive", () => {
  it("lists and inflates its entries", () => {
    const zip = ZipArchive.open(archive("hello.txt", Buffer.from("hello bridge")));
    expect(zip.names()).toEqual(["hello.txt"]);
    expect(zip.readText("hello.txt")).toBe("hello bridge");
  });

  it("reads a stored entry as well as a deflated one", () => {
    const zip = ZipArchive.open(archive("raw.txt", Buffer.from("no compression"), { method: 0 }));
    expect(zip.readText("raw.txt")).toBe("no compression");
  });

  it("reads every part of a real workbook", () => {
    const zip = ZipArchive.open(writeWorkbook([{ name: "S", rows: [["a", 1]] }]));
    expect(zip.has("xl/workbook.xml")).toBe(true);
    expect(zip.readText("xl/worksheets/sheet1.xml")).toContain("<row r=\"1\">");
  });

  it("names the entry it cannot find", () => {
    const zip = ZipArchive.open(archive("a.txt", Buffer.from("x")));
    expect(() => zip.read("b.txt")).toThrow(/no entry "b.txt"/);
  });
});

describe("refusing what a bounded reader must refuse", () => {
  it("stops a zip bomb on its ratio, before allocating the output", () => {
    // 2 MB of zeros compresses to almost nothing — a ratio far past the cap.
    const bomb = archive("bomb.bin", Buffer.alloc(2 * 1024 * 1024));
    expect(() => ZipArchive.open(bomb).read("bomb.bin")).toThrow(ZipError);
    expect(() => ZipArchive.open(bomb).read("bomb.bin")).toThrow(/expands \d+x, over the limit/);
  });

  it("stops an entry that declares more than the per-entry limit", () => {
    const zip = ZipArchive.open(archive("big.txt", Buffer.from("small")), {
      ...DEFAULT_ZIP_LIMITS,
      maxEntryBytes: 4,
    });
    expect(() => zip.read("big.txt")).toThrow(/over the per-entry limit/);
  });

  it("stops many small entries adding up past the archive-wide limit", () => {
    // Each part is well under the per-entry cap; together they are not.
    const rows = Array.from({ length: 40 }, (_, i) => [`row ${i}`, i]);
    const zip = ZipArchive.open(writeWorkbook([{ name: "S", rows }]), {
      ...DEFAULT_ZIP_LIMITS,
      maxEntryBytes: 4096,
      maxTotalBytes: 600,
    });
    expect(() => {
      for (const name of zip.names()) zip.read(name);
    }).toThrow(/archive-wide limit/);
  });

  it("stops an archive declaring more entries than the limit", () => {
    const many = writeWorkbook([
      { name: "A", rows: [[1]] },
      { name: "B", rows: [[1]] },
    ]);
    expect(() => ZipArchive.open(many, { ...DEFAULT_ZIP_LIMITS, maxEntries: 2 })).toThrow(
      /over the limit of 2/,
    );
  });

  it("refuses an encrypted entry rather than returning ciphertext", () => {
    // Bit 0 of the general-purpose flags is the encryption flag. Handing back
    // the raw bytes as if they were XML would be worse than failing.
    const enc = archive("secret.xml", Buffer.from("<a/>"), { flags: 0x1 });
    expect(() => ZipArchive.open(enc)).toThrow(/encrypted/);
  });

  it("refuses an unsupported compression method by number", () => {
    const zip = ZipArchive.open(archive("odd.bin", Buffer.from("x"), { method: 0 }));
    // Rewrite the central-directory method to something exotic (bzip2 = 12).
    const raw = archive("odd.bin", Buffer.from("x"), { method: 0 });
    const central = raw.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    raw.writeUInt16LE(12, central + 10);
    expect(zip.readText("odd.bin")).toBe("x"); // control: method 0 is fine
    expect(() => ZipArchive.open(raw).read("odd.bin")).toThrow(/unsupported compression method 12/);
  });

  it("refuses something that is not an archive at all", () => {
    expect(() => ZipArchive.open(Buffer.from("this is not a zip file"))).toThrow(
      /no end-of-central-directory/,
    );
    expect(() => ZipArchive.open(Buffer.alloc(4))).toThrow(/too short/);
  });

  it("does not trust a lying declared size", () => {
    // The header claims 5 bytes; the entry really inflates to 200_000. zlib's
    // own maxOutputLength is what stops it, not the claim.
    const data = Buffer.alloc(200_000, 0x41);
    const lying = archive("liar.bin", data, { declaredSize: 5 });
    const zip = ZipArchive.open(lying, { ...DEFAULT_ZIP_LIMITS, maxEntryBytes: 1000 });
    expect(() => zip.read("liar.bin")).toThrow();
  });
});
