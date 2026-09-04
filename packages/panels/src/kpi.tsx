import { bool, described, obj, opt, str } from "@gridwright/schema";
import type { Value } from "@gridwright/engine";
import { formatValue } from "./format.js";
import { columnValues, firstMeasure, requireColumn, type PanelProps, type PanelSpec } from "./registry.js";

/**
 * A stat tile. The data's job here is a single headline, so there is no plot —
 * a chart drawn around one number is decoration, not information.
 */
export interface KpiProps {
  measure: string;
  caption?: string;
  /** A second measure rendered as a change indicator beside the headline. */
  delta?: string;
  /** For measures where down is good — a falling return rate is not a decline. */
  invertTrend?: boolean;
  /**
   * Draw the measure's own history behind the number.
   *
   * A number on its own says where you are and nothing about how you got here;
   * 8.4% could be the best month on record or the worst. The shape costs one
   * line of ink and answers that. It needs a dataset with a dimension to run
   * along — the same one a trend chart would use — and does nothing quietly
   * when the dataset is a single total.
   */
  sparkline?: boolean;
}

const schema = obj({
  measure: described(str({ minLength: 1 }), { title: "Number to show" }),
  caption: described(opt(str({ maxLength: 120 })), { title: "Caption" }),
  delta: described(opt(str({ minLength: 1 })), { title: "Change indicator" }),
  invertTrend: described(opt(bool()), { title: "Down is good" }),
  sparkline: described(opt(bool()), { title: "Show the trend behind it" }),
});

/**
 * The measure's own series as a path, or null when there is nothing to draw.
 *
 * Two points is a line segment, not a trend, so three is the floor. The shape
 * is normalised to its own range rather than to zero: a measure that moves
 * between 94% and 96% is a flat line against a zero baseline and says nothing,
 * and the sparkline's job is the shape — the magnitude is the number above it.
 */
interface Spark {
  /** The whole series, recessed. */
  line: string;
  /** The last step, drawn forward: a stat tile means "now". */
  latest: string;
  /** A wash under the line so the shape reads at 22px tall. */
  area: string;
}

function sparkPath(values: readonly Value[], w: number, h: number): Spark | null {
  const points = values
    .map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null))
    .filter((v): v is number => v !== null);
  if (points.length < 3) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const step = w / (points.length - 1);
  const at = (i: number): [number, number] => [
    i * step,
    span > 0 ? h - ((points[i]! - min) / span) * h : h / 2,
  ];

  const coords = points.map((_, i) => at(i));
  const line = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join("");

  // The marker a sparkline wants is a highlighted final step rather than a dot:
  // the tile stretches its geometry to whatever width it lands in, which would
  // render a circle as an ellipse.
  const [px, py] = coords[coords.length - 2]!;
  const [cx, cy] = coords[coords.length - 1]!;
  const latest = `M${px.toFixed(1)} ${py.toFixed(1)}L${cx.toFixed(1)} ${cy.toFixed(1)}`;

  const area = `${line}L${w.toFixed(1)} ${h.toFixed(1)}L0 ${h.toFixed(1)}Z`;
  return { line, latest, area };
}

const SPARK = { w: 104, h: 22 };

function Kpi({ result, props, locale }: PanelProps<KpiProps>) {
  const measure = requireColumn(result, props.measure, "props.measure");
  const series = columnValues(result, measure);
  // With a series, the headline is its last point: a KPI beside a trend means
  // "now", not "when the window opened".
  const value = (series.length > 1 ? series[series.length - 1] : series[0]) ?? null;
  const spark = props.sparkline ? sparkPath(series, SPARK.w, SPARK.h - 3) : null;

  const deltaMeta = props.delta ? requireColumn(result, props.delta, "props.delta") : undefined;
  const deltaValue = deltaMeta ? columnValues(result, deltaMeta)[0] ?? null : null;
  const deltaNumber = typeof deltaValue === "number" && Number.isFinite(deltaValue) ? deltaValue : null;

  const rising = deltaNumber !== null && deltaNumber > 0;
  const flat = deltaNumber === null || deltaNumber === 0;
  const good = props.invertTrend ? !rising : rising;
  const tone = flat ? "flat" : good ? "up" : "down";

  return (
    <div className="gw-kpi">
      <div className="gw-kpi-label">{measure.label}</div>
      <div className="gw-kpi-value" title={String(value ?? "")}>
        {formatValue(value, measure.format, locale)}
      </div>
      {spark && (
        <svg
          className="gw-spark"
          width="100%"
          height={SPARK.h}
          viewBox={`0 0 ${SPARK.w} ${SPARK.h}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={spark.area} className="gw-spark-area" />
          <path d={spark.line} className="gw-spark-line" fill="none" />
          <path d={spark.latest} className="gw-spark-latest" fill="none" />
        </svg>
      )}
      <div className="gw-kpi-foot">
        {deltaMeta && (
          <span className={`gw-delta gw-delta-${tone}`}>
            {/* An arrow plus a sign, so the trend is never colour-alone. */}
            <span aria-hidden="true">{flat ? "→" : rising ? "↑" : "↓"}</span>
            <span>{formatValue(deltaValue, deltaMeta.format, locale)}</span>
            <span className="gw-sr-only">
              {flat ? "no change" : rising ? "increase" : "decrease"}
            </span>
          </span>
        )}
        {props.caption && <span className="gw-kpi-caption">{props.caption}</span>}
      </div>
    </div>
  );
}

export const kpiPanel: PanelSpec<KpiProps> = {
  type: "kpi",
  label: "KPI",
  description: "A single headline number, with an optional change indicator.",
  schema,
  defaults: (result) => ({ measure: firstMeasure(result)?.id ?? "" }),
  primary: ["measure"],
  Component: Kpi,
  minSize: { w: 2, h: 2 },
};
