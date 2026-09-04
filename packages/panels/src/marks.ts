/**
 * Mark specifications, in one place, because a chart set only reads as one
 * system if every panel draws to the same numbers.
 *
 * The values are not taste. A bar that fills its slot reads as a block of
 * colour rather than a measurement — the leftover band is what makes it a bar —
 * and a saturated area fill run down to zero puts more ink on the page than the
 * signal it carries. Both were true of every chart here before this file.
 */
export const MARKS = {
  /**
   * A bar never fills its band. Above about this thickness the mark stops
   * reading as a length and starts reading as a coloured region, which is why
   * a four-category chart in a tall panel looked like a stack of bricks.
   */
  maxBar: 24,
  /** Rounded at the data end, square at the baseline. */
  radius: 4,
  /** Surface-coloured gap between touching marks — never a stroke. */
  gap: 2,
  /** Line weight, round join and cap. */
  line: 2,
  /** Marker radius; 4 gives the 8px minimum hit mark. */
  dot: 4,
  /** Surface ring on a marker, so it stays legible crossing its own line. */
  ring: 2,
  /** Area fill is a wash under the line, not a block. */
  areaOpacity: 0.1,
} as const;

/**
 * Where a mark sits inside its band: capped thickness, centred, so the air is
 * shared evenly above and below rather than all falling on one side.
 */
export interface Band {
  band: number;
  thickness: number;
  offset: number;
  /** Where the group starts, so a short group sits centred in a tall panel. */
  origin: number;
}

export function bandLayout(extent: number, count: number, max = MARKS.maxBar): Band {
  const raw = count > 0 ? extent / count : 0;
  const thickness = Math.max(2, Math.min(max, raw - MARKS.gap));
  // Capping the mark is only half of it. Four bars in a panel sized for ten
  // leaves bands far taller than their marks, and the bars scatter down the
  // card as separate stripes instead of reading as one set. Cap the rhythm too
  // and centre what is left, so the group stays a group.
  const band = Math.min(raw, thickness * 2.75);
  const origin = Math.max(0, (extent - band * count) / 2);
  return { band, thickness, offset: (band - thickness) / 2, origin };
}

/**
 * An axis top and its ticks, rounded to numbers a person would choose.
 *
 * Dividing the data maximum by the tick count gives values like 232.7K and
 * 116.3K, which are arithmetic rather than a scale: nobody reads a chart in
 * units of "one third of whatever the largest bar happened to be". The domain
 * is widened to the next round step so the ticks land on 1, 2, 2.5 or 5 times a
 * power of ten.
 */
export function niceScale(dataMax: number, target = 5): { max: number; ticks: number[] } {
  if (!Number.isFinite(dataMax) || dataMax <= 0) return { max: 1, ticks: [0, 1] };

  const rough = dataMax / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const step =
    (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10) *
    magnitude;

  // Guard against a step that floating point rounds to zero on tiny data.
  if (!(step > 0)) return { max: dataMax, ticks: [0, dataMax] };

  const max = Math.ceil(dataMax / step) * step;
  const ticks: number[] = [];
  // The half-step slack absorbs the accumulated error of repeated addition, so
  // the top tick is not dropped when it lands a fraction under `max`.
  for (let t = 0; t <= max + step / 2; t += step) ticks.push(Number(t.toFixed(10)));
  return { max, ticks };
}

/**
 * Which points on a series earn a marker. Every point carrying one turns a
 * 24-month line into a row of dots; the ends and the extremes are the ones a
 * reader actually looks for.
 */
export function notablePoints(values: readonly number[]): Set<number> {
  const usable = values
    .map((v, i) => [v, i] as const)
    .filter(([v]) => Number.isFinite(v));
  if (usable.length === 0) return new Set();

  let lo = usable[0]!;
  let hi = usable[0]!;
  for (const point of usable) {
    if (point[0] < lo[0]) lo = point;
    if (point[0] > hi[0]) hi = point;
  }
  return new Set([usable[0]![1], usable[usable.length - 1]![1], lo[1], hi[1]]);
}

/**
 * Evenly spaced tick positions across `n` points, both ends always included.
 * Two labels across two years of months tells a reader where the series starts
 * and stops and nothing about what is in between.
 */
export function tickIndices(n: number, max = 6): number[] {
  if (n <= 0) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (max - 1);
  const seen = new Set<number>();
  for (let i = 0; i < max; i++) seen.add(Math.round(i * step));
  return [...seen].sort((a, b) => a - b);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when every label is the first of a month — a monthly series. */
export function isMonthly(labels: readonly unknown[]): boolean {
  return (
    labels.length > 0 &&
    labels.every((l) => typeof l === "string" && /^\d{4}-\d{2}-01$/.test(l))
  );
}

/**
 * An axis label a person would write. A monthly series axis reading
 * "2024-01-01" is a database value on display: the day is noise, and the ISO
 * ordering that makes it sortable is exactly what makes it hard to read.
 */
export function axisLabel(value: unknown, monthly: boolean, locale?: string): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (!ISO_DATE.test(text)) return text;

  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return text;

  return new Intl.DateTimeFormat(locale, {
    ...(monthly ? { month: "short", year: "numeric" } : { day: "numeric", month: "short" }),
    timeZone: "UTC",
  }).format(date);
}

/**
 * A domain and ticks for a scale that need not start at zero.
 *
 * Only legitimate where position, not length, carries the value. A bar's length
 * is the measurement, so truncating its axis overstates every difference — but
 * a dot's position is read against the axis, and holding four values within a
 * point of each other at the far end of a zero-based scale hides the very
 * difference the chart exists to show.
 */
export function niceRange(
  lo: number,
  hi: number,
  target = 4,
): { lo: number; hi: number; ticks: number[] } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return { lo: 0, hi: 1, ticks: [0, 1] };

  if (hi === lo) {
    const pad = Math.abs(hi) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }

  const rough = (hi - lo) / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const step =
    (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10) *
    magnitude;
  if (!(step > 0)) return { lo, hi, ticks: [lo, hi] };

  const niceLo = Math.floor(lo / step) * step;
  const niceHi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = niceLo; t <= niceHi + step / 2; t += step) ticks.push(Number(t.toFixed(10)));
  return { lo: niceLo, hi: niceHi, ticks };
}
