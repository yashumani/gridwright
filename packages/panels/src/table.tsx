import { useMemo } from "react";
import { arr, bool, enum_, obj, opt, str } from "@gridwright/schema";
import type { Value } from "@gridwright/engine";
import { formatValue } from "./format.js";
import { compileRule, resultRow, type CompiledRule } from "./rules.js";
import {
  columnValues, isSelected, requireColumn,
  type PanelProps, type PanelSpec,
} from "./registry.js";

/**
 * The table view. Besides being useful on its own, this is the relief mechanism
 * the colour rules require: any encoding that cannot carry enough contrast on
 * its own is still readable as numbers here.
 */
export interface TableColumn {
  ref: string;
  label?: string;
  align?: "left" | "right" | "center";
  /** Draws an in-cell magnitude bar behind the value. */
  bar?: boolean;
}

export interface TableRule {
  when: string;
  style: { weight?: "bold" | "normal"; tone?: "good" | "bad" | "muted" };
}

export interface TableProps {
  columns: TableColumn[];
  rules?: TableRule[];
  zebra?: boolean;
}

const schema = obj({
  columns: arr(
    obj({
      ref: str({ minLength: 1 }),
      label: opt(str({ maxLength: 120 })),
      align: opt(enum_(["left", "right", "center"] as const)),
      bar: opt(bool()),
    }),
    { min: 1, max: 64 },
  ),
  rules: opt(
    arr(
      obj({
        when: str({ minLength: 1, maxLength: 500 }),
        style: obj({
          weight: opt(enum_(["bold", "normal"] as const)),
          tone: opt(enum_(["good", "bad", "muted"] as const)),
        }),
      }),
      { max: 16 },
    ),
  ),
  zebra: opt(bool()),
});

function Table({ result, props, select, selected, locale }: PanelProps<TableProps>) {
  const columns = props.columns.map((c) => ({
    spec: c,
    meta: requireColumn(result, c.ref, `props.columns[].ref`),
  }));

  // Rules are compiled once per props change, not per cell.
  const rules = useMemo(() => {
    const out: Array<{ rule: CompiledRule; style: TableRule["style"] }> = [];
    for (const r of props.rules ?? []) {
      const { rule } = compileRule(r.when);
      if (rule) out.push({ rule, style: r.style });
    }
    return out;
  }, [props.rules]);

  // Bar columns need a per-column maximum to scale against.
  const maxima = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of columns) {
      if (!c.spec.bar) continue;
      const values = columnValues(result, c.meta).filter((v): v is number => typeof v === "number");
      m.set(c.meta.key, values.length ? Math.max(...values.map(Math.abs)) : 0);
    }
    return m;
  }, [result, props.columns]);

  const firstDim = result.columns.find((c) => c.kind === "dimension");
  const clickable = Boolean(firstDim);

  const rows = Array.from({ length: result.rowCount }, (_, i) => i);

  return (
    <div className="gw-table-wrap">
      <table className={`gw-table${props.zebra === false ? "" : " gw-zebra"}`}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.meta.key}
                scope="col"
                style={{ textAlign: c.spec.align ?? (c.meta.kind === "measure" ? "right" : "left") }}
              >
                {c.spec.label ?? c.meta.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => {
            const row = resultRow(result, i);
            const applied = rules.filter((r) => r.rule.test(row)).map((r) => r.style);
            const weight = applied.find((s) => s.weight)?.weight;
            const tone = applied.find((s) => s.tone)?.tone;
            const dimValue: Value = firstDim ? result.data[firstDim.key]?.[i] ?? null : null;
            const on = firstDim ? isSelected(selected, firstDim.id, dimValue) : false;

            return (
              <tr
                key={i}
                className={`${on ? "gw-row-on " : ""}${tone ? `gw-tone-${tone}` : ""}`}
                style={weight ? { fontWeight: weight } : undefined}
                {...(clickable
                  ? {
                      onClick: () => select(firstDim!.id, dimValue),
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          select(firstDim!.id, dimValue);
                        }
                      },
                      tabIndex: 0,
                      role: "button",
                      "aria-pressed": on,
                      title: `Filter to ${String(dimValue ?? "blank")}`,
                    }
                  : {})}
              >
                {columns.map((c) => {
                  const value = result.data[c.meta.key]?.[i] ?? null;
                  const max = maxima.get(c.meta.key) ?? 0;
                  const pct =
                    c.spec.bar && typeof value === "number" && max > 0
                      ? Math.abs(value) / max
                      : undefined;
                  return (
                    <td
                      key={c.meta.key}
                      style={{ textAlign: c.spec.align ?? (c.meta.kind === "measure" ? "right" : "left") }}
                    >
                      {pct !== undefined && (
                        <span className="gw-cell-bar" style={{ width: `${(pct * 100).toFixed(2)}%` }} />
                      )}
                      <span className="gw-cell-text">
                        {formatValue(value, c.meta.format, locale)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {result.truncated && (
        <p className="gw-note">
          Showing {result.rowCount} of {result.totalGroups} rows.
        </p>
      )}
    </div>
  );
}

export const tablePanel: PanelSpec<TableProps> = {
  type: "table",
  label: "Table",
  description: "Rows of dimensions and measures, with optional in-cell bars and formatting rules.",
  schema,
  defaults: (result) => ({ columns: result.columns.map((c) => ({ ref: c.id })) }),
  Component: Table,
  minSize: { w: 4, h: 3 },
};
