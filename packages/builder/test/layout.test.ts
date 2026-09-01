import { describe, expect, it } from "vitest";
import type { PanelDef } from "@gridwright/schema";
import {
  cells, compact, dragTo, overlaps, pitchFromPanel, resizeTo, resolveCollisions,
  type Rect,
} from "@gridwright/builder";

const panel = (id: string, x: number, y: number, w: number, h: number): PanelDef => ({
  id, type: "kpi", dataset: "d", layout: { x, y, w, h }, props: {},
});

const at = (panels: readonly PanelDef[], id: string): Rect =>
  panels.find((p) => p.id === id)!.layout;

describe("grid geometry", () => {
  it("derives the cell pitch from a laid-out panel's own box", () => {
    // A panel 4 columns wide spans 4 columns and the 3 gaps between them, so
    // its width alone gives the pitch — no need to measure the container, whose
    // content width depends on padding and whether a scrollbar is showing.
    // 4 columns of 100 + 3 gaps of 12 = 436.
    const pitch = pitchFromPanel({ width: 436, height: 164 }, { x: 0, y: 0, w: 4, h: 2 }, 12);
    expect(pitch.columnPitch).toBe(112);          // 100 + 12
    expect(pitch.rowPitch).toBe(88);              // 76 + 12
  });

  it("reports no pitch for a panel that has not been laid out", () => {
    // The dangerous case is not w:0 — it is a real span measured at zero, inside
    // a collapsed container or before first paint. Taking the gap as the whole
    // width would give a pitch of 4px per cell, and a 400px drag would land 100
    // columns away.
    const pitch = pitchFromPanel({ width: 0, height: 0 }, { x: 0, y: 0, w: 3, h: 2 }, 12);
    expect(pitch.columnPitch).toBe(0);
    expect(pitch.rowPitch).toBe(0);
    expect(cells(400, pitch.columnPitch)).toBe(0);
  });

  it("treats a delta that is not a number as no movement", () => {
    // An event with no coordinates yields NaN, and NaN survives every
    // subsequent clamp — it would land in the manifest as `x: NaN`, which does
    // not validate and does not round-trip through YAML.
    expect(cells(NaN, 112)).toBe(0);
    expect(cells(Infinity, 112)).toBe(0);
  });

  it("rounds a pixel delta to the nearest whole cell", () => {
    expect(cells(0, 112)).toBe(0);
    expect(cells(55, 112)).toBe(0);              // less than half a cell: stay put
    expect(cells(57, 112)).toBe(1);
    expect(cells(-224, 112)).toBe(-2);
  });
});

describe("dragging", () => {
  it("moves by whole cells", () => {
    expect(dragTo({ x: 2, y: 3, w: 4, h: 2 }, 1, -1, 12)).toEqual({ x: 3, y: 2, w: 4, h: 2 });
  });

  it("cannot be dragged off either side of the grid", () => {
    const from = { x: 8, y: 0, w: 4, h: 2 };
    expect(dragTo(from, 5, 0, 12).x).toBe(8);     // right edge is column 12
    expect(dragTo({ ...from, x: 1 }, -5, 0, 12).x).toBe(0);
  });

  it("cannot be dragged above the first row", () => {
    expect(dragTo({ x: 0, y: 1, w: 4, h: 2 }, 0, -9, 12).y).toBe(0);
  });

  it("has no floor below it — the grid grows downwards", () => {
    expect(dragTo({ x: 0, y: 0, w: 4, h: 2 }, 0, 40, 12).y).toBe(40);
  });
});

describe("resizing", () => {
  const from = { x: 4, y: 4, w: 4, h: 4 };

  it("grows from the corner it is dragged by", () => {
    expect(resizeTo(from, "se", 2, 1, 12)).toEqual({ x: 4, y: 4, w: 6, h: 5 });
  });

  it("moves the origin when dragged from the top or left", () => {
    // The opposite edge stays put: dragging the west edge two columns left
    // widens the panel rather than sliding it.
    expect(resizeTo(from, "w", -2, 0, 12)).toEqual({ x: 2, y: 4, w: 6, h: 4 });
    expect(resizeTo(from, "n", 0, -2, 12)).toEqual({ x: 4, y: 2, w: 4, h: 6 });
  });

  it("never inverts when dragged past its opposite edge", () => {
    // Dragging the west edge far to the right must stop at the minimum, not
    // produce a negative width or flip the panel inside out.
    const r = resizeTo(from, "w", 99, 0, 12, { w: 2, h: 2 });
    expect(r.w).toBe(2);
    expect(r.x).toBe(6);                          // right edge (8) minus min width
    expect(r.x + r.w).toBe(from.x + from.w);      // the fixed edge did not move
  });

  it("honours the panel type's own minimum", () => {
    expect(resizeTo(from, "se", -99, -99, 12, { w: 2, h: 2 })).toEqual({ x: 4, y: 4, w: 2, h: 2 });
  });

  it("cannot be widened past the last column", () => {
    expect(resizeTo({ x: 8, y: 0, w: 4, h: 2 }, "e", 5, 0, 12).w).toBe(4);
  });

  it("resizes both axes from a corner", () => {
    expect(resizeTo(from, "nw", -1, -1, 12)).toEqual({ x: 3, y: 3, w: 5, h: 5 });
  });
});

