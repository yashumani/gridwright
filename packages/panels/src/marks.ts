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
}

export function bandLayout(extent: number, count: number, max = MARKS.maxBar): Band {
  const band = count > 0 ? extent / count : 0;
  const thickness = Math.max(2, Math.min(max, band - MARKS.gap));
  return { band, thickness, offset: (band - thickness) / 2 };
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
