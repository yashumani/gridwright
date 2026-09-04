import { useMemo, useState } from "react";
import type { Manifest, ThemeDef } from "@gridwright/schema";
import {
  PRESETS, checkPalette, derivePalette, paletteFromBrand, parseHex, parsePalette,
  snapToPassing, type Mode, type PaletteReport,
} from "@gridwright/panels";

/**
 * Brand colours, edited.
 *
 * The ask this answers is "make it our colours", and the naive version of that
 * — a row of colour inputs that writes whatever you pick — produces dashboards
 * that some readers cannot read, quietly and without anyone noticing. A brand
 * palette is chosen against a logo at poster size; a chart uses those hues as
 * identity, small, adjacent, on one surface.
 *
 * So this takes the hexes and then *says something about them*. Anything that
 * would disappear into the background, read as gray, or be indistinguishable
 * from its neighbour is named, with the nearest colour in the same hue that
 * works offered as a one-click fix. Nothing is refused; the choice stays the
 * author's, and the consequence is on screen before they publish rather than in
 * a support thread afterwards.
 */

export interface ThemeEditorProps {
  manifest: Manifest;
  apply: (theme: ThemeDef | undefined) => void;
}

export function ThemeEditor({ manifest, apply }: ThemeEditorProps) {
  const colours = manifest.theme?.colors ?? [];
  const [draft, setDraft] = useState<string | null>(null);
  const [brand, setBrand] = useState("#1e6f5c");
  const [mode, setMode] = useState<Mode>("light");

  const report = useMemo(
    (): PaletteReport => checkPalette(colours, { mode }),
    [colours, mode],
  );

  const setColours = (next: readonly string[]) =>
    apply(next.length ? { ...manifest.theme, colors: [...next] } : undefined);

  const replaceAt = (i: number, hex: string) =>
    setColours(colours.map((c, j) => (j === i ? hex : c)));

  /** Everything the report flagged as disqualifying, fixed in one go. */
  const fixable = report.colours.filter((c) => c.suggestion);

  return (
    <div className="gwb-theme">
      <p className="gwb-hint gwb-modelnote">
        The colours the charts draw with, in order. The first one is used
        wherever there is a single series, so make it the one you want most.
      </p>

      <details className="gwb-section" open>
        <summary>Your colours <span className="gwb-count">{colours.length}</span></summary>

        {colours.length === 0 && (
          <p className="gwb-hint">
            Using the built-in palette. Paste your brand colours below, or start
            from one of the sets.
          </p>
        )}

        {report.colours.map((c, i) => (
          <div className="gwb-swatchrow" key={`${c.hex}-${i}`}>
            <input
              type="color"
              className="gwb-swatch"
              aria-label={`Colour ${i + 1}`}
              value={c.hex}
              onChange={(e) => replaceAt(i, e.target.value)}
            />
            <input
              className="gwb-input gwb-hex"
              aria-label={`Colour ${i + 1} hex`}
              value={c.hex}
              spellCheck={false}
              onChange={(e) => {
                const parsed = parsePalette(e.target.value);
                if (parsed[0]) replaceAt(i, parsed[0]);
              }}
            />
            <span className={`gwb-verdict gwb-verdict-${c.verdict}`}>
              {c.verdict === "pass" ? "Good" : c.verdict === "warn" ? "Soft" : "Problem"}
            </span>
            <button
              type="button"
              className="gwb-mini gwb-danger"
              aria-label={`Remove colour ${i + 1}`}
              onClick={() => setColours(colours.filter((_, j) => j !== i))}
            >
              Remove
            </button>
            {c.problems.length > 0 && (
              <p className="gwb-hint gwb-verdict-note">
                {c.problems.join(". ")}.
                {c.suggestion && (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="gwb-mini"
                      onClick={() => replaceAt(i, c.suggestion!)}
                    >
                      Use {c.suggestion}
                    </button>
                  </>
                )}
              </p>
            )}
          </div>
        ))}

        {fixable.length > 1 && (
          <button
            type="button"
            className="gwb-mini gwb-primary"
            onClick={() => setColours(colours.map((c) => snapToPassing(c, { mode })))}
          >
            Fix all {fixable.length}
          </button>
        )}

        {/* Neighbours are what touch in a chart, so neighbours are what get
            compared. A pair nobody can tell apart is a failure of the palette,
            not of the reader. */}
        {report.pairs.some((p) => p.verdict !== "pass") && (
          <div className="gwb-pairs">
            {report.pairs.filter((p) => p.verdict !== "pass").map((p, i) => (
              <p className={`gwb-hint gwb-verdict-note gwb-verdict-${p.verdict}`} key={i}>
                <span className="gwb-dot" style={{ background: p.a }} aria-hidden="true" />
                <span className="gwb-dot" style={{ background: p.b }} aria-hidden="true" />
                {p.a} beside {p.b}: {p.note}.
              </p>
            ))}
          </div>
        )}
      </details>

      {/* The question most people actually have. One colour is what a brand
          hands you; eight that work together is what a chart needs, and
          inventing the other seven by eye is where it goes wrong. */}
      <details className="gwb-section" open={colours.length === 0}>
        <summary>Build from your brand colour</summary>
        <p className="gwb-hint">
          Give it your main colour and it fills in seven more at the spacing that
          keeps them apart — including for the one reader in twelve who cannot
          separate red from green.
        </p>
        <div className="gwb-swatchrow gwb-brandrow">
          <input
            type="color"
            className="gwb-swatch"
            aria-label="Brand colour"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
          <input
            className="gwb-input gwb-hex"
            aria-label="Brand colour hex"
            value={brand}
            spellCheck={false}
            onChange={(e) => {
              const parsed = parseHex(e.target.value) ?? e.target.value;
              setBrand(parsed);
            }}
          />
          <button
            type="button"
            className="gwb-mini gwb-primary"
            disabled={!parseHex(brand)}
            onClick={() => setColours(paletteFromBrand(parseHex(brand)!, { mode }))}
          >
            Build palette
          </button>
        </div>
        {parseHex(brand) && (
          <div className="gwb-ramp" aria-hidden="true">
            {paletteFromBrand(parseHex(brand)!, { mode }).map((c, i) => (
              <span key={i} style={{ background: c }} title={c} />
            ))}
          </div>
        )}
      </details>

      <details className="gwb-section">
        <summary>Paste a set of colours</summary>
        <p className="gwb-hint">
          Hex codes, however they come — commas, spaces or one per line. Up to eight;
          a ninth series folds into “Other” rather than inventing a colour nobody
          can distinguish.
        </p>
        <textarea
          className="gwb-input gwb-paste"
          rows={3}
          spellCheck={false}
          placeholder="#003366  #ff6b00  #7fffd4"
          value={draft ?? colours.join("  ")}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="gwb-pair">
          <button
            type="button"
            className="gwb-mini gwb-primary"
            disabled={draft === null}
            onClick={() => {
              const parsed = parsePalette(draft ?? "");
              setColours(parsed.slice(0, 8));
              setDraft(null);
            }}
          >
            Apply
          </button>
          <button
            type="button"
            className="gwb-mini"
            disabled={draft === null}
            onClick={() => setDraft(null)}
          >
            Cancel
          </button>
        </div>
      </details>

      <details className="gwb-section">
        <summary>Start from a set</summary>
        <div className="gwb-presets">
          {Object.entries(PRESETS).map(([key, preset]) => (
            <button
              type="button"
              key={key}
              className="gwb-preset"
              onClick={() => setColours(preset.colors)}
            >
              <span className="gwb-preset-swatches" aria-hidden="true">
                {preset.colors.slice(0, 6).map((c, i) => (
                  <span key={i} style={{ background: c }} />
                ))}
              </span>
              {preset.label}
            </button>
          ))}
        </div>
        {colours.length > 0 && (
          <button type="button" className="gwb-mini" onClick={() => setColours([])}>
            Back to the built-in palette
          </button>
        )}
      </details>

      {colours.length > 0 && (
        <details className="gwb-section">
          <summary>How they land in dark mode</summary>
          <p className="gwb-hint">
            Dark mode is not the light palette inverted — the readable range is
            different and narrower, so each colour is re-stepped against the dark
            background. Same hues, different steps.
          </p>
          <div className="gwb-modes">
            {(["light", "dark"] as const).map((m) => (
              <div key={m}>
                <span className="gwb-hint">{m === "light" ? "Light" : "Dark"}</span>
                <div className="gwb-ramp">
                  {derivePalette(colours)[m].map((c, i) => (
                    <span key={i} style={{ background: c }} title={c} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="gwb-pair">
            <label className="gwb-label" htmlFor="gwb-checkmode">Check against</label>
            <select
              id="gwb-checkmode"
              className="gwb-input"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="light">Light background</option>
              <option value="dark">Dark background</option>
            </select>
          </div>
        </details>
      )}
    </div>
  );
}
