import {
  checkColour, checkPalette, derivePalette, oklch, parseHex, snapToPassing, toHex,
  type Mode,
} from "./palette.js";

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

/**
 * A whole palette built from one brand colour.
 *
 * This is the question people actually have: "here is our blue, give me a
 * dashboard in it." Inventing seven more hues by eye is where that usually goes
 * wrong — the result looks fine to whoever picked it and collapses for a
 * colourblind reader, or two adjacent series turn out to be the same colour.
 *
 * So only the starting hue is the brand's. The seven that follow sit at the
 * default palette's own hue offsets, which are the spacing that makes it work,
 * and each is re-stepped for the surface. Rotating a palette is not quite
 * distance-preserving — OKLab is perceptual, not a circle — so about one hue in
 * five lands with a pair too close together, and those pairs are then repaired
 * by moving one of them in lightness. The hue is never touched: a palette that
 * drifted off the brand hue to satisfy a check would have solved the wrong
 * problem.
 */
export function paletteFromBrand(brand: string, o: { mode?: Mode; surface?: string } = {}): string[] {
  const structure = SERIES_LIGHT.map((hex) => oklch(hex));
  const first = structure[0]!;
  const shift = (oklch(brand).h - first.h + 360) % 360;

  const seeded = structure.map((step, i) =>
    i === 0 ? brand : toHex({ ...step, h: (step.h + shift) % 360 }),
  );
  return repairPairs(seeded.map((c) => snapToPassing(c, o)), o);
}

/**
 * Moves colours apart until neighbours are distinguishable.
 *
 * Only lightness moves, and only for the later colour of an offending pair, so
 * the fix stays local and every hue survives intact — a palette that drifted off
 * the brand hue to satisfy a check would have solved the wrong problem.
 *
 * The search scans the whole usable range rather than trying a few fixed
 * offsets, and keeps the step that puts the most distance between the pair.
 * Small offsets were not enough for the case that needs this most: a red beside
 * a green is one colour to a deuteranope whatever their hues, so lightness is
 * the only channel left and it has to move far enough to carry the separation
 * on its own.
 */
function repairPairs(colours: readonly string[], o: { mode?: Mode; surface?: string }): string[] {
  const out = [...colours];

  for (let pass = 0; pass < out.length; pass++) {
    let changed = false;
    for (let i = 0; i + 1 < out.length; i++) {
      if (checkPalette([out[i]!, out[i + 1]!], o).pairs[0]?.verdict === "pass") continue;

      const step = oklch(out[i + 1]!);
      let best: { hex: string; gap: number } | null = null;
      for (let l = 0.4; l <= 0.8; l += 0.01) {
        const candidate = toHex({ ...step, l });
        if (checkColour(candidate, o).verdict === "fail") continue;
        const pair = checkPalette([out[i]!, candidate], o).pairs[0];
        if (!pair || pair.verdict !== "pass") continue;
        // Among the steps that work, the one that also stays closest to where
        // this colour already was — the palette should move as little as it can.
        const gap = -Math.abs(l - step.l);
        if (!best || gap > best.gap) best = { hex: candidate, gap };
      }
      if (best) {
        out[i + 1] = best.hex;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

/**
 * Complete palettes to start from, for anyone who wants "not the default blue"
 * and has no brand hex to hand. Each is the shipped palette rotated as a set —
 * same lightness and chroma structure, same hue spacing — and each is checked
 * by the same tests everything else is.
 */
export const PRESETS: Record<string, { label: string; colors: string[] }> = {
  default: { label: "Gridwright", colors: [...SERIES_LIGHT] },
  orchid: {
    label: "Orchid",
    colors: ["#bf477d", "#50ae3e", "#6493eb", "#00d0ad", "#bca31c", "#0072ae", "#970e1e", "#729600"],
  },
  coral: {
    label: "Coral",
    colors: ["#c74844", "#00af8a", "#9883e3", "#00cada", "#8bb34b", "#4b5cd1", "#7d3c00", "#00a15b"],
  },
  amber: {
    label: "Amber",
    colors: ["#566fd8", "#df7500", "#00ad94", "#d9ad00", "#ed7b8b", "#00804e", "#5f319e", "#e1510d"],
  },
};

/**
 * CSS that repaints one dashboard's series colours.
 *
 * Emitted as a stylesheet rather than an inline style because a custom property
 * has to be redefined per theme, and inline styles cannot carry a media query.
 * The three blocks mirror the theme's three states exactly: the bare selector is
 * light, the media query catches the un-stamped "system" default on a dark OS,
 * and the attribute selector lets an explicit choice win over both.
 *
 * **Every value is re-parsed here.** These colours come out of a manifest, which
 * is untrusted, and they are about to become stylesheet text — a string that
 * escaped would close the declaration and restyle the host page. The schema
 * already constrains them, but a guard that lives two files away from the sink
 * is a guard that stops holding the moment somebody builds a manifest by hand
 * or a caller skips validation. Anything that is not a hex colour is dropped.
 */
export function seriesCss(colours: readonly string[] | undefined, scope: string): string {
  if (!colours?.length) return "";
  const id = scope.replace(/[^A-Za-z0-9_-]/g, "");
  if (!id) return "";

  const clean = colours.map((c) => parseHex(c)).filter((c): c is string => c !== null).slice(0, MAX_SERIES);
  if (!clean.length) return "";

  const { light, dark } = derivePalette(clean);
  const vars = (list: readonly string[]): string =>
    list.map((c, i) => `--gw-series-${i + 1}:${c};`).join("");

  const at = `[data-gw-theme="${id}"]`;
  return [
    `${at}{${vars(light)}}`,
    `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) ${at}{${vars(dark)}}}`,
    `:root[data-theme="dark"] ${at}{${vars(dark)}}`,
  ].join("");
}

export interface FoldResult<T> {
  kept: T[];
  folded: T[];
}

export function foldSeries<T>(items: readonly T[], max = MAX_SERIES): FoldResult<T> {
  if (items.length <= max) return { kept: [...items], folded: [] };
  return { kept: items.slice(0, max - 1), folded: items.slice(max - 1) };
}
