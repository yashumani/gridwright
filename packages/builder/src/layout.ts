import type { Manifest, PanelDef } from "@gridwright/schema";

/**
 * Grid arithmetic for direct manipulation.
 *
 * Kept apart from the React that calls it because every interesting question
 * here — where does this land, what does it displace, does the result still fit
 * the grid — is arithmetic, and arithmetic is worth testing without a browser
 * in the way.
 *
 * The model is the one the manifest already describes: a fixed column count,
 * rows that grow downwards forever, and a panel that occupies a rectangle of
 * cells. Two panels may not share a cell, so a drop that would overlap pushes
 * the panels underneath it down rather than refusing the drop — refusing feels
 * broken, and a drop that silently overlaps looks broken.
 */

export interface Rect { x: number; y: number; w: number; h: number }

export const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Grid geometry, in pixels. Everything a pointer delta needs to become cells. */
export interface Pitch {
  /** Width of one column plus the gap that follows it. */
  columnPitch: number;
  /** Height of one row plus the gap that follows it. */
  rowPitch: number;
}

/**
 * The cell pitch, derived from the box of a panel that is already laid out.
 *
 * The alternative is to measure the grid container and divide, which needs the
 * container's exact content width — padding, scrollbar and all. A panel that is
 * `w` columns wide spans `w` columns and the `w - 1` gaps between them, so its
 * own rect gives the pitch exactly, and it is the element the pointer is
 * already over.
 */
export function pitchFromPanel(rect: { width: number; height: number }, layout: Rect, gap: number): Pitch {
  // A box with no size has not been laid out — inside a collapsed container, or
  // before first paint. Deriving a pitch from the gap alone would give a few
  // pixels per cell, and the first small drag would fling the panel across the
  // grid. No measurement means no pitch, and no pitch means no movement.
  const measurable = rect.width > 0 && rect.height > 0;
  return {
    columnPitch: measurable && layout.w > 0 ? (rect.width + gap) / layout.w : 0,
    rowPitch: measurable && layout.h > 0 ? (rect.height + gap) / layout.h : 0,
  };
}

export const gridColumns = (manifest: Manifest): number => manifest.grid?.columns ?? 12;
export const gridGap = (manifest: Manifest): number => manifest.grid?.gap ?? 12;

/**
 * Rounds a pixel delta to whole cells.
 *
 * A pitch of 0 means "not measurable yet". A delta that is not a finite number
 * means the event carried no coordinates — and NaN propagates: it would reach
 * the manifest as `x: NaN`, which no longer validates and does not survive a
 * round trip through YAML. Both cases are "the pointer has not told us anything
 * yet", and both answer zero.
 */
export const cells = (delta: number, pitch: number): number =>
  pitch > 0 && Number.isFinite(delta) ? Math.round(delta / pitch) : 0;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Where a drag starting from `from` lands, clamped to the grid. */
export function dragTo(from: Rect, dx: number, dy: number, columns: number): Rect {
  return {
    ...from,
    x: clamp(from.x + dx, 0, Math.max(0, columns - from.w)),
    y: Math.max(0, from.y + dy),
  };
}

/** Which sides a resize handle drags. */
export type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * Where a resize from `from` lands.
 *
 * A north or west drag moves the origin as well as the size, and both are
 * clamped so the panel never inverts, never leaves the grid, and never shrinks
 * below the minimum its own panel type declares.
 */
export function resizeTo(
  from: Rect,
  edge: Edge,
  dx: number,
  dy: number,
  columns: number,
  min: { w: number; h: number } = { w: 1, h: 1 },
): Rect {
  const minW = Math.max(1, min.w);
  const minH = Math.max(1, min.h);
  let { x, y, w, h } = from;

  if (edge.includes("e")) w = clamp(from.w + dx, minW, columns - from.x);
  if (edge.includes("w")) {
    // The right edge is fixed, so the left one can travel no further right than
    // the minimum width allows, and no further left than column zero.
    const right = from.x + from.w;
    x = clamp(from.x + dx, 0, right - minW);
    w = right - x;
  }
  if (edge.includes("s")) h = Math.max(minH, from.h + dy);
  if (edge.includes("n")) {
    const bottom = from.y + from.h;
    y = clamp(from.y + dy, 0, bottom - minH);
    h = bottom - y;
  }
  return { x, y, w, h };
}

/**
 * Applies `moved` to `panels` and pushes whatever it lands on out of the way.
 *
 * The panel being dragged wins its cells outright; everything else keeps its
 * order and slides down until it fits. Reading top-to-bottom means a panel is
 * only ever pushed by something already placed above it, so one pass settles.
 */
export function resolveCollisions(
  panels: readonly PanelDef[],
  movedId: string,
  to: Rect,
): PanelDef[] {
  const moved = panels.find((p) => p.id === movedId);
  if (!moved) return [...panels];

  const placed: { id: string; rect: Rect }[] = [{ id: movedId, rect: to }];
  const rest = panels
    .filter((p) => p.id !== movedId)
    .map((p) => ({ id: p.id, rect: { ...p.layout } }))
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);

  for (const item of rest) {
    const rect = { ...item.rect };
    // Push straight down past every obstruction. Jumping to the bottom of the
    // blocker rather than stepping a row at a time terminates in one pass per
    // blocker instead of one per row.
    for (;;) {
      const hit = placed.find((p) => overlaps(p.rect, rect));
      if (!hit) break;
      rect.y = hit.rect.y + hit.rect.h;
    }
    placed.push({ id: item.id, rect });
  }

  const byId = new Map(placed.map((p) => [p.id, p.rect]));
  return panels.map((p) => {
    const rect = byId.get(p.id);
    if (!rect) return p;
    const same =
      rect.x === p.layout.x && rect.y === p.layout.y &&
      rect.w === p.layout.w && rect.h === p.layout.h;
    return same ? p : { ...p, layout: { ...p.layout, ...rect } };
  });
}

/**
 * Pulls every panel up into the space above it.
 *
 * Dragging leaves holes — a panel moved out of the middle of a column takes its
 * row with it — and a dashboard slowly grows blank bands nobody asked for. Run
 * after a move settles, never on load: a hand-authored manifest that deliberately
 * spaces its sections is not ours to rearrange.
 */
export function compact(panels: readonly PanelDef[]): PanelDef[] {
  const order = panels
    .map((p, i) => ({ i, rect: { ...p.layout } }))
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);

  const placed: Rect[] = [];
  const settled = new Map<number, Rect>();
  for (const item of order) {
    const rect = { ...item.rect };
    while (rect.y > 0 && !placed.some((r) => overlaps(r, { ...rect, y: rect.y - 1 }))) rect.y -= 1;
    placed.push(rect);
    settled.set(item.i, rect);
  }

  return panels.map((p, i) => {
    const rect = settled.get(i)!;
    return rect.y === p.layout.y ? p : { ...p, layout: { ...p.layout, y: rect.y } };
  });
}
