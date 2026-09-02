import { useState } from "react";
import { arr, described, enum_, num, obj, opt, str } from "@gridwright/schema";
import type { Value } from "@gridwright/engine";
import { formatCompact, formatValue } from "./format.js";
import { resultRow } from "./rules.js";
import { foldSeries, seriesVar } from "./theme.js";
import {
  columnValues, firstDimension, isSelected, requireColumn,
  type PanelProps, type PanelSpec,
} from "./registry.js";

/**
 * Part-to-whole, across a category.
 *
 * The form a pie chart is usually reaching for and rarely the right answer to:
 * a pie compares angles, which people read badly, and it can show one whole. A
 * stacked bar compares lengths against a shared baseline and shows a whole per
 * category, so "how big" and "what it is made of" arrive together.
 *
 * Two modes, and the difference matters more than it looks. Stacked keeps the
 * totals comparable and the composition secondary; **share** normalises every
 * bar to the full width, which throws the totals away and makes the mix the
 * only story. Choosing the wrong one is the usual way this chart misleads — a
 * share chart where one category has four rows and another has forty thousand
 * looks like a fair comparison and is not — so the total travels with each bar
 * in share mode rather than being dropped.
 *
 * Horizontal by default, because the category labels are words and rotating
 * them to fit under vertical bars is how a bar chart becomes unreadable.
 */
export interface StackProps {
  /** The bars. */
  category: string;
  /** What each bar is made of: one measure per segment, in order. */
  values: string[];
  /** `share` normalises every bar to 100%. */
  mode?: "total" | "share";
  orientation?: "horizontal" | "vertical";
  maxBars?: number;
}

const schema = obj({
  category: described(str({ minLength: 1 }), { title: "Group by" }),
  values: described(arr(str({ minLength: 1 }), { min: 1, max: 8 }), { title: "Segments, in order" }),
  mode: described(opt(enum_(["total", "share"] as const)), { title: "Show" }),
  orientation: described(opt(enum_(["horizontal", "vertical"] as const)), { title: "Bar direction" }),
  maxBars: described(opt(num({ integer: true, min: 1, max: 200 })), { title: "Most bars to show" }),
});

const GAP = 2;      // surface gap between segments and between bars alike
const FONT = 11.5;

