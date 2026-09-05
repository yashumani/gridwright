import { useState } from "react";
import { bool, described, num, obj, opt, str } from "@gridwright/schema";
import type { Value } from "@gridwright/engine";
import { formatValue } from "./format.js";
import { MARKS, bandLayout, niceRange, niceScale } from "./marks.js";
import { resultRow } from "./rules.js";
import {
  columnValues, firstDimension, firstMeasure, isSelected, requireColumn,
  type PanelProps, type PanelSpec,
} from "./registry.js";

/**
 * Magnitude by category, encoded by position rather than by length.
 *
 * The form a bar chart cannot be. A bar's length *is* the measurement, so its
 * axis has to start at zero — which means four values within a few percent of
 * each other draw four bars of visibly the same size, and the chart says
 * nothing. Orders of 690, 676, 680 and 648 are the case that motivated this:
 * as bars they are four full-width blocks, and the 6% spread that a reader came
 * for is invisible.
 *
 * A dot is read against the axis, not measured from an origin, so the domain
 * can close in on the data honestly. The axis is always drawn and always
 * labelled, because that is the entire basis on which the truncation is fair.
 */
export interface DotProps {
  category: string;
  value: string;
  /** Direct value labels beside each dot. */
  showValues?: boolean;
  maxRows?: number;
  /**
   * Force the axis to include zero. Off by default — including zero is what a
   * bar chart is for, and choosing this form is choosing the other trade.
   */
  zero?: boolean;
  /** One category in the accent colour, the rest recessed. */
  emphasise?: string;
}

const schema = obj({
  category: described(str({ minLength: 1 }), { title: "Group by" }),
  value: described(str({ minLength: 1 }), { title: "Number to show" }),
  showValues: described(opt(bool()), { title: "Show the numbers" }),
  maxRows: described(opt(num({ integer: true, min: 1, max: 200 })), { title: "Most rows to show" }),
  zero: described(opt(bool()), {
    title: "Start the axis at zero",
    description: "Off by default: a dot plot exists to show differences a zero-based axis hides.",
  }),
  emphasise: described(opt(str({ minLength: 1 })), { title: "Highlight one" }),
});

const FONT = 11.5;

function estimateWidth(text: string, fontSize: number, bold: boolean): number {
  return text.length * fontSize * (bold ? 0.62 : 0.56);
}

