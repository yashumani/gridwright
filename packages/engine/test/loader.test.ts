import { describe, expect, it } from "vitest";
import {
  DelimitedParser, EngineError, loadBlob, loadBundleFromBlobs, loadDelimited,
  loadDelimitedStream, parseDelimited,
} from "@gridwright/engine";

/**
 * The incremental parser has to behave identically no matter where a chunk
 * boundary falls — including inside a `""` escape, between `\r` and `\n`, or
 * mid-way through a quoted field that spans lines. Rather than guess at the
 * awkward positions, most of this file re-parses the same content at every
 * possible chunk size and demands one answer.
 */

async function* chunked(text: string, size: number): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

const NASTY = [
  'id,name,note,qty',
  '1,"Smith, John","said ""hello"" twice",3',
  '2,"multi',
  'line value",plain,4',
  '3,,"trailing ""quote""",5',
  '4,"",empty,6',
].join("\r\n") + "\r\n";

describe("chunk boundaries never change the answer", () => {
  const whole = parseDelimited(NASTY);

  it("parses the awkward fixture correctly to begin with", () => {
    expect(whole).toHaveLength(5);
    expect(whole[1]).toEqual(["1", "Smith, John", 'said "hello" twice', "3"]);
    expect(whole[2]).toEqual(["2", "multi\nline value", "plain", "4"]);
    expect(whole[3]).toEqual(["3", "", 'trailing "quote"', "5"]);
    expect(whole[4]).toEqual(["4", "", "empty", "6"]);
  });

  it("collapses CRLF inside a quoted field but keeps a lone CR", () => {
    // A value must not group differently just because the file came from
    // Windows; a lone CR is real data and survives.
    expect(parseDelimited('a\n"x\r\ny"\n')[1]).toEqual(["x\ny"]);
    expect(parseDelimited('a\n"x\ry"\n')[1]).toEqual(["x\ry"]);
  });

  it("gives the same rows at every chunk size from 1 upward", async () => {
    for (let size = 1; size <= NASTY.length; size++) {
      const rows: string[][] = [];
      const parser = new DelimitedParser(",");
      const sink = (r: string[]) => rows.push(r);
      for await (const chunk of chunked(NASTY, size)) parser.push(chunk, sink);
      parser.end(sink);
      expect(rows, `chunk size ${size}`).toEqual(whole);
    }
  });

  it("streams into a table identically to a whole-string load", async () => {
    const direct = loadDelimited("t", NASTY, { types: { qty: "number" } });
    for (const size of [1, 2, 3, 7, 13, 64, 4096]) {
      const streamed = await loadDelimitedStream("t", chunked(NASTY, size), {
        types: { qty: "number" },
      });
      expect(streamed, `chunk size ${size}`).toEqual(direct);
    }
  });
});

