import { describe, expect, it } from "vitest";
import { MARKS, bandLayout, niceScale, notablePoints } from "../src/marks.js";

describe("bandLayout", () => {
  it("caps the mark so it never fills its band", () => {
    // The defect this exists to prevent: four categories in a tall panel gave
    // a band of ~140px and a bar of ~138px, which reads as a block of colour.
    const { thickness, band } = bandLayout(560, 4);
    expect(thickness).toBe(MARKS.maxBar);
    // The band is capped too, so the leftover becomes air around the group
    // rather than gaps inside it. 560/4 would be 140.
    expect(band).toBeCloseTo(MARKS.maxBar * 2.75);
  });

  it("centres the mark, so the leftover air is shared", () => {
    const { band, thickness, offset } = bandLayout(560, 4);
    expect(offset).toBeCloseTo((band - thickness) / 2);
    expect(offset * 2 + thickness).toBeCloseTo(band);
  });

  it("falls back to the band when it is tighter than the cap", () => {
    const { thickness } = bandLayout(100, 10); // band 10 → 8 after the gap
    expect(thickness).toBe(10 - MARKS.gap);
  });

  it("centres a short group instead of scattering it down a tall panel", () => {
    // Four bars in a panel sized for ten: the bands are far taller than the
    // marks, so the rhythm is capped and the group is centred rather than
    // spread as four separate stripes.
    const { band, origin, thickness } = bandLayout(600, 4);
    expect(band).toBeCloseTo(thickness * 2.75);
    expect(origin).toBeCloseTo((600 - band * 4) / 2);
    // Top air and bottom air match.
    const groupEnd = origin + band * 4;
    expect(600 - groupEnd).toBeCloseTo(origin);
  });

  it("does not shift the group when the bands already fill the panel", () => {
    expect(bandLayout(200, 8).origin).toBe(0);
  });

  it("stays positive on a collapsed or zero-count panel", () => {
    expect(bandLayout(0, 4).thickness).toBeGreaterThan(0);
    expect(bandLayout(300, 0).thickness).toBeGreaterThan(0);
    expect(Number.isFinite(bandLayout(300, 0).offset)).toBe(true);
  });
});

describe("niceScale", () => {
  it("rounds the axis to numbers a person would choose", () => {
    // 232,700 used to produce ticks of 232.7K and 116.3K — arithmetic, not a
    // scale. Nobody reads a chart in units of "half the largest bar".
    const { max, ticks } = niceScale(232_700);
    expect(max).toBe(250_000);
    expect(ticks).toEqual([0, 50_000, 100_000, 150_000, 200_000, 250_000]);
  });

  it("always covers the data", () => {
    for (const v of [1, 7, 99, 101, 1234, 98_765, 3.3, 0.04]) {
      expect(niceScale(v).max).toBeGreaterThanOrEqual(v);
    }
  });

  it("keeps every tick inside the domain and in order", () => {
    const { max, ticks } = niceScale(4321);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)).toBe(max);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
  });

  it("does not lose the top tick to floating-point drift", () => {
    // Repeated addition of 0.2 lands at 0.9999999999999999, which a naive
    // `t <= max` loop drops.
    expect(niceScale(1, 5).ticks.at(-1)).toBe(1);
  });

  it("survives degenerate input rather than looping forever", () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      const { ticks } = niceScale(bad);
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks.length).toBeLessThan(50);
    }
  });
});

describe("notablePoints", () => {
  it("marks the ends and the extremes, not every point", () => {
    const values = [5, 9, 2, 7, 6, 8];
    expect([...notablePoints(values)].sort((a, b) => a - b)).toEqual([0, 1, 2, 5]);
  });

  it("skips gaps when finding the ends", () => {
    const values = [NaN, 4, 9, NaN];
    const found = notablePoints(values);
    expect(found.has(0)).toBe(false);
    expect(found.has(3)).toBe(false);
    expect(found.has(1)).toBe(true);
    expect(found.has(2)).toBe(true);
  });

  it("returns nothing for a series with no usable values", () => {
    expect(notablePoints([NaN, NaN]).size).toBe(0);
    expect(notablePoints([]).size).toBe(0);
  });
});
