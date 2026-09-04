import { useCallback, useRef, useState } from "react";
import type { Manifest, PanelDef } from "@gridwright/schema";
import {
  cells, dragTo, gridColumns, gridGap, pitchFromPanel, resizeTo,
  type Edge, type Pitch, type Rect,
} from "./layout.js";

/**
 * Direct manipulation of the grid.
 *
 * Typing four numbers to move a box is the kind of interface people only accept
 * when they wrote the format themselves. Everything here exists so that the
 * layout can be changed the way people expect to change a layout — by dragging
 * the thing.
 *
 * Two rules shape the implementation:
 *
 * Nothing commits until the pointer comes up. A drag that dispatched on every
 * move would fill the undo stack with a hundred entries for one gesture, and
 * would re-render the dashboard — which owns live query results — sixty times a
 * second. The gesture lives in local state and produces exactly one action.
 *
 * The panel keeps rendering its real content underneath. What moves during the
 * gesture is a ghost; the panel itself jumps once, at the end. Dragging a live
 * chart around at 60fps looks impressive and reads worse — the thing under the
 * cursor stops being a stable reference for where you started.
 */

/** A gesture in progress. Null when the pointer is not down. */
export interface Gesture {
  id: string;
  kind: "move" | "resize";
  edge?: Edge;
  /** Where the panel started, in grid cells. */
  from: Rect;
  /** Where it would land if the pointer came up now. */
  to: Rect;
}

interface Origin {
  pointerX: number;
  pointerY: number;
  pitch: Pitch;
}

export interface DragHandlers {
  gesture: Gesture | null;
  /** Attach to a grip: begins a move. */
  startMove: (e: React.PointerEvent, panel: PanelDef) => void;
  /** Attach to a resize handle: begins a resize on that edge. */
  startResize: (e: React.PointerEvent, panel: PanelDef, edge: Edge) => void;
  /**
   * Spread onto whichever element started the gesture. The pointer is captured
   * there, so that element — not the window — receives the rest of the gesture,
   * which is what lets a drag continue over the panel next door.
   */
  wire: {
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
}

export interface UseDragOptions {
  manifest: Manifest;
  /** Smallest footprint the panel's own type will accept. */
  minSize: (panel: PanelDef) => { w: number; h: number };
  /** Called once, when the gesture ends somewhere different from where it began. */
  onCommit: (id: string, to: Rect, kind: "move" | "resize") => void;
  /** Called on pointer-down, before any movement, so a click also selects. */
  onSelect?: (id: string) => void;
}

export function useDrag({ manifest, minSize, onCommit, onSelect }: UseDragOptions): DragHandlers {
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const origin = useRef<Origin | null>(null);
  // The gesture is read inside pointer handlers that are attached once per
  // gesture; a ref keeps them reading the live value rather than the value
  // captured when the gesture began.
  const live = useRef<Gesture | null>(null);
  const set = (g: Gesture | null) => { live.current = g; setGesture(g); };

  const begin = useCallback(
    (e: React.PointerEvent, panel: PanelDef, kind: "move" | "resize", edge?: Edge) => {
      // Ignore the non-primary buttons: a right-click on a panel is a context
      // menu everywhere else on the machine and should stay one here. Written as
      // "greater than zero" rather than "not zero" so an event that carries no
      // button at all still drags — touch and pen contacts are the ones most
      // likely to arrive that way, and they are the ones that need this most.
      if (e.button > 0) return;
      const box = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-panel]");
      if (!box) return;

      e.preventDefault();
      e.stopPropagation();
      // Capture keeps the gesture on this element once the cursor leaves it,
      // which is most of a drag. It throws if the pointer is no longer active —
      // and a capture that could not be taken is a degraded drag, not a failed
      // one, so it must not abort the gesture.
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch { /* the gesture still works while the cursor stays put */ }
      onSelect?.(panel.id);

      const rect = box.getBoundingClientRect();
      origin.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        pitch: pitchFromPanel(rect, panel.layout, gridGap(manifest)),
      };
      const from: Rect = { ...panel.layout };
      set({ id: panel.id, kind, from, to: from, ...(edge ? { edge } : {}) });
    },
    [manifest, onSelect],
  );

  const move = useCallback(
    (e: React.PointerEvent) => {
      const g = live.current;
      const o = origin.current;
      if (!g || !o) return;
      const dx = cells(e.clientX - o.pointerX, o.pitch.columnPitch);
      const dy = cells(e.clientY - o.pointerY, o.pitch.rowPitch);
      const columns = gridColumns(manifest);
      const panel = manifest.panels.find((p) => p.id === g.id);

      const to =
        g.kind === "move"
          ? dragTo(g.from, dx, dy, columns)
          : resizeTo(g.from, g.edge ?? "se", dx, dy, columns, panel ? minSize(panel) : { w: 1, h: 1 });

      if (to.x !== g.to.x || to.y !== g.to.y || to.w !== g.to.w || to.h !== g.to.h) {
        set({ ...g, to });
      }
    },
    [manifest, minSize],
  );

  const end = useCallback(() => {
    const g = live.current;
    set(null);
    origin.current = null;
    if (!g) return;
    const moved =
      g.to.x !== g.from.x || g.to.y !== g.from.y || g.to.w !== g.from.w || g.to.h !== g.from.h;
    if (moved) onCommit(g.id, g.to, g.kind);
  }, [onCommit]);

  const wire = {
    onPointerMove: move,
    onPointerUp: end,
    // A cancelled pointer (the OS took it, the window lost focus) is a dropped
    // gesture, not a drop: end without committing would lose the move, so it
    // commits the same as a release. Whatever the user last saw is what they get.
    onPointerCancel: end,
  };

  return {
    gesture,
    startMove: (e, panel) => begin(e, panel, "move"),
    startResize: (e, panel, edge) => begin(e, panel, "resize", edge),
    wire,
  };
}

