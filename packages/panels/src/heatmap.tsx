import { useState } from "react";
import { bool, described, num, obj, opt, str } from "@gridwright/schema";
import type { Value } from "@gridwright/engine";
import { formatValue } from "./format.js";
import { resultRow } from "./rules.js";
import { rampInkVar, rampVar } from "./theme.js";
import {
  columnValues, firstMeasure, isSelected, requireColumn,
  type PanelProps, type PanelSpec,
} from "./registry.js";

/**
 * One measure across two dimensions.
 *
 * Nothing else here shows two dimensions at once. A grouped bar chart can, up
 * to about four groups, and past that it becomes a picket fence; a heatmap
 * keeps reading at twenty by twenty because position does the work of telling
 * cells apart and colour only has to carry magnitude.
 *
 * Colour is **sequential** — one hue, light to dark — which is the whole reason
 * this form is safe. A rainbow scale invents an order the eye does not agree
 * on, and categorical hues here would say "these cells are different kinds of
 * thing" when they differ only in size. One hue means more-is-darker, and that
 * needs no legend to learn.
 *
 * Every cell carries its number as well as its shade wherever the cell is big
 * enough to hold it. Colour alone is not a value: a reader who cannot separate
 * two steps of a ramp — and at the light end most people cannot — has nothing
 * to fall back on otherwise.
 */
export interface HeatmapProps {
  /** Dimension across the top. */
  x: string;
  /** Dimension down the side. */
  y: string;
  /** The number the shade encodes. */
  value: string;
  /** Print the number in each cell. On where the cells are big enough. */
  showValues?: boolean;
  maxColumns?: number;
  maxRows?: number;
}

const schema = obj({
  x: described(str({ minLength: 1 }), { title: "Across the top" }),
  y: described(str({ minLength: 1 }), { title: "Down the side" }),
  value: described(str({ minLength: 1 }), { title: "Number to shade by" }),
  showValues: described(opt(bool()), { title: "Show the numbers" }),
  maxColumns: described(opt(num({ integer: true, min: 1, max: 60 })), { title: "Most columns" }),
  maxRows: described(opt(num({ integer: true, min: 1, max: 60 })), { title: "Most rows" }),
});

const FONT = 11;
const GAP = 2;

/**
 * A key that keeps a value's type. `String(v)` turns both `null` and the text
 * "null" into "null", so a dimension holding both loses one category from the
 * axis and lets the two overwrite each other in the cell map.
 */
export function cellKey(v: Value): string {
  return v === undefined ? "undefined" : JSON.stringify(v);
}

