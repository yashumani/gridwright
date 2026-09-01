/**
 * Series colours. These are the validated categorical steps — the ordering is
 * the colourblind-safety mechanism, not decoration, so slots are assigned in
 * fixed order and never cycled. Chrome colours live in the stylesheet; they are
 * deliberately not reused as data colours (the brand verdigris fails the chroma
 * floor and reads gray in a chart).
 */
export const SERIES_LIGHT = [
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100",
  "#e87ba4", "#008300", "#4a3aa7", "#e34948",
] as const;

export const SERIES_DARK = [
  "#3987e5", "#d95926", "#199e70", "#c98500",
  "#d55181", "#008300", "#9085e9", "#e66767",
] as const;

/**
 * Resolved at render time from a CSS custom property, so a page's theme toggle
 * and the OS setting both reach the SVG without the component re-rendering.
 */
export const seriesVar = (index: number): string => `var(--gw-series-${(index % 8) + 1})`;

/** A ninth series is never a generated hue; callers fold the tail into Other. */
export const MAX_SERIES = 8;

export interface FoldResult<T> {
  kept: T[];
  folded: T[];
}

export function foldSeries<T>(items: readonly T[], max = MAX_SERIES): FoldResult<T> {
  if (items.length <= max) return { kept: [...items], folded: [] };
  return { kept: items.slice(0, max - 1), folded: items.slice(max - 1) };
}
