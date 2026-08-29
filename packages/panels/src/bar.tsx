import { useState } from "react";
import { bool, enum_, num, obj, opt, str } from "@gridwright/schema";
import type { Value } from "@gridwright/engine";
import { formatValue } from "./format.js";
import {
  columnValues, firstDimension, firstMeasure, isSelected, requireColumn,
  type PanelProps, type PanelSpec,
} from "./registry.js";

/**
 * Magnitude by category. Horizontal by default because category labels are
 * words: rotating them to fit under vertical bars is the usual reason a bar
 * chart becomes unreadable.
 */
export interface BarProps {
  category: string;
  value: string;
  orientation?: "horizontal" | "vertical";
  /** Direct value labels. On by default — they carry the relief rule. */
  showValues?: boolean;
  maxBars?: number;
}

const schema = obj({
  category: str({ minLength: 1 }),
  value: str({ minLength: 1 }),
  orientation: opt(enum_(["horizontal", "vertical"] as const)),
  showValues: opt(bool()),
  maxBars: opt(num({ integer: true, min: 1, max: 200 })),
});

/**
 * Approximate rendered width of a label. There is no way to measure text
 * without a DOM round-trip, and a constant gutter clips the moment a value
 * grows a digit — so the gutters are sized from the widest label that will
 * actually be drawn, using per-glyph averages for the two type styles in use.
 */
function estimateWidth(text: string, fontSize: number, bold: boolean): number {
  return text.length * fontSize * (bold ? 0.62 : 0.56);
}

/** A rect with only the data-end rounded, so the baseline stays square. */
function barPath(x: number, y: number, w: number, h: number, r: number, horizontal: boolean): string {
  const radius = Math.max(0, Math.min(r, horizontal ? w : h));
  if (radius <= 0.5) return `M${x} ${y}h${w}v${h}h${-w}z`;
  return horizontal
    ? `M${x} ${y}h${w - radius}a${radius} ${radius} 0 0 1 ${radius} ${radius}v${h - 2 * radius}` +
      `a${radius} ${radius} 0 0 1 ${-radius} ${radius}h${-(w - radius)}z`
    : `M${x} ${y + radius}a${radius} ${radius} 0 0 1 ${radius} ${-radius}h${w - 2 * radius}` +
      `a${radius} ${radius} 0 0 1 ${radius} ${radius}v${h - radius}h${-w}z`;
}

