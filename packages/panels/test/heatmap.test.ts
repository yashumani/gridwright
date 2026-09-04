import { describe, expect, it } from "vitest";
import { cellKey } from "../src/heatmap.js";

/**
 * The axis and the cell map are both keyed by these strings. Keying by
 * `String(v)` collapsed values that are genuinely different: a dimension
 * holding both a blank and the literal text "null" lost one category off the
 * axis, and the two rows then overwrote each other in the map, so a value could
 * be drawn under the wrong heading.
 */
describe("cellKey", () => {
  it("keeps a blank distinct from the text that spells it", () => {
    // The collision the old key had, stated outright.
    expect(String(null)).toBe(String("null"));
    expect(cellKey(null)).not.toBe(cellKey("null"));
  });

  it("keeps a number distinct from its own digits", () => {
    expect(String(1)).toBe(String("1"));
    expect(cellKey(1)).not.toBe(cellKey("1"));
  });

  it("keeps a boolean distinct from its own spelling", () => {
    expect(cellKey(true)).not.toBe(cellKey("true"));
  });

  it("is stable for equal values, or the map would never hit", () => {
    expect(cellKey("North")).toBe(cellKey("North"));
    expect(cellKey(null)).toBe(cellKey(null));
    expect(cellKey(42)).toBe(cellKey(42));
  });

  it("returns a string for every value a column can hold", () => {
    for (const v of [null, "", "North", 0, -1.5, true, false]) {
      expect(typeof cellKey(v)).toBe("string");
    }
  });
});