describe("parser edge cases", () => {
  it("strips a BOM even when it arrives in its own chunk", async () => {
    const text = "﻿id,name\n1,x\n";
    const t = await loadDelimitedStream("t", chunked(text, 1));
    expect(Object.keys(t.columns)).toEqual(["id", "name"]);
  });

  it("handles a file with no trailing newline", () => {
    expect(parseDelimited("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("ignores a blank trailing line", () => {
    expect(parseDelimited("a,b\n1,2\n\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps a genuinely empty field distinct from a missing one", () => {
    const rows = parseDelimited("a,b,c\n1,,3\n");
    expect(rows[1]).toEqual(["1", "", "3"]);
  });

  it("reports an unterminated quote with a line number", () => {
    expect(() => parseDelimited('a\n"oops\n')).toThrow(/unterminated quoted field/);
  });

  it("reports an unterminated quote from the streaming path too", async () => {
    await expect(loadDelimitedStream("t", chunked('a\n"oops\n', 3)))
      .rejects.toThrow(/unterminated quoted field/);
  });

  it("accepts a quoted field that ends exactly at the end of input", () => {
    expect(parseDelimited('a\n"done"')).toEqual([["a"], ["done"]]);
  });

  it("supports a tab delimiter", () => {
    expect(parseDelimited("a\tb\n1\t2\n", "\t")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("row ceiling", () => {
  const text = "a\n" + Array.from({ length: 50 }, (_, i) => i).join("\n") + "\n";

  it("refuses a file over the limit rather than exhausting memory", () => {
    expect(() => loadDelimited("t", text, { maxRows: 10 })).toThrow(/more than 10 rows/);
  });

  it("suggests what to do about it", () => {
    try {
      loadDelimited("t", text, { maxRows: 10 });
      expect.unreachable("should have refused");
    } catch (err) {
      expect((err as EngineError).detail).toMatch(/pre-aggregate/);
    }
  });

  it("allows a file exactly at the limit", () => {
    expect(loadDelimited("t", text, { maxRows: 50 }).rowCount).toBe(50);
  });
});

describe("blob loading", () => {
  it("streams a Blob without reading it as one string", async () => {
    const blob = new Blob([NASTY], { type: "text/csv" });
    const t = await loadBlob("t", blob, { types: { qty: "number" } });
    expect(t.rowCount).toBe(4);
    expect(t.columns["qty"]).toEqual([3, 4, 5, 6]);
  });

  it("loads a whole bundle from blobs", async () => {
    const manifest = [
      "gridwright: 1",
      "source:",
      "  kind: file",
      "  files: [{ id: t, path: ./t.csv }]",
      "model:",
      "  fields:",
      "    - { name: name, type: string, from: t.name }",
      "    - { name: qty,  type: number, from: t.qty }",
      "  dimensions: [{ id: name, field: name }]",
      "  measures: [{ id: total, expr: \"sum(qty)\" }]",
      "datasets: { by_name: { dimensions: [name], measures: [total] } }",
      "panels: []",
    ].join("\n");

    const r = await loadBundleFromBlobs(manifest, [
      { name: "t.csv", blob: new Blob([NASTY]) },
    ]);
    expect(r.ok, r.ok ? "" : JSON.stringify(r.issues)).toBe(true);
    if (!r.ok) return;
    const result = await r.engine.query("by_name");
    expect((result.data["m_total"] as number[]).reduce((a, b) => a + b, 0)).toBe(18);
  });

  it("reports a row-ceiling breach as an issue rather than throwing", async () => {
    const manifest = [
      "gridwright: 1",
      "source: { kind: file, files: [{ id: t, path: ./t.csv }] }",
      "model:",
      "  fields: [{ name: qty, type: number, from: t.qty }]",
      "  dimensions: []",
      "  measures: [{ id: total, expr: \"sum(qty)\" }]",
      "datasets: { totals: { measures: [total] } }",
      "panels: []",
    ].join("\n");
    const csv = "qty\n" + Array.from({ length: 20 }, (_, i) => i).join("\n") + "\n";

    const r = await loadBundleFromBlobs(manifest, [{ name: "t.csv", blob: new Blob([csv]) }], {
      maxRows: 5,
    });
    expect(r.ok).toBe(false);
    expect(r.ok || r.issues[0]!.message).toMatch(/more than 5 rows/);
  });
});

describe("streaming at size", () => {
  it("loads a million rows without holding the source text whole", async () => {
    const rows = 1_000_000;
    // Yields chunks lazily, so the full CSV never exists as one string —
    // the property that matters for a gigabyte upload.
    async function* generate(): AsyncGenerator<string> {
      yield "region,amount\n";
      const regions = ["North", "South", "East", "West", "Central"];
      let buffer = "";
      for (let i = 0; i < rows; i++) {
        buffer += `${regions[i % 5]},${(i % 977) + 1}\n`;
        if (buffer.length > 1 << 16) { yield buffer; buffer = ""; }
      }
      if (buffer) yield buffer;
    }

    const started = Date.now();
    const t = await loadDelimitedStream("t", generate(), { types: { amount: "number" } });
    const ms = Date.now() - started;

    expect(t.rowCount).toBe(rows);
    const total = (t.columns["amount"] as number[]).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    console.log(`      streamed ${rows / 1e6}M rows in ${ms}ms`);
  }, 120_000);
});