/** The eight resize handles, and where each sits on the panel. */
const EDGES: readonly Edge[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export interface PanelChromeProps {
  panel: PanelDef;
  selected: boolean;
  drag: DragHandlers;
  /** What to call the panel out loud, for anyone who cannot see the grip. */
  label: string;
}

/**
 * The drag chrome for one panel: a grip along the top and eight resize handles.
 *
 * It is `pointer-events: none` except on the handles themselves, so clicking a
 * bar still cross-filters the dashboard. Editing a live dashboard is the point
 * of the preview, and chrome that swallowed every click would take that away.
 */
export function PanelChrome({ panel, selected, drag, label }: PanelChromeProps) {
  const active = drag.gesture?.id === panel.id;

  return (
    <div className={`gwb-chrome${selected ? " gwb-on" : ""}${active ? " gwb-dragging" : ""}`}>
      <button
        type="button"
        className="gwb-grip"
        aria-label={`Move ${label}`}
        onPointerDown={(e) => drag.startMove(e, panel)}
        {...drag.wire}
      >
        <span aria-hidden="true" className="gwb-grip-dots" />
      </button>
      {EDGES.map((edge) => (
        <button
          key={edge}
          type="button"
          className={`gwb-handle gwb-handle-${edge}`}
          aria-label={`Resize ${label} from the ${EDGE_NAMES[edge]}`}
          tabIndex={-1}
          onPointerDown={(e) => drag.startResize(e, panel, edge)}
          {...drag.wire}
        />
      ))}
    </div>
  );
}

const EDGE_NAMES: Record<Edge, string> = {
  n: "top", s: "bottom", e: "right", w: "left",
  ne: "top right", nw: "top left", se: "bottom right", sw: "bottom left",
};

/** The outline showing where a gesture would land. */
export function DropGhost({ gesture }: { gesture: Gesture | null }) {
  if (!gesture) return null;
  const { to } = gesture;
  return (
    <div
      className="gwb-ghost"
      aria-hidden="true"
      style={{
        gridColumn: `${to.x + 1} / span ${to.w}`,
        gridRow: `${to.y + 1} / span ${to.h}`,
      }}
    >
      <span>{to.w} × {to.h}</span>
    </div>
  );
}
