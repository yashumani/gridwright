import { describe, expect, it } from "vitest";
import {
  PRESETS, SERIES_DARK, SERIES_LIGHT, checkColour, checkPalette, contrast, derivePalette,
  INK_CANDIDATES, distance, inkFor, oklch, paletteFromBrand, parseHex, parsePalette,
  rampFrom, seriesCss, snapToPassing, toHex,
} from "@gridwright/panels";

describe("reading a hex", () => {
  it("takes the shapes people actually paste", () => {
    expect(parseHex("#2A78D6")).toBe("#2a78d6");
    expect(parseHex("2a78d6")).toBe("#2a78d6");
    expect(parseHex("#0af")).toBe("#00aaff");
  });

  it("strips the whitespace a rendered page pastes along with it", () => {
    // Brand guidelines are web pages; copying out of one brings non-breaking
    // and em spaces that trim() alone does not remove. An unparsed hex becomes
    // NaN, and NaN passes every comparison — the palette would fail open.
    expect(parseHex(" #2a78d6 ")).toBe("#2a78d6");
    expect(parseHex("　#2a78d6")).toBe("#2a78d6");
  });

  it("refuses what is not a colour rather than guessing", () => {
    expect(parseHex("blue")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
    expect(parseHex("#gggggg")).toBeNull();
    expect(parseHex("")).toBeNull();
  });

  it("pulls the colours out of however they were pasted", () => {
    expect(parsePalette("#2a78d6, #eb6834\n#1baf7a;  nonsense  #eda100"))
      .toEqual(["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]);
  });
});

describe("colour space", () => {
  // Reference values from the OKLab specification's own conversions.
  it("converts to OKLCH", () => {
    const white = oklch("#ffffff");
    expect(white.l).toBeCloseTo(1, 3);
    expect(white.c).toBeCloseTo(0, 3);

    const black = oklch("#000000");
    expect(black.l).toBeCloseTo(0, 3);

    // A mid gray has essentially no chroma, whatever its lightness.
    expect(oklch("#808080").c).toBeLessThan(0.005);
  });

  it("round-trips a colour through OKLCH", () => {
    for (const hex of SERIES_LIGHT) {
      expect(toHex(oklch(hex))).toBe(hex);
    }
  });

  it("gives up chroma rather than hue when a colour is out of gamut", () => {
    // Nothing displayable is this saturated, so the answer keeps the hue and
    // the lightness and returns the most saturated blue the screen can show.
    const asked = { l: 0.5, c: 0.9, h: 264 };
    const got = oklch(toHex(asked));
    expect(got.l).toBeCloseTo(asked.l, 2);
    expect(got.h).toBeCloseTo(asked.h, 0);
    expect(got.c).toBeLessThan(asked.c);
    expect(got.c).toBeGreaterThan(0.1);
  });

  it("computes WCAG contrast", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 3);
    // The documented ratio for this pair, both directions.
    expect(contrast("#767676", "#ffffff")).toBeCloseTo(4.54, 1);
    expect(contrast("#ffffff", "#767676")).toBeCloseTo(4.54, 1);
  });

  it("measures a pair as further apart in full colour than under colourblindness", () => {
    // Red and green are the textbook case: obvious to most people, nearly the
    // same colour to a deuteranope.
    const normal = distance("#d33", "#3a3");
    const deutan = distance("#d33", "#3a3", "deutan");
    expect(normal).toBeGreaterThan(deutan * 2);
  });

  it("says a colour is no distance from itself", () => {
    expect(distance("#2a78d6", "#2a78d6")).toBeCloseTo(0, 6);
  });
});

describe("checking one colour", () => {
  it("clears the palette the project already ships", () => {
    // Nothing in it is disqualified. A few sit just under the contrast
    // threshold and warn, which is exactly why bar charts print their values.
    for (const hex of SERIES_LIGHT) {
      const r = checkColour(hex, { mode: "light" });
      expect(r.verdict, `${hex}: ${r.problems.join("; ")}`).not.toBe("fail");
    }
    for (const hex of SERIES_DARK) {
      const r = checkColour(hex, { mode: "dark", surface: "#171f1e" });
      expect(r.verdict, `${hex}: ${r.problems.join("; ")}`).not.toBe("fail");
    }
  });

  it("warns about a soft fill rather than refusing it, and says what carries it", () => {
    const r = checkColour("#1baf7a", { mode: "light" });
    expect(r.verdict).toBe("warn");
    expect(r.problems.join(" ")).toMatch(/value labels stay on/);
    // A warning is not a rejection, so it comes with no replacement to apply.
    expect(r.suggestion).toBeUndefined();
  });

  it("refuses a colour it cannot parse rather than treating it as black", () => {
    // parseInt answers NaN, and NaN compares false against every threshold —
    // an unreadable colour would pass every check silently.
    expect(() => checkColour("not a colour")).toThrow(/not a hex colour/);
  });

  it("fails a pastel on white and offers a darker one in the same hue", () => {
    const r = checkColour("#ffd7d7", { mode: "light" });
    expect(r.verdict).toBe("fail");
    expect(r.problems.join(" ")).toMatch(/washes out|against the background/);
    expect(r.suggestion).toBeTruthy();

    // The suggestion is the brand's hue, at a lightness that works.
    expect(oklch(r.suggestion!).h).toBeCloseTo(oklch("#ffd7d7").h, 0);
    expect(checkColour(r.suggestion!, { mode: "light" }).verdict).toBe("pass");
  });

  it("fails a near-black on a dark surface", () => {
    const r = checkColour("#101820", { mode: "dark", surface: "#171f1e" });
    expect(r.verdict).toBe("fail");
    expect(r.problems.join(" ")).toMatch(/too dark|against the background/);
  });

  it("fails a gray for doing no identity work, whatever its lightness", () => {
    const r = checkColour("#6b6b6b", { mode: "light" });
    expect(r.verdict).toBe("fail");
    expect(r.problems.join(" ")).toMatch(/gray/);
  });

  it("names every problem, not just the first", () => {
    // Very pale and almost gray: out of the band and under the chroma floor.
    const r = checkColour("#f2f0ee", { mode: "light" });
    expect(r.problems.length).toBeGreaterThan(1);
  });
});

describe("snapping to something that works", () => {
  it("keeps the hue exactly", () => {
    for (const hex of ["#ffd7d7", "#001a33", "#7fffd4", "#ff00ff"]) {
      const snapped = snapToPassing(hex, { mode: "light" });
      expect(oklch(snapped).h, hex).toBeCloseTo(oklch(hex).h, 0);
    }
  });

  it("produces a colour nothing disqualifies, in both modes", () => {
    for (const hex of ["#ffd7d7", "#001a33", "#7fffd4", "#ff00ff", "#fafafa", "#020202"]) {
      for (const mode of ["light", "dark"] as const) {
        const snapped = snapToPassing(hex, { mode });
        const r = checkColour(snapped, { mode });
        expect(r.verdict, `${hex} → ${snapped} in ${mode}: ${r.problems.join("; ")}`).not.toBe("fail");
      }
    }
  });

  it("prefers a step that also clears the contrast threshold", () => {
    // Two colours are in band; the one further from the surface is the answer.
    const snapped = snapToPassing("#f7c9c9", { mode: "light" });
    expect(checkColour(snapped, { mode: "light" }).verdict).toBe("pass");
  });

  it("leaves a colour that already passes alone", () => {
    for (const hex of SERIES_LIGHT) {
      expect(snapToPassing(hex, { mode: "light" })).toBe(hex);
    }
  });

  it("raises a gray to the chroma floor rather than giving up on it", () => {
    // There is a hue in there, however faint; the snap commits to it.
    const snapped = snapToPassing("#6b6f6b", { mode: "light" });
    expect(oklch(snapped).c).toBeGreaterThanOrEqual(0.099);
  });
});

describe("checking a whole palette", () => {
  it("clears the shipped palette on both surfaces", () => {
    expect(checkPalette([...SERIES_LIGHT], { mode: "light" }).ok).toBe(true);
    expect(checkPalette([...SERIES_DARK], { mode: "dark", surface: "#171f1e" }).ok).toBe(true);
  });

  it("compares neighbours, because neighbours are what touch", () => {
    const r = checkPalette(["#2a78d6", "#eb6834", "#1baf7a"]);
    expect(r.pairs).toHaveLength(2);
    expect(r.pairs.map((p) => [p.a, p.b])).toEqual([
      ["#2a78d6", "#eb6834"],
      ["#eb6834", "#1baf7a"],
    ]);
  });

  it("fails two colours a full-colour reader cannot tell apart", () => {
    const r = checkPalette(["#2a78d6", "#2f7ad4"]);
    expect(r.ok).toBe(false);
    expect(r.pairs[0]!.verdict).toBe("fail");
    expect(r.pairs[0]!.note).toMatch(/full colour/);
  });

  it("fails a pair that only a colourblind reader would confuse", () => {
    // Distinct to most people, the same colour to a deuteranope — the failure
    // this whole exercise exists to catch, and the one nobody spots by eye.
    const r = checkPalette(["#c85c00", "#7d8f00"]);
    const pair = r.pairs[0]!;
    expect(distance(pair.a, pair.b)).toBeGreaterThan(15);
    expect(pair.verdict).not.toBe("pass");
    expect(pair.note).toMatch(/colourblind/);
  });

  it("holds a single colour to the per-colour checks and no pair checks", () => {
    const r = checkPalette(["#2a78d6"]);
    expect(r.pairs).toHaveLength(0);
    expect(r.ok).toBe(true);
  });

  it("says nothing is wrong with an empty palette", () => {
    expect(checkPalette([]).ok).toBe(true);
  });
});

describe("deriving both modes from one brand palette", () => {
  it("gives each mode its own steps rather than flipping one", () => {
    const brand = ["#003366", "#ff6b00", "#7fffd4"];
    const { light, dark } = derivePalette(brand);
    expect(light).toHaveLength(3);
    expect(dark).toHaveLength(3);

    for (let i = 0; i < brand.length; i++) {
      // The hue is the brand; it survives into both.
      expect(oklch(light[i]!).h).toBeCloseTo(oklch(brand[i]!).h, 0);
      expect(oklch(dark[i]!).h).toBeCloseTo(oklch(brand[i]!).h, 0);
      expect(checkColour(light[i]!, { mode: "light" }).verdict).not.toBe("fail");
      expect(checkColour(dark[i]!, { mode: "dark" }).verdict).not.toBe("fail");
    }
    // And they are genuinely different steps, not the same list twice.
    expect(light).not.toEqual(dark);
  });
});

describe("turning a palette into a stylesheet", () => {
  it("emits all three theme states, scoped to one dashboard", () => {
    const css = seriesCss(["#2a78d6", "#eb6834"], "abc");
    // Bare selector is light; the media query catches the un-stamped "system"
    // default on a dark OS; the attribute selector lets an explicit choice win.
    expect(css).toContain('[data-gw-theme="abc"]{--gw-series-1:#2a78d6;');
    expect(css).toContain('@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) [data-gw-theme="abc"]');
    expect(css).toContain(':root[data-theme="dark"] [data-gw-theme="abc"]');
  });

  it("re-steps a colour that dark mode cannot use", () => {
    // The dark band is narrower than the light one, so a colour near the light
    // band's top has to move. One that sits inside both is left alone in both,
    // which is why the assertion picks a colour that must travel.
    const css = seriesCss(["#eda100"], "abc");
    const [light, dark] = css.split("@media");
    expect(light).toContain("#eda100");
    expect(dark).not.toContain("#eda100");
    expect(oklch("#eda100").l).toBeGreaterThan(0.67);   // above the dark band
  });

  it("drops anything that is not a hex colour before it becomes stylesheet text", () => {
    // These colours come out of a manifest, which is untrusted, and they are
    // about to be concatenated into a <style>. The schema constrains them, but
    // a guard two files from the sink stops holding the moment a manifest is
    // built by hand or a caller skips validation.
    const css = seriesCss(["#2a78d6", "red;} body{display:none} .x{", "#1baf7a"], "abc");
    expect(css).not.toContain("display:none");
    expect(css).not.toContain("body");
    // The colours around it still work.
    expect(css).toContain("--gw-series-1:#2a78d6");
    expect(css).toContain("--gw-series-2:");
  });

  it("cannot be steered by the scope either", () => {
    const css = seriesCss(["#2a78d6"], 'x"]{} body{display:none}[data-gw-theme="y');
    expect(css).not.toContain("display:none");
    expect(css).toContain('[data-gw-theme="xbodydisplaynonedata-gw-themey"]');
  });

  it("emits nothing at all when there is nothing to say", () => {
    expect(seriesCss(undefined, "abc")).toBe("");
    expect(seriesCss([], "abc")).toBe("");
    expect(seriesCss(["not a colour"], "abc")).toBe("");
    expect(seriesCss(["#2a78d6"], "")).toBe("");
    expect(seriesCss(["#2a78d6"], "!!!")).toBe("");
  });

  it("stops at eight, because a ninth hue is one nobody can distinguish", () => {
    const many = Array.from({ length: 12 }, (_, i) => `#${(i * 111111 + 100000).toString(16).padStart(6, "0").slice(0, 6)}`);
    const css = seriesCss(many, "abc");
    expect(css).toContain("--gw-series-8:");
    expect(css).not.toContain("--gw-series-9:");
  });
});

describe("a palette from one brand colour", () => {
  it("leads with the colour it was given", () => {
    const p = paletteFromBrand("#003366");
    expect(p).toHaveLength(8);
    // Snapped into the readable band, but recognisably the same hue.
    expect(oklch(p[0]!).h).toBeCloseTo(oklch("#003366").h, 0);
  });

  it("produces a palette that passes, from any hue at all", () => {
    // Rotating a palette is not distance-preserving — OKLab is perceptual, not
    // a circle — so a fifth of all hues land with a pair too close together and
    // have to be repaired. This is the test that says the repair actually works.
    const failures: string[] = [];
    for (let h = 0; h < 360; h += 15) {
      for (const [l, c] of [[0.55, 0.15], [0.65, 0.12], [0.45, 0.18]] as const) {
        const seed = toHex({ l, c, h });
        const palette = paletteFromBrand(seed);
        const light = checkPalette(palette, { mode: "light" });
        const darkBad = derivePalette(palette).dark
          .filter((x) => checkColour(x, { mode: "dark" }).verdict === "fail");
        if (!light.ok) {
          failures.push(`${seed}: ${light.pairs.filter((x) => x.verdict === "fail").map((x) => x.note).join("; ")}`);
        }
        if (darkBad.length) failures.push(`${seed}: dark ${darkBad.join(",")}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("never moves a hue to satisfy a check", () => {
    // Lightness is what gives. A palette that drifted off the brand hue to pass
    // would have solved the wrong problem.
    const brand = "#cd6e7e";                       // a hue that needs repairing
    const palette = paletteFromBrand(brand);
    const structure = SERIES_LIGHT.map((x) => oklch(x).h);
    const shift = (oklch(brand).h - structure[0]!) % 360;
    palette.forEach((hex, i) => {
      expect(oklch(hex).h, `slot ${i}`).toBeCloseTo((structure[i]! + shift + 360) % 360, 0);
    });
  });
});

describe("the starting sets", () => {
  it("ships nothing that fails its own checks", () => {
    for (const [key, preset] of Object.entries(PRESETS)) {
      const r = checkPalette(preset.colors, { mode: "light" });
      const bad = [
        ...r.colours.filter((c) => c.verdict === "fail").map((c) => `${c.hex}: ${c.problems.join("; ")}`),
        ...r.pairs.filter((p) => p.verdict === "fail").map((p) => `${p.a}/${p.b}: ${p.note}`),
      ];
      expect(bad, `${key} — ${bad.join(" | ")}`).toEqual([]);
    }
  });

  it("survives the trip into dark mode", () => {
    for (const [key, preset] of Object.entries(PRESETS)) {
      const dark = derivePalette(preset.colors).dark;
      for (const hex of dark) {
        const r = checkColour(hex, { mode: "dark" });
        expect(r.verdict, `${key} ${hex}: ${r.problems.join("; ")}`).not.toBe("fail");
      }
    }
  });
});

describe("the sequential ramp", () => {
  it("steps monotonically, far enough apart to see", () => {
    for (const mode of ["light", "dark"] as const) {
      const ramp = rampFrom("#2a78d6", mode);
      const ls = ramp.map((h) => oklch(h).l);
      const rising = mode === "dark";
      for (let i = 1; i < ls.length; i++) {
        expect(rising ? ls[i]! > ls[i - 1]! : ls[i]! < ls[i - 1]!, `${mode} step ${i}`).toBe(true);
        // Below about 0.06 two shades of one hue stop being separable.
        expect(Math.abs(ls[i]! - ls[i - 1]!), `${mode} step ${i}`).toBeGreaterThan(0.06);
      }
    }
  });

  it("keeps one hue from end to end — a rainbow invents an order", () => {
    // Hue is an angle, so the difference is around the circle: a ramp near red
    // has steps at 359° and 1°, which are two degrees apart and not 358.
    const apart = (a: number, b: number): number => {
      const d = Math.abs(a - b) % 360;
      return d > 180 ? 360 - d : d;
    };
    for (const seed of ["#eb6834", "#e34948", "#2a78d6"]) {
      const hues = rampFrom(seed).map((h) => oklch(h).h);
      // Some drift is inevitable: a step whose chroma the screen cannot show
      // gets clamped, and eight-bit rounding moves the angle a little. Two
      // degrees is far below anything an eye reads as a different colour.
      for (const h of hues) expect(apart(h, hues[0]!), seed).toBeLessThan(2);
    }
  });

  it("runs the other way in dark mode, because more means further from the surface", () => {
    expect(oklch(rampFrom("#2a78d6", "light")[0]!).l)
      .toBeGreaterThan(oklch(rampFrom("#2a78d6", "light")[6]!).l);
    expect(oklch(rampFrom("#2a78d6", "dark")[0]!).l)
      .toBeLessThan(oklch(rampFrom("#2a78d6", "dark")[6]!).l);
  });

  it("stays visible against the surface at the near end", () => {
    // A step that matches the background is not a low value, it is a missing
    // cell, and a heatmap must not conflate the two.
    expect(contrast(rampFrom("#2a78d6", "light")[0]!, "#ffffff")).toBeGreaterThan(1.35);
    expect(contrast(rampFrom("#2a78d6", "dark")[0]!, "#171f1e")).toBeGreaterThan(1.35);
  });

  it("gives every step an ink that is readable on it", () => {
    // Chosen by measuring, not by a threshold on the step index: the ramp
    // inverts between modes, so one threshold cannot serve both. A mid-blue
    // cell in dark mode came out at 2.33:1 under the threshold version.
    for (const mode of ["light", "dark"] as const) {
      for (const step of rampFrom("#2a78d6", mode)) {
        const ink = inkFor(step, INK_CANDIDATES[mode]);
        expect(contrast(step, ink), `${mode} ${step}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("holds up for any brand hue, not just the default", () => {
    for (let h = 0; h < 360; h += 30) {
      const seed = toHex({ l: 0.55, c: 0.15, h });
      for (const mode of ["light", "dark"] as const) {
        for (const step of rampFrom(seed, mode)) {
          const ink = inkFor(step, INK_CANDIDATES[mode]);
          // 4.5:1 is what normal-size text needs, and it holds for every hue.
          expect(contrast(step, ink), `${mode} ${seed} ${step}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("emits an ink beside every step in the theme stylesheet", () => {
    const css = seriesCss(["#7a1fa2"], "abc");
    for (let i = 1; i <= 7; i++) {
      expect(css).toContain(`--gw-ramp-${i}:`);
      expect(css).toContain(`--gw-ramp-${i}-ink:`);
    }
  });
});
