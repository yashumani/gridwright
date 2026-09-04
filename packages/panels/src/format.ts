import type { Value } from "@gridwright/engine";

/**
 * Excel-style number patterns, because that is the notation the people writing
 * manifests already know. Supported: a literal prefix/suffix, `#,##0` grouping,
 * decimals, and a trailing `%` that scales by 100.
 *
 * After the point, `0` is a decimal that always shows and `#` is one that shows
 * only when it is not zero — so `0.00` renders 5 as "5.00" while `0.##` renders
 * it as "5" and 5.25 as "5.25". That is what Excel does, and a pattern written
 * from that habit used to fall through into the suffix and print a literal
 * "##" next to the number.
 *
 * Patterns are parsed once and cached — a table redraw formats thousands of
 * cells, and re-parsing per cell shows up immediately.
 */
export interface NumberPattern {
  prefix: string;
  suffix: string;
  grouping: boolean;
  /** Most decimals to show. */
  decimals: number;
  /** Fewest to show; below this, trailing places are dropped. */
  minDecimals: number;
  percent: boolean;
}

const cache = new Map<string, NumberPattern>();

export function parsePattern(pattern: string): NumberPattern {
  const hit = cache.get(pattern);
  if (hit) return hit;

  const percent = pattern.includes("%");
  const core = pattern.replace(/%/g, "");
  const match = /[#0][#0,]*(?:\.[#0]+)?/.exec(core);
  const numeric = match?.[0] ?? "0";
  const fraction = numeric.includes(".") ? (numeric.split(".")[1] ?? "") : "";

  const parsed: NumberPattern = {
    prefix: core.slice(0, match?.index ?? 0),
    suffix: core.slice((match?.index ?? 0) + numeric.length),
    grouping: numeric.includes(","),
    decimals: fraction.length,
    minDecimals: fraction.replace(/#/g, "").length,
    percent,
  };
  cache.set(pattern, parsed);
  return parsed;
}

export function formatNumber(value: number, pattern: string | undefined, locale?: string): string {
  if (!pattern) {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  }
  const p = parsePattern(pattern);
  const scaled = p.percent ? value * 100 : value;
  const body = new Intl.NumberFormat(locale, {
    useGrouping: p.grouping,
    minimumFractionDigits: p.minDecimals,
    maximumFractionDigits: p.decimals,
  }).format(scaled);
  return `${p.prefix}${body}${p.suffix}${p.percent ? "%" : ""}`;
}

/** Formats any cell value. Nulls render as an em dash rather than "null". */
export function formatValue(value: Value, pattern?: string, locale?: string): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    return formatNumber(value, pattern, locale);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/** Compact form for axis ticks, where a full grouped number will not fit. */
export function formatCompact(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
