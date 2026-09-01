import { useState } from "react";
import { arr, bool, obj, opt, str } from "@gridwright/schema";
import type { ColumnMeta } from "@gridwright/engine";
import { formatCompact, formatValue } from "./format.js";
import { foldSeries, seriesVar } from "./theme.js";
import {
  columnValues, firstDimension, firstMeasure, requireColumn,
  type PanelProps, type PanelSpec,
} from "./registry.js";

/**
 * Change over an ordered dimension.
 *
 * One y-axis, always. Two measures on different scales get two panels or an
 * indexed common base — a second axis makes any pair of lines cross wherever
 * the author's scaling chose, which is why it is the most misread chart there is.
 */
export interface LineProps {
  x: string;
  y: string[];
  area?: boolean;
  markers?: boolean;
}

const schema = obj({
  x: str({ minLength: 1 }),
  y: arr(str({ minLength: 1 }), { min: 1, max: 8 }),
  area: opt(bool()),
  markers: opt(bool()),
});

const PAD = { top: 14, right: 16, bottom: 26, left: 52 };

function Line({ result, props, size, locale }: PanelProps<LineProps>) {
  const [hover, setHover] = useState<number | null>(null);

  const x = requireColumn(result, props.x, "props.x");
  const requested = props.y.map((ref) => requireColumn(result, ref, "props.y[]"));
  // A ninth series is never a generated hue.
  const { kept: series, folded } = foldSeries(requested);

  const width = Math.max(160, size.width);
  const height = Math.max(120, size.height);
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const labels = columnValues(result, x);
  const columns = series.map((m) => ({
    meta: m,
    values: columnValues(result, m).map((v) =>
      typeof v === "number" && Number.isFinite(v) ? v : null,
    ),
  }));

  const n = result.rowCount;
  const all = columns.flatMap((c) => c.values).filter((v): v is number => v !== null);
  if (!n || !all.length) return <p className="gw-empty">No data to plot.</p>;

  const lo = Math.min(0, ...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const px = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const py = (v: number) => PAD.top + plotH - ((v - lo) / span) * plotH;

  const ticks = [lo, lo + span / 2, hi];
  // Direct labels while there are few enough series to place them without collision.
  const directLabel = series.length > 1 && series.length <= 4;
  const showMarkers = props.markers ?? n <= 24;

  return (
    <div className="gw-chart">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${series.map((s) => s.label).join(", ")} by ${x.label}`}
        className="gw-svg"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const rel = e.clientX - box.left - PAD.left;
          const i = n === 1 ? 0 : Math.round((rel / plotW) * (n - 1));
          setHover(i >= 0 && i < n ? i : null);
        }}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={width - PAD.right} y1={py(t)} y2={py(t)} className="gw-grid" />
            <text x={PAD.left - 8} y={py(t)} className="gw-axis" textAnchor="end" dominantBaseline="middle">
              {formatCompact(t, locale)}
            </text>
          </g>
        ))}

        {hover !== null && (
          <line x1={px(hover)} x2={px(hover)} y1={PAD.top} y2={PAD.top + plotH} className="gw-crosshair" />
        )}

        {columns.map((c, si) => {
          const points = c.values
            .map((v, i) => (v === null ? null : [px(i), py(v)] as const))
            .filter((p): p is readonly [number, number] => p !== null);
          if (!points.length) return null;
          const d = points.map(([cx, cy], i) => `${i ? "L" : "M"}${cx} ${cy}`).join(" ");
          const colour = seriesVar(si);
          return (
            <g key={c.meta.key}>
              {props.area && columns.length === 1 && (
                <path
                  d={`${d} L${points.at(-1)![0]} ${py(lo)} L${points[0]![0]} ${py(lo)} Z`}
                  fill={colour}
                  opacity={0.12}
                />
              )}
              <path d={d} fill="none" stroke={colour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {showMarkers &&
                points.map(([cx, cy], i) => (
                  <circle key={i} cx={cx} cy={cy} r={4} fill={colour} className="gw-marker" />
                ))}
              {hover !== null && c.values[hover] !== null && (
                <circle cx={px(hover)} cy={py(c.values[hover]!)} r={5} fill={colour} className="gw-marker gw-marker-on" />
              )}
              {directLabel && (
                <text
                  x={points.at(-1)![0] - 4}
                  y={points.at(-1)![1] - 8}
                  className="gw-series-label"
                  textAnchor="end"
                >
                  {c.meta.label}
                </text>
              )}
            </g>
          );
        })}

        <text x={PAD.left} y={height - 6} className="gw-axis" textAnchor="start">
          {String(labels[0] ?? "")}
        </text>
        {n > 1 && (
          <text x={width - PAD.right} y={height - 6} className="gw-axis" textAnchor="end">
            {String(labels[n - 1] ?? "")}
          </text>
        )}
      </svg>

      {/* Identity is never colour-alone: a legend whenever there are two or more series. */}
      {series.length > 1 && (
        <ul className="gw-legend">
          {series.map((m, i) => (
            <li key={m.key}>
              <span className="gw-swatch" style={{ background: seriesVar(i) }} aria-hidden="true" />
              {m.label}
            </li>
          ))}
          {folded.length > 0 && <li className="gw-legend-more">+{folded.length} more</li>}
        </ul>
      )}

      {hover !== null && (
        <div className="gw-tip" role="status">
          <strong>{String(labels[hover] ?? "—")}</strong>
          {columns.map((c) => (
            <span key={c.meta.key}>
              {c.meta.label}: {formatValue(c.values[hover] ?? null, c.meta.format, locale)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export const linePanel: PanelSpec<LineProps> = {
  type: "line",
  label: "Line chart",
  description: "Shows how one or more measures move across an ordered dimension.",
  schema,
  defaults: (result): LineProps => ({
    x: firstDimension(result)?.id ?? "",
    y: [firstMeasure(result)?.id ?? ""].filter(Boolean),
  }),
  Component: Line,
  minSize: { w: 4, h: 3 },
};

export type { ColumnMeta };