/** Distinct values in first-seen order — the order the query already sorted. */
function axisOf(values: readonly Value[], cap: number): Value[] {
  const seen = new Set<string>();
  const out: Value[] = [];
  for (const v of values) {
    const key = cellKey(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

function Heatmap({ result, props, size, select, selected, locale }: PanelProps<HeatmapProps>) {
  const [hover, setHover] = useState<number | null>(null);

  const xCol = requireColumn(result, props.x, "props.x");
  const yCol = requireColumn(result, props.y, "props.y");
  const measure = requireColumn(result, props.value, "props.value");

  const xs = columnValues(result, xCol);
  const ys = columnValues(result, yCol);
  const vs = columnValues(result, measure);

  const columns = axisOf(xs, props.maxColumns ?? 32);
  const rows = axisOf(ys, props.maxRows ?? 32);

  // One pass to index the result by cell. A query returns one row per
  // combination that exists, so a missing combination is a real absence and is
  // drawn as an empty cell rather than as zero — those mean different things
  // and a heatmap that conflates them lies about coverage.
  const cell = new Map<string, { value: number; row: number }>();
  for (let i = 0; i < result.rowCount; i++) {
    const v = vs[i];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    cell.set(`${cellKey(xs[i]!)}\u0000${cellKey(ys[i]!)}`, { value: v, row: i });
  }

  // The ramp spans what the data spans, not zero to the maximum.
  //
  // Anchoring to zero is right for a bar, whose length is read as a magnitude,
  // and wrong here: a grid of values between 183k and 261k compressed into the
  // top third of the ramp is one flat block, and the structure the heatmap
  // exists to show disappears. The scale below the grid states both ends, so
  // the range is declared rather than implied.
  const present = [...cell.values()].map((c) => c.value);
  const max = present.length ? Math.max(...present) : 0;
  const min = present.length ? Math.min(...present) : 0;

  const width = Math.max(160, size.width);
  const height = Math.max(120, size.height);

  if (!columns.length || !rows.length || present.length === 0) {
    return <p className="gw-empty">No data to plot.</p>;
  }

  const widestRowLabel = Math.max(0, ...rows.map((r) => String(r ?? "—").length * FONT * 0.56));
  const LABEL_GUTTER = Math.min(Math.ceil(widestRowLabel) + 10, Math.round(width * 0.3));
  const AXIS_H = 20;
  // The scale strip lives below the grid and is part of the chart, so the
  // height it needs comes out of the plot rather than out of the panel — a
  // container sized to the plot alone pushes its own axis out of view.
  const SCALE_H = 24;

  const plotW = Math.max(20, width - LABEL_GUTTER);
  const svgH = Math.max(40, height - SCALE_H);
  const plotH = Math.max(20, svgH - AXIS_H);
  const cw = plotW / columns.length;
  const ch = plotH / rows.length;

  // A number needs room. Below that, the shade carries it and the hover reads
  // it out — better an unlabelled cell than a label clipped to "1,2…".
  const roomForValues = cw >= 44 && ch >= 22;
  const showValues = (props.showValues ?? true) && roomForValues;

  const fraction = (v: number): number => {
    const span = max - min;
    return span > 0 ? (v - min) / span : 1;
  };

  const shade = (v: number): string => {
    // Normalised against the range the data actually spans, so a heatmap of
    // values between 900 and 1000 still shows its structure instead of reading
    // as one flat block.
    return rampVar(fraction(v));
  };

  const tip = hover !== null ? {
    x: String(xs[hover] ?? "—"),
    y: String(ys[hover] ?? "—"),
    value: formatValue(vs[hover] ?? null, measure.format, locale),
  } : null;

  return (
    <div className="gw-chart">
      <svg
        width={width}
        height={svgH}
        role="img"
        aria-label={`${measure.label} by ${xCol.label} and ${yCol.label}`}
        className="gw-svg"
      >
        {rows.map((rowValue, r) =>
          columns.map((colValue, c) => {
            const hit = cell.get(`${cellKey(colValue)}\u0000${cellKey(rowValue)}`);
            const x = LABEL_GUTTER + c * cw;
            const y = r * ch;
            const on = hit !== undefined &&
              (isSelected(selected, xCol.id, colValue) || isSelected(selected, yCol.id, rowValue));
            const anySelected =
              (selected[xCol.id] ?? []).length > 0 || (selected[yCol.id] ?? []).length > 0;

            if (!hit) {
              return (
                <rect
                  key={`${r}-${c}`}
                  x={x + GAP / 2} y={y + GAP / 2}
                  width={Math.max(0.5, cw - GAP)} height={Math.max(0.5, ch - GAP)}
                  className="gw-cell-empty"
                />
              );
            }

            return (
              <g
                key={`${r}-${c}`}
                className={`gw-cell${on ? " gw-on" : ""}${anySelected && !on ? " gw-dim" : ""}`}
                onMouseEnter={() => setHover(hit.row)}
                onMouseLeave={() => setHover(null)}
                onClick={() => select(xCol.id, colValue, resultRow(result, hit.row))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select(xCol.id, colValue, resultRow(result, hit.row));
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={
                  `${String(colValue ?? "—")}, ${String(rowValue ?? "—")}: ` +
                  formatValue(hit.value, measure.format, locale)
                }
              >
                <rect
                  x={x + GAP / 2} y={y + GAP / 2}
                  width={Math.max(0.5, cw - GAP)} height={Math.max(0.5, ch - GAP)}
                  fill={shade(hit.value)}
                  className="gw-cell-fill"
                />
                {showValues && (
                  <text
                    x={x + cw / 2}
                    y={y + ch / 2}
                    className="gw-cell-value"
                    fill={rampInkVar(fraction(hit.value))}
                    textAnchor="middle"
                  >
                    {formatValue(hit.value, measure.format, locale)}
                  </text>
                )}
              </g>
            );
          }),
        )}

        {rows.map((r, i) => (
          <text
            key={`r${i}`}
            x={LABEL_GUTTER - 7}
            y={i * ch + ch / 2}
            className="gw-bar-label"
            textAnchor="end"
          >
            {truncate(String(r ?? "—"), Math.floor((LABEL_GUTTER - 10) / (FONT * 0.56)))}
          </text>
        ))}

        {columns.map((c, i) => (
          <text
            key={`c${i}`}
            x={LABEL_GUTTER + i * cw + cw / 2}
            y={plotH + 14}
            className="gw-bar-label"
            textAnchor="middle"
          >
            {truncate(String(c ?? "—"), Math.floor(cw / (FONT * 0.56)))}
          </text>
        ))}
      </svg>

      {/* One hue, light to dark. The scale is shown rather than explained. */}
      <div className="gw-scale" aria-hidden="true">
        <span>{formatValue(min, measure.format, locale)}</span>
        <span className="gw-scale-ramp" />
        <span>{formatValue(max, measure.format, locale)}</span>
      </div>

      {tip && (
        <div className="gw-tip" role="status">
          <strong>{tip.x} · {tip.y}</strong>
          <span>{measure.label}: {tip.value}</span>
        </div>
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (max < 3 || s.length <= max) return s;
  return `${s.slice(0, Math.max(1, max - 1))}…`;
}

export const heatmapPanel: PanelSpec<HeatmapProps> = {
  type: "heatmap",
  label: "Heatmap",
  description: "One number across two dimensions, shaded light to dark.",
  schema,
  defaults: (result) => {
    const dims = result.columns.filter((c) => c.kind === "dimension");
    return {
      x: dims[0]?.id ?? "",
      y: dims[1]?.id ?? dims[0]?.id ?? "",
      value: firstMeasure(result)?.id ?? "",
    };
  },
  primary: ["x", "y", "value"],
  Component: Heatmap,
  minSize: { w: 4, h: 4 },
};