function Stack({ result, props, size, select, selected, locale }: PanelProps<StackProps>) {
  const [hover, setHover] = useState<{ bar: number; seg: number } | null>(null);

  const category = requireColumn(result, props.category, "props.category");
  const requested = props.values.map((ref) => requireColumn(result, ref, "props.values[]"));
  // A ninth segment is never a generated hue.
  const { kept: series, folded } = foldSeries(requested);

  const share = props.mode === "share";
  const horizontal = (props.orientation ?? "horizontal") === "horizontal";
  const labels = columnValues(result, category);
  const count = Math.min(result.rowCount, props.maxBars ?? 24);

  const rows = Array.from({ length: count }, (_, i) =>
    series.map((s) => {
      const v = columnValues(result, s)[i];
      // A negative segment cannot be stacked — there is no sensible place to
      // draw it — so it reads as absent rather than being flipped or dropped
      // silently into the segment below it.
      return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
    }),
  );
  const totals = rows.map((r) => r.reduce((a, b) => a + b, 0));
  const scaleMax = share ? 1 : Math.max(0, ...totals);

  const width = Math.max(140, size.width);
  const height = Math.max(90, size.height);

  if (!count || scaleMax <= 0) return <p className="gw-empty">No data to plot.</p>;

  const totalText = totals.map((t) => formatCompact(t, locale));
  const widestTotal = Math.max(0, ...totalText.map((t) => t.length * FONT * 0.62));
  const widestLabel = Math.max(
    0,
    ...labels.slice(0, count).map((l) => String(l ?? "—").length * FONT * 0.56),
  );

  // The total always travels with the bar in share mode: a bar normalised to
  // full width hides how much it is made of, and two bars of wildly different
  // size look equally important.
  const TOTAL_GUTTER = horizontal ? Math.min(Math.ceil(widestTotal) + 14, Math.round(width * 0.22)) : 0;
  const LABEL_GUTTER = horizontal
    ? Math.min(Math.ceil(widestLabel) + 12, Math.round(width * 0.3))
    : 0;

  const LEGEND_H = 22;
  const plotW = horizontal ? Math.max(24, width - LABEL_GUTTER - TOTAL_GUTTER) : width;
  const plotH = (horizontal ? height : height - 26) - LEGEND_H;
  const band = (horizontal ? plotH : plotW) / count;
  const thickness = Math.max(4, band - GAP * 2);

  /**
   * Stacking only means something when the segments are parts of one whole.
   *
   * Revenue on top of order count is a category error — metres plus seconds —
   * and the chart cannot tell: it draws a bar where one segment is 99.9% of the
   * length and the other is a sliver, which looks like a finding rather than a
   * mistake. The format string is the closest thing to a declared unit the model
   * has, so a mismatch is worth saying out loud. It is a note, not a refusal:
   * two measures can legitimately share a scale and not a format.
   */
  const units = new Set(series.map((sc) => sc.format ?? ""));
  const mixedUnits = units.size > 1;

  const tip = hover
    ? {
        bar: String(labels[hover.bar] ?? "—"),
        name: series[hover.seg]?.label ?? "",
        value: formatValue(columnValues(result, series[hover.seg]!)[hover.bar] ?? null,
          series[hover.seg]?.format, locale),
        pct: totals[hover.bar]
          ? `${((rows[hover.bar]![hover.seg]! / totals[hover.bar]!) * 100).toFixed(1)}%`
          : "—",
      }
    : null;

  return (
    <div className="gw-chart">
      <svg
        width={width}
        height={height - LEGEND_H}
        role="img"
        aria-label={`${series.map((s) => s.label).join(", ")} by ${category.label}`}
        className="gw-svg"
      >
        {rows.map((segments, i) => {
          const on = isSelected(selected, category.id, labels[i] ?? null);
          const dim = (selected[category.id] ?? []).length > 0 && !on;
          const full = share ? (totals[i] ? 1 : 0) : totals[i]!;
          let offset = 0;

          return (
            <g
              key={i}
              className={`gw-stack${on ? " gw-on" : ""}${dim ? " gw-dim" : ""}`}
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
              aria-label={`${String(labels[i] ?? "—")}: ${formatCompact(totals[i]!, locale)}`}
            >
              {segments.map((v, s) => {
                const fraction = full > 0 ? (share ? v / totals[i]! : v) / (share ? 1 : scaleMax) : 0;
                const length = fraction * (horizontal ? plotW : plotH);
                const start = offset;
                offset += length;
                if (length <= 0) return null;

                // A gap of surface between segments rather than a stroke around
                // them: a border adds a colour the palette never validated.
                const drawn = Math.max(0.5, length - GAP);
                const x = horizontal ? LABEL_GUTTER + start : i * band + GAP;
                const y = horizontal ? i * band + GAP : plotH - start - drawn;

                return (
                  <rect
                    key={s}
                    x={x}
                    y={y}
                    width={horizontal ? drawn : thickness}
                    height={horizontal ? thickness : drawn}
                    fill={seriesVar(s)}
                    className="gw-stack-seg"
                    onMouseEnter={() => setHover({ bar: i, seg: s })}
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })}

              {horizontal && (
                <>
                  <text
                    x={LABEL_GUTTER - 8}
                    y={i * band + GAP + thickness / 2}
                    className="gw-bar-label"
                    textAnchor="end"
                  >
                    {truncate(String(labels[i] ?? "—"), Math.floor((LABEL_GUTTER - 12) / (FONT * 0.56)))}
                  </text>
                  <text
                    x={LABEL_GUTTER + (share ? plotW : (totals[i]! / scaleMax) * plotW) + 8}
                    y={i * band + GAP + thickness / 2}
                    className="gw-bar-value"
                    textAnchor="start"
                  >
                    {totalText[i]}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {!horizontal &&
          rows.map((_, i) => (
            <text
              key={`x${i}`}
              x={i * band + band / 2}
              y={plotH + 17}
              className="gw-bar-label"
              textAnchor="middle"
            >
              {truncate(String(labels[i] ?? "—"), Math.floor(band / (FONT * 0.56)))}
            </text>
          ))}
      </svg>

      {/* Identity is never colour alone: every segment is named here, and the
          hover gives its number. */}
      <ul className="gw-legend">
        {series.map((s, i) => (
          <li key={s.id}>
            <span className="gw-swatch" style={{ background: seriesVar(i) }} aria-hidden="true" />
            {s.label}
          </li>
        ))}
        {folded.length > 0 && <li className="gw-legend-more">+{folded.length} not shown</li>}
      </ul>

      {mixedUnits && (
        <p className="gw-note">
          These are measured in different units, so the segments do not add up to
          a meaningful whole. Stack measures that share a scale, or use separate
          panels.
        </p>
      )}

      {tip && (
        <div className="gw-tip" role="status">
          <strong>{tip.bar}</strong>
          <span>{tip.name}: {tip.value} ({tip.pct})</span>
        </div>
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (max < 3 || s.length <= max) return s;
  return `${s.slice(0, Math.max(1, max - 1))}…`;
}

export const stackPanel: PanelSpec<StackProps> = {
  type: "stack",
  label: "Stacked bar",
  description: "What each category is made of, and how the categories compare.",
  schema,
  defaults: (result) => ({
    category: firstDimension(result)?.id ?? "",
    values: result.columns.filter((c) => c.kind === "measure").slice(0, 3).map((c) => c.id),
  }),
  primary: ["category", "values"],
  Component: Stack,
  minSize: { w: 4, h: 4 },
};
