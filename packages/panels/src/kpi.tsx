import { bool, described, obj, opt, str } from "@gridwright/schema";
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
}

const schema = obj({
  measure: described(str({ minLength: 1 }), { title: "Number to show" }),
  caption: described(opt(str({ maxLength: 120 })), { title: "Caption" }),
  delta: described(opt(str({ minLength: 1 })), { title: "Change indicator" }),
  invertTrend: described(opt(bool()), { title: "Down is good" }),
});

function Kpi({ result, props, locale }: PanelProps<KpiProps>) {
  const measure = requireColumn(result, props.measure, "props.measure");
  const value = columnValues(result, measure)[0] ?? null;

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
