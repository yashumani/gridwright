import type { Value } from "@gridwright/engine";

/**
 * Excel-style number patterns, because that is the notation the people writing
 * manifests already know. Supported: a literal prefix/suffix, `#,##0` grouping,
 * a fixed decimal count, and a trailing `%` that scales by 100.
 *
 * Patterns are parsed once and cached — a table redraw formats thousands of
 * cells, and re-parsing per cell shows up immediately.
 */
export interface NumberPattern {
  prefix: string;
  suffix: string;
  grouping: boolean;
  decimals: number;
  percent: boolean;
}

const cache = new Map<string, NumberPattern>();

export function parsePattern(pattern: string): NumberPattern {
  const hit = cache.get(pattern);
  if (hit) return hit;

  const percent = pattern.includes("%");
  const core = pattern.replace(/%/g, "");
  const match = /[#0][#0,]*(?:\.0+)?/.exec(core);
  const numeric = match?.[0] ?? "0";

  const parsed: NumberPattern = {
    prefix: core.slice(0, match?.index ?? 0),
    suffix: core.slice((match?.index ?? 0) + numeric.length),
    grouping: numeric.includes(","),
    decimals: numeric.includes(".") ? (numeric.split(".")[1] ?? "").length : 0,
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
    minimumFractionDigits: p.decimals,
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
