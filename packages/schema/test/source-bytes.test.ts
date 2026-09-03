import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A literal control character in a source file makes git classify the whole
 * file as binary, and a binary file renders as "Binary files differ" in every
 * diff and review tool. That has now cost this project twice: a NUL in
 * `memory-source.ts`, and a NUL used as a Map key separator in `heatmap.tsx` —
 * which hid a 273-line new panel from the review of the branch that added it.
 *
 * The character itself is fine. Writing it literally is not: the escape
 * sequence is the same string at runtime and leaves the file reviewable.
 */
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const ALLOWED = new Set([0x09, 0x0a, 0x0d]); // tab, newline, carriage return

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(path);
  }
  return out;
}

describe("source files stay reviewable", () => {
  const files = [...sources(join(ROOT, "packages")), ...sources(join(ROOT, "apps"))];

  it("finds the source tree", () => {
    // Guards the guard: a walk that silently returns nothing would pass below.
    expect(files.length).toBeGreaterThan(20);
  });

  it("contains no literal control characters", () => {
    const offenders: string[] = [];
    for (const path of files) {
      const found = new Set<number>();
      for (const byte of readFileSync(path)) {
        if (byte < 0x20 && !ALLOWED.has(byte)) found.add(byte);
      }
      if (found.size > 0) {
        const codes = [...found].map((c) => `0x${c.toString(16).padStart(2, "0")}`).join(", ");
        offenders.push(`${path.slice(ROOT.length)} (${codes})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