function truncate(s: string, max: number): string {
  if (max <= 0) return "";
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`;
}

function Dot({ result, props, size, select, selected, locale }: PanelProps<DotProps>) {
  const [hover, setHover] = useState<number | null>(null);

  const category = requireColumn(result, props.category, "props.category");
  const measure = requireColumn(result, props.value, "props.value");
  const showValues = props.showValues ?? true;

  const labels = columnValues(result, category);
  const raw = columnValues(result, measure);
  const count = Math.min(result.rowCount, props.maxRows ?? 50);

  const numbers = raw
    .slice(0, count)
    .map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
  const present = numbers.filter((v): v is number => v !== null);

  const width = Math.max(140, size.width);
  const height = Math.max(80, size.height);
  const AXIS_H = 20;

  if (!count || present.length === 0) return <p className="gw-empty">No data to plot.</p>;

  const formatted = raw.slice(0, count).map((v) => formatValue(v, measure.format, locale));
  const widestValue = Math.max(0, ...formatted.map((t) => estimateWidth(t, FONT, true)));
  const widestLabel = Math.max(
    0,
    ...labels.slice(0, count).map((l) => estimateWidth(String(l ?? "—"), FONT, false)),
  );

  const LABEL_GUTTER = Math.min(Math.ceil(widestLabel) + 12, Math.round(width * 0.32));
  const VALUE_GUTTER = showValues ? Math.min(Math.ceil(widestValue) + 14, Math.round(width * 0.3)) : 12;

  const plotW = Math.max(24, width - LABEL_GUTTER - VALUE_GUTTER);
  const plotH = Math.max(20, height - AXIS_H);

  // The whole point of the form: unless zero is asked for, the domain closes in
  // on the data so the spread is legible.
  const dataLo = Math.min(...present);
  const dataHi = Math.max(...present);
  const scale = props.zero
    ? { ...niceScale(dataHi), lo: 0 }
    : niceRange(dataLo, dataHi);
  const lo = props.zero ? 0 : scale.lo;
  const hi = props.zero ? (scale as { max: number }).max : (scale as { hi: number }).hi;
  const span = hi - lo || 1;
  const px = (v: number) => LABEL_GUTTER + ((v - lo) / span) * plotW;

  const { band, origin } = bandLayout(plotH, count);
  const rowY = (i: number) => origin + i * band + band / 2;

  const anySelected = (selected[category.id] ?? []).length > 0;

  const tip = hover !== null ? {
    label: String(labels[hover] ?? "—"),
    value: formatted[hover] ?? "",
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
        {scale.ticks.map((t, i) => (
          <g key={`t${i}`}>
            <line x1={px(t)} x2={px(t)} y1={0} y2={plotH} className="gw-grid-line" />
            <text x={px(t)} y={plotH + 14} className="gw-axis" textAnchor="middle">
              {formatValue(t, measure.format, locale)}
            </text>
          </g>
        ))}

        {numbers.map((v, i) => {
          if (v === null) return null;
          const on = isSelected(selected, category.id, labels[i] ?? null);
          const highlighted =
            props.emphasise !== undefined && String(labels[i] ?? "") === props.emphasise;
          const dim = anySelected ? !on : props.emphasise !== undefined && !highlighted;
          const lead = anySelected ? on : highlighted;
          const y = rowY(i);
          const cx = px(v);

          return (
            <g
              key={i}
              className={`gw-dot${lead ? " gw-on" : ""}${dim ? " gw-dim" : ""}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => select(category.id, labels[i] ?? null, resultRow(result, i))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  select(category.id, labels[i] ?? null, resultRow(result, i));
                }
              }}
              tabIndex={0}
              role="button"
              aria-pressed={on}
              aria-label={`${String(labels[i] ?? "—")}: ${formatted[i]}`}
            >
              {/* The row is the hit target: a 10px dot is not something to ask
                  anyone to land on. */}
              <rect
                x={LABEL_GUTTER}
                y={origin + i * band}
                width={plotW}
                height={band}
                fill="transparent"
              />
              {/* A hairline across the row carries the eye from the label to the
                  dot; without it a reader has to track across open space. */}
              <line
                x1={LABEL_GUTTER}
                x2={LABEL_GUTTER + plotW}
                y1={y}
                y2={y}
                className="gw-dot-rule"
              />
              <text x={LABEL_GUTTER - 8} y={y} className="gw-bar-label" textAnchor="end">
                {truncate(String(labels[i] ?? "—"), Math.floor((LABEL_GUTTER - 12) / (FONT * 0.56)))}
              </text>
              <circle cx={cx} cy={y} r={MARKS.dot + 1} className="gw-dot-mark" />
              {/* Right-aligned, so the digits line up down the column whatever
                  their magnitude. Anchored left, a seven-figure value above a
                  four-figure one puts the thousands under the units. */}
              {showValues && (
                <text x={width - 2} y={y} className="gw-bar-value" textAnchor="end">
                  {formatted[i]}
                </text>
              )}
            </g>
          );
        })}
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

export const dotPanel: PanelSpec<DotProps> = {
  type: "dot",
  label: "Dot plot",
  description:
    "Compares a measure across one dimension by position, so close values stay legible.",
  schema,
  defaults: (result) => ({
    category: firstDimension(result)?.id ?? "",
    value: firstMeasure(result)?.id ?? "",
  }),
  primary: ["category", "value"],
  Component: Dot,
  minSize: { w: 3, h: 2 },
};

export type { Value };
