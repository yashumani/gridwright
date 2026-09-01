/**
 * Brand colours, checked rather than trusted.
 *
 * People want their own colours in their own dashboard, and the obvious way to
 * offer that — take the hexes and use them — quietly produces charts that some
 * readers cannot read. A brand palette is chosen against a logo, on a slide, at
 * a size; a chart uses the same hues as *identity*, at small sizes, next to each
 * other, on a specific surface. Those are different jobs and the second one has
 * measurable requirements.
 *
 * So a colour is measured on four things that can be computed from the hex, and
 * anything that fails gets a suggestion in the same hue that passes. Nobody is
 * told "no" — they are told what is wrong and offered the nearest colour of
 * theirs that works.
 *
 *   Lightness    Too light and it vanishes into a light surface; too dark and it
 *                vanishes into a dark one. There is a band per mode.
 *   Chroma       Below a floor a hue reads as gray, and a gray series is not
 *                doing the one job a categorical colour has.
 *   Separation   Two neighbouring series must stay distinguishable — including
 *                under the two common forms of colour blindness, which between
 *                them affect around one man in twelve.
 *   Contrast     A mark must stand off the surface it is drawn on.
 *
 * The maths is OKLab: a space where equal numeric distance is roughly equal
 * perceived difference, which is the property that makes "are these two far
 * enough apart" a question worth computing at all. Deuteranopia and protanopia
 * are simulated with the Machado, Oliveira & Fernandes (2009) transforms at full
 * severity; the thresholds below are calibrated to that model, so the model is
 * part of the standard rather than an implementation detail.
 */

export type Mode = "light" | "dark";

/** OKLCH lightness band per mode. Outside it, a mark fades into the surface. */
const BAND: Record<Mode, [number, number]> = { light: [0.43, 0.77], dark: [0.48, 0.67] };

/** Below this OKLCH chroma a hue reads as gray and stops carrying identity. */
const CHROMA_FLOOR = 0.1;

/**
 * What the snap aims for, rather than the floor itself.
 *
 * A colour is quantised to eight bits per channel on the way to a hex, and the
 * chroma that comes back out is a hair under what went in. Asking for exactly
 * the minimum therefore lands just below it every time — the repair produced a
 * colour and then rejected it, by two parts in a hundred thousand, for every
 * lightness it tried. The margin is far below anything an eye resolves and far
 * above the rounding.
 */
const CHROMA_TARGET = CHROMA_FLOOR + 0.004;

/** OKLab distance ×100 between adjacent series under simulated colour blindness. */
const CVD_TARGET = 8;
const CVD_FLOOR = 6;

/** The same distance under ordinary vision. Below this, neighbours blur together. */
const NORMAL_FLOOR = 15;

/**
 * WCAG contrast of a mark against the surface behind it.
 *
 * Falling short of this is a warning rather than a refusal, because a chart has
 * a second way to be readable: the value printed beside the mark. Bar charts
 * here ship those labels on by default and the table panel shows the numbers
 * outright, so a slightly soft fill stays legible — but only while that relief
 * is present, which is why the warning says so rather than being dismissable.
 * Several colours in the project's own default palette sit just under it.
 */
const CONTRAST_MIN = 3;

export const DEFAULT_SURFACE: Record<Mode, string> = { light: "#ffffff", dark: "#171f1e" };

/** Machado, Oliveira & Fernandes (2009), severity 1.0, in linear RGB. */
const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
} as const;

type CvdKind = keyof typeof MACHADO;
type Triple = [number, number, number];

// ---- parsing -------------------------------------------------------------

/**
 * Whitespace stripped before parsing.
 *
 * Hex lists get pasted out of brand guidelines, which are rendered pages, and
 * what comes across carries non-breaking and em spaces that `trim` alone leaves
 * behind. An unparsed hex becomes NaN and NaN passes every comparison silently —
 * the palette would fail open, which is the one way this must not fail.
 */