function Bar({ result, props, size, select, selected, locale }: PanelProps<BarProps>) {
  const [hover, setHover] = useState<number | null>(null);

  const category = requireColumn(result, props.category, "props.category");
  const measure = requireColumn(result, props.value, "props.value");
  const horizontal = (props.orientation ?? "horizontal") === "horizontal";
  const showValues = props.showValues ?? true;

  const labels = columnValues(result, category);
  const raw = columnValues(result, measure);
  const count = Math.min(result.rowCount, props.maxBars ?? 50);

  const numbers = raw.slice(0, count).map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0));
  const max = Math.max(0, ...numbers);
  const width = Math.max(120, size.width);
  const height = Math.max(80, size.height);

  if (!count || max <= 0) return <p className="gw-empty">No data to plot.</p>;

  const GAP = 2;             // surface gap between adjacent bars
  const RADIUS = 4;          // rounded data-end
  const FONT = 11.5;

  const formatted = raw.slice(0, count).map((v) => formatValue(v, measure.format, locale));
  const widestValue = Math.max(0, ...formatted.map((t) => estimateWidth(t, FONT, true)));
  const widestLabel = Math.max(
    0,
    ...labels.slice(0, count).map((l) => estimateWidth(String(l ?? "—"), FONT, false)),
  );

  // Gutters never take more than a third of the panel each, so a very long
  // label degrades to truncation rather than squeezing the bars to nothing.
  const VALUE_GUTTER = showValues ? Math.min(Math.ceil(widestValue) + 14, Math.round(width * 0.33)) : 8;
  const LABEL_GUTTER = horizontal
    ? Math.min(Math.ceil(widestLabel) + 12, Math.round(width * 0.33))
    : 0;

  const plotW = horizontal ? Math.max(24, width - LABEL_GUTTER - VALUE_GUTTER) : width;
  const plotH = horizontal ? height : height - 28;
  const band = (horizontal ? plotH : plotW) / count;
  const thickness = Math.max(4, band - GAP);

  const tip = hover !== null ? {
    label: String(labels[hover] ?? "—"),
    value: formatValue(raw[hover] ?? null, measure.format, locale),
  } : null;

  return (
    <div className="gw-chart">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${measure.label} by ${category.label}`}
        className="gw-svg"
      >
        {numbers.map((v, i) => {
          const on = isSelected(selected, category.id, labels[i] ?? null);
          const dim = selectedAny(selected, category.id) && !on;
          const length = (v / max) * (horizontal ? plotW : plotH);
          const x = horizontal ? LABEL_GUTTER : i * band + GAP / 2;
          const y = horizontal ? i * band + GAP / 2 : plotH - length;
          const w = horizontal ? length : thickness;
          const h = horizontal ? thickness : length;

          return (
            <g
              key={i}
              className={`gw-bar${on ? " gw-on" : ""}${dim ? " gw-dim" : ""}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => select(category.id, labels[i] ?? null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  select(category.id, labels[i] ?? null);
                }
              }}
              tabIndex={0}
              role="button"
              aria-pressed={on}
            >
              {/* Hit target spans the whole band, not just the drawn bar. */}
              <rect
                x={horizontal ? LABEL_GUTTER : i * band}
                y={horizontal ? i * band : 0}
                width={horizontal ? plotW : band}
                height={horizontal ? band : plotH}
                fill="transparent"
              />
              <path d={barPath(x, y, w, h, RADIUS, horizontal)} className="gw-bar-fill" />
              {horizontal && (
                <text x={LABEL_GUTTER - 8} y={y + thickness / 2} className="gw-bar-label" textAnchor="end">
                  {truncate(String(labels[i] ?? "—"), Math.floor((LABEL_GUTTER - 12) / (FONT * 0.56)))}
                </text>
              )}
              {showValues && (
                <text
                  x={horizontal ? LABEL_GUTTER + length + 8 : x + thickness / 2}
                  y={horizontal ? y + thickness / 2 : y - 6}
                  className="gw-bar-value"
                  textAnchor={horizontal ? "start" : "middle"}
                >
                  {formatted[i]}
                </text>
              )}
            </g>
          );
        })}
        {!horizontal &&
          numbers.map((_, i) => (
            <text
              key={`x${i}`}
              x={i * band + band / 2}
              y={plotH + 18}
              className="gw-bar-label"
              textAnchor="middle"
            >
              {truncate(String(labels[i] ?? "—"), Math.floor(band / (FONT * 0.56)))}
            </text>
          ))}
      </svg>
      {tip && (
        <div className="gw-tip" role="status">
          <strong>{tip.label}</strong>
          <span>{measure.label}: {tip.value}</span>
        </div>
      )}
    </div>
  );
}

const selectedAny = (selected: PanelProps<BarProps>["selected"], dim: string): boolean =>
  (selected[dim] ?? []).length > 0;

function truncate(s: string, max: number): string {
  if (max < 3 || s.length <= max) return s;
  return `${s.slice(0, Math.max(1, max - 1))}…`;
}

export const barPanel: PanelSpec<BarProps> = {
  type: "bar",
  label: "Bar chart",
  description: "Compares a measure across the values of one dimension.",
  schema,
  defaults: (result) => ({
    category: firstDimension(result)?.id ?? "",
    value: firstMeasure(result)?.id ?? "",
  }),
  Component: Bar,
  minSize: { w: 3, h: 3 },
};

export type { Value };