describe("collisions", () => {
  it("knows when two rectangles share a cell", () => {
    expect(overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
    // Touching is not overlapping: a panel may sit flush against another.
    expect(overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 })).toBe(false);
    expect(overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 0, y: 2, w: 2, h: 2 })).toBe(false);
  });

  it("pushes what a dropped panel lands on out of the way", () => {
    const panels = [panel("a", 0, 0, 6, 2), panel("b", 0, 2, 6, 2)];
    const next = resolveCollisions(panels, "a", { x: 0, y: 2, w: 6, h: 2 });
    expect(at(next, "a")).toMatchObject({ x: 0, y: 2 });
    expect(at(next, "b")).toMatchObject({ x: 0, y: 4 });
  });

  it("cascades the push through everything below", () => {
    const panels = [
      panel("a", 0, 0, 12, 2), panel("b", 0, 2, 12, 2), panel("c", 0, 4, 12, 2),
    ];
    // Drop `a` onto `b`; `b` moves down onto `c`, which must move too.
    const next = resolveCollisions(panels, "a", { x: 0, y: 2, w: 12, h: 2 });
    const ys = ["a", "b", "c"].map((id) => at(next, id).y);
    expect(ys).toEqual([2, 4, 6]);
    // And nothing ends up sharing a cell.
    for (let i = 0; i < next.length; i++) {
      for (let j = i + 1; j < next.length; j++) {
        expect(overlaps(next[i]!.layout, next[j]!.layout)).toBe(false);
      }
    }
  });

  it("leaves a panel beside the drop alone", () => {
    const panels = [panel("a", 0, 0, 6, 2), panel("b", 6, 0, 6, 2), panel("c", 0, 2, 6, 2)];
    const next = resolveCollisions(panels, "c", { x: 0, y: 2, w: 6, h: 2 });
    expect(at(next, "b")).toMatchObject({ x: 6, y: 0 });
    expect(next.find((p) => p.id === "b")).toBe(panels[1]);   // same object: no churn
  });

  it("returns the panels untouched when the moved id is not there", () => {
    const panels = [panel("a", 0, 0, 6, 2)];
    expect(resolveCollisions(panels, "ghost", { x: 0, y: 9, w: 6, h: 2 })).toEqual(panels);
  });
});

describe("compaction", () => {
  it("pulls panels up into the hole a move leaves", () => {
    const panels = [panel("a", 0, 0, 12, 2), panel("b", 0, 6, 12, 2)];
    expect(at(compact(panels), "b").y).toBe(2);
  });

  it("stops at whatever is above, not at the top", () => {
    const panels = [panel("a", 0, 0, 6, 2), panel("b", 0, 8, 6, 2), panel("c", 6, 8, 6, 2)];
    const next = compact(panels);
    expect(at(next, "b").y).toBe(2);
    // `c` is in a different column, so nothing blocks it from the very top.
    expect(at(next, "c").y).toBe(0);
  });

  it("never moves a panel sideways", () => {
    const panels = [panel("a", 3, 4, 6, 2)];
    expect(at(compact(panels), "a")).toEqual({ x: 3, y: 0, w: 6, h: 2 });
  });

  it("is idempotent", () => {
    const panels = [panel("a", 0, 0, 6, 2), panel("b", 0, 5, 6, 2), panel("c", 6, 3, 6, 4)];
    const once = compact(panels);
    expect(compact(once)).toEqual(once);
  });

  it("keeps a settled layout as the very same objects", () => {
    const panels = [panel("a", 0, 0, 6, 2), panel("b", 0, 2, 6, 2)];
    const next = compact(panels);
    expect(next[0]).toBe(panels[0]);
    expect(next[1]).toBe(panels[1]);
  });
});