const WS_RUN = "[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+";
const WS = new RegExp(`^${WS_RUN}|${WS_RUN}$`, "g");

const HEX6 = /^#?[0-9a-fA-F]{6}$/;
const HEX3 = /^#?[0-9a-fA-F]{3}$/;

/** A hex colour normalised to `#rrggbb`, or null if it is not one. */
export function parseHex(raw: string): string | null {
  const v = raw.replace(WS, "");
  if (HEX6.test(v)) return `#${v.replace(/^#/, "").toLowerCase()}`;
  if (HEX3.test(v)) {
    const s = v.replace(/^#/, "").toLowerCase();
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  }
  return null;
}

/** Splits pasted text into hex colours, ignoring whatever else came with them. */
export function parsePalette(raw: string): string[] {
  return raw
    .split(/[,\s;]+/)
    .map((part) => parseHex(part))
    .filter((c): c is string => c !== null);
}

// ---- colour space --------------------------------------------------------

const srgb = (hex: string): Triple => {
  // Everything downstream is arithmetic, and `parseInt` answers NaN rather than
  // refusing — NaN then compares false against every threshold, so an
  // unparseable colour would pass every check silently. That is the one way
  // this must not fail, so it refuses loudly instead.
  const norm = parseHex(hex);
  if (!norm) throw new TypeError(`not a hex colour: ${JSON.stringify(hex)}`);
  const h = norm.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Triple;
};

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number): number => {
  const v = Math.max(0, Math.min(1, c));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
};

const linear = (hex: string): Triple => srgb(hex).map(toLinear) as Triple;

const hexOf = ([r, g, b]: Triple): string =>
  `#${[r, g, b].map((c) => Math.round(toSrgb(c) * 255).toString(16).padStart(2, "0")).join("")}`;

function oklabFromLinear([r, g, b]: Triple): Triple {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function linearFromOklab([L, a, b]: Triple): Triple {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export interface Oklch {
  /** Lightness, 0–1. */
  l: number;
  /** Chroma — how far from gray. */
  c: number;
  /** Hue angle in degrees. */
  h: number;
}

export function oklch(hex: string): Oklch {
  const [L, a, b] = oklabFromLinear(linear(hex));
  return {
    l: L,
    c: Math.hypot(a, b),
    h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
  };
}

const fromOklch = ({ l, c, h }: Oklch): Triple => {
  const rad = (h * Math.PI) / 180;
  return linearFromOklab([l, c * Math.cos(rad), c * Math.sin(rad)]);
};

const inGamut = ([r, g, b]: Triple): boolean =>
  [r, g, b].every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/**
 * The nearest in-gamut colour at this lightness and hue.
 *
 * Not every (L, C, h) names a colour a screen can show — the sRGB gamut is a
 * lumpy solid, and a saturated orange has far more room than a saturated blue at
 * the same lightness. Chroma is what gives: binary search down until the colour
 * is displayable, which keeps the hue and the lightness exactly and gives up
 * only the saturation that was never available.
 */
export function toHex(target: Oklch): string {
  if (inGamut(fromOklch(target))) return hexOf(fromOklch(target));
  let lo = 0;
  let hi = target.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(fromOklch({ ...target, c: mid }))) lo = mid;
    else hi = mid;
  }
  return hexOf(fromOklch({ ...target, c: lo }));
};

// ---- the measurements ----------------------------------------------------

const luminance = (hex: string): number => {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio between two colours, 1–21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const simulate = (hex: string, kind: CvdKind): Triple => {
  const [r, g, b] = linear(hex);
  const m = MACHADO[kind];
  return m.map((row) =>
    Math.max(0, Math.min(1, row[0]! * r + row[1]! * g + row[2]! * b)),
  ) as Triple;
};

/**
 * Perceived distance between two colours, ×100.
 *
 * With no `kind` this is ordinary vision; with one, the pair is first pushed
 * through a simulation of that form of colour blindness, so the number answers
 * "can a reader with this vision tell these apart".
 */
export function distance(a: string, b: string, kind?: CvdKind): number {
  const x = oklabFromLinear(kind ? simulate(a, kind) : linear(a));
  const y = oklabFromLinear(kind ? simulate(b, kind) : linear(b));
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

export type Verdict = "pass" | "warn" | "fail";

export interface ColourCheck {
  hex: string;
  verdict: Verdict;
  /** What is wrong, in words, or an empty list when nothing is. */
  problems: string[];
  /** The nearest colour in the same hue that passes, when this one does not. */
  suggestion?: string;
}

export interface PairCheck {
  a: string;
  b: string;
  verdict: Verdict;
  /** The tightest of ordinary, protan and deutan vision, ×100. */
  distance: number;
  note: string;
}

export interface PaletteReport {
  mode: Mode;
  surface: string;
  colours: ColourCheck[];
  /** Neighbouring pairs, which are the ones that actually touch in a chart. */
  pairs: PairCheck[];
  /** True when nothing failed. Warnings do not block. */
  ok: boolean;
}

export interface CheckOptions {
  mode?: Mode;
  surface?: string;
}

/**
 * What is wrong with a colour, split by whether it is disqualifying.
 *
 * One predicate, so the checker and the snap cannot drift apart — they did,
 * over a thousandth of a unit of chroma lost to eight-bit rounding, and the
 * snap kept confidently returning colours the checker then rejected.
 */
function problemsFor(hex: string, mode: Mode, surface: string): { fatal: string[]; warnings: string[] } {
  const [lo, hi] = BAND[mode];
  const { l, c } = oklch(hex);
  const ratio = contrast(hex, surface);
  const fatal: string[] = [];
  const warnings: string[] = [];

  if (l < lo) fatal.push(`too dark for ${mode} mode — it sinks into the background`);
  else if (l > hi) fatal.push(`too light for ${mode} mode — it washes out`);
  if (c < CHROMA_FLOOR) fatal.push("too close to gray to tell one series from another");
  if (ratio < CONTRAST_MIN) {
    warnings.push(
      `soft against the background at ${ratio.toFixed(1)}:1 — readable while the ` +
      "value labels stay on, so leave them on",
    );
  }
  return { fatal, warnings };
}

/** Everything measurable about one colour on one surface. */
export function checkColour(hex: string, o: CheckOptions = {}): ColourCheck {
  const mode = o.mode ?? "light";
  const surface = o.surface ?? DEFAULT_SURFACE[mode];
  const { fatal, warnings } = problemsFor(hex, mode, surface);

  if (fatal.length) {
    const suggestion = snapToPassing(hex, { mode, surface });
    return {
      hex,
      verdict: "fail",
      problems: [...fatal, ...warnings],
      ...(suggestion !== hex ? { suggestion } : {}),
    };
  }
  return { hex, verdict: warnings.length ? "warn" : "pass", problems: warnings };
}

/**
 * The nearest colour in the same hue that passes.
 *
 * Hue is the part of a brand colour that is actually the brand — it is what
 * makes it recognisable, and it is left exactly alone. Lightness moves into the
 * band, chroma up to the floor, and if that still does not clear the surface,
 * lightness keeps stepping away from the surface until it does. A colour that
 * cannot be made to work at any lightness in its hue comes back unchanged, and
 * the caller reports it as a failure rather than pretending.
 */
export function snapToPassing(hex: string, o: CheckOptions = {}): string {
  const mode = o.mode ?? "light";
  const surface = o.surface ?? DEFAULT_SURFACE[mode];
  const [lo, hi] = BAND[mode];

  // Repair is for what is disqualifying. A colour that merely warns — soft
  // against the surface, with labels carrying it — is a deliberate choice, and
  // nudging it to chase a threshold would quietly walk somebody's brand colour
  // away from their brand.
  if (!problemsFor(hex, mode, surface).fatal.length) return hex;

  const base = oklch(hex);
  const c = Math.max(CHROMA_TARGET, base.c);
  const start = Math.min(hi, Math.max(lo, base.l));
  // Which way buys contrast: away from the surface's own lightness.
  const away = oklch(surface).l > 0.5 ? -1 : 1;

  // Every lightness the band allows, nearest to where they started first — a
  // colour that is only wrong about its chroma should not also be moved.
  //
  // Stepping outward from the clamp instead was wrong for the case that matters
  // most: a navy in light mode clamps to the bottom of the band, and "away from
  // white" is further down, so the search left the band on its first step and
  // tried exactly one candidate.
  const steps: number[] = [];
  for (let l = lo; l <= hi + 1e-9; l += 0.01) steps.push(Math.min(hi, l));
  steps.sort((a, b) => Math.abs(a - start) - Math.abs(b - start) || (a - b) * -away);

  let acceptable: string | undefined;
  for (const l of steps) {
    const candidate = toHex({ l, c, h: base.h });
    const { fatal, warnings } = problemsFor(candidate, mode, surface);
    if (fatal.length) continue;
    // In band and carrying its hue: usable. Keep looking for one that also
    // clears the contrast threshold, but do not give this one up to find it.
    acceptable ??= candidate;
    if (!warnings.length) return candidate;
  }
  return acceptable ?? hex;
}

/**
 * Checks a whole palette: each colour, then every neighbouring pair.
 *
 * Only neighbours are compared, because in a bar chart or a stacked segment
 * only neighbours touch, and slots are assigned in order and never skipped. A
 * scatter plot would need every pair — which is a strictly harder test, and one
 * no eight-colour palette passes; that is why more than about three series in a
 * scatter is a data problem rather than a colour problem.
 */
export function checkPalette(colours: readonly string[], o: CheckOptions = {}): PaletteReport {
  const mode = o.mode ?? "light";
  const surface = o.surface ?? DEFAULT_SURFACE[mode];
  const checked = colours.map((c) => checkColour(c, { mode, surface }));

  const pairs: PairCheck[] = [];
  for (let i = 0; i + 1 < colours.length; i++) {
    const a = colours[i]!;
    const b = colours[i + 1]!;
    const normal = distance(a, b);
    const cvd = Math.min(distance(a, b, "protan"), distance(a, b, "deutan"));

    if (normal < NORMAL_FLOOR) {
      pairs.push({
        a, b, verdict: "fail", distance: normal,
        note: "too alike even in full colour — most readers will not tell these apart",
      });
    } else if (cvd < CVD_FLOOR) {
      pairs.push({
        a, b, verdict: "fail", distance: cvd,
        note: "indistinguishable to a red-green colourblind reader",
      });
    } else if (cvd < CVD_TARGET) {
      pairs.push({
        a, b, verdict: "warn", distance: cvd,
        note: "close for a colourblind reader — keep the value labels on",
      });
    } else {
      pairs.push({ a, b, verdict: "pass", distance: cvd, note: "clearly distinct" });
    }
  }

  return {
    mode,
    surface,
    colours: checked,
    pairs,
    ok: !checked.some((c) => c.verdict === "fail") && !pairs.some((p) => p.verdict === "fail"),
  };
}

/**
 * A brand palette made safe for both modes.
 *
 * Dark mode is not an automatic flip of the light one: the band is different and
 * narrower, so each colour is snapped again against the dark surface rather than
 * inverted. Same hues, different steps — which is what keeps a dashboard
 * recognisably the same dashboard in either theme.
 */
export function derivePalette(colours: readonly string[]): { light: string[]; dark: string[] } {
  return {
    light: colours.map((c) => snapToPassing(c, { mode: "light" })),
    dark: colours.map((c) => snapToPassing(c, { mode: "dark" })),
  };
}
