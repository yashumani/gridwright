# Panels

A panel is a component plus **a schema for its own props**. That single decision
carries both halves of the product: the renderer validates a manifest's `props`
against it, and the builder generates the property form from it. A new panel
type extends the manifest language without touching the core, and nobody
hand-writes a config UI.

```bash
gridwright panels    # what is registered, with descriptions
```

## Which form answers which question

Pick the form from the reader's job, not from what looks good. The example
[`chart-types.gw.yaml`](../examples/chart-types.gw.yaml) lays all of these out
side by side.

| The reader has to… | Use | Not |
|---|---|---|
| Read one current number | `kpi`, with `sparkline` for the shape behind it | a one-bar bar chart |
| Compare magnitudes across a category | `bar` | a pie |
| Follow a change over time | `line` | a bar per month |
| Notice that **one** of them is the point | `bar` with `emphasise` | eight competing hues |
| See what each category is made of | `stack` | a pie per category |
| Compare the mix rather than the totals | `stack` with `mode: share` | reading percentages off a table |
| Find the hot spot across two dimensions | `heatmap` | a grouped bar with twenty groups |
| Check the actual numbers | `table` | squinting at a chart |

## What ships

### `kpi` — a single headline number

```yaml
- { id: kpi_rev, type: kpi, dataset: totals,
    layout: { x: 0, y: 0, w: 3, h: 2 },
    props: { measure: revenue, caption: All channels } }
```

| Prop | Type | Notes |
|---|---|---|
| `measure` | string | Which column to show. |
| `caption` | string | Small text under the value. |
| `delta` | string | A second measure shown as a change against the headline. |
| `invertTrend` | boolean | Down is good — return rate, cost, churn. |
| `sparkline` | boolean | Draw the measure's own history behind the number. |

**A number alone says where you are and nothing about how you got there.** 8.4%
could be the best month on record or the worst. `sparkline` costs one line of
ink and answers that; point it at a dataset with a dimension to run along — the
same one a trend chart would use — and it does nothing quietly when the dataset
is a single total.

With a series present the headline is that series' **last** point, not its
first: a KPI beside a trend means "now", not "when the window opened".

Minimum size 2×2.

### `table` — rows of dimensions and measures

```yaml
props:
  columns:
    - { ref: region }
    - { ref: revenue, align: right }
    - { ref: rev_share, align: right, bar: true }
  rules:
    - { when: "revenue > 250000", style: { weight: bold } }
  zebra: true
```

| Prop | Type | Notes |
|---|---|---|
| `columns[].ref` | string | Dimension or measure id. Max 64 columns. |
| `columns[].label` | string | Overrides the model's label. |
| `columns[].align` | `left`\|`right`\|`center` | Defaults by kind: measures right, dimensions left. |
| `columns[].bar` | boolean | Draws an in-cell magnitude bar behind the value. |
| `rules[].when` | expression | Max 16. See below. |
| `rules[].style` | `{ weight, tone }` | `weight`: `bold`\|`normal`. `tone`: `good`\|`bad`\|`muted`. |
| `zebra` | boolean | Default true. |

Rules reuse the expression parser with its binding inverted: a bare identifier
is a **result column** here, not a raw field, and only scalars are allowed —
there is nothing left to aggregate at render time.

Minimum size 4×3.

### `bar` — a measure across one dimension

```yaml
props: { category: channel, value: revenue, orientation: horizontal, showValues: true }
```

| Prop | Type | Notes |
|---|---|---|
| `category` | string | The dimension. |
| `value` | string | The measure. |
| `orientation` | `horizontal`\|`vertical` | Default `horizontal` — category labels are words, and rotating them under vertical bars is the usual reason a bar chart becomes unreadable. |
| `showValues` | boolean | Direct value labels. |
| `maxBars` | integer 1–200 | Keep only the largest N. |
| `emphasise` | string | One category value drawn in the accent colour, the rest recessed. |

**`emphasise` is the most underused thing here.** When the story is "this one
went up", a chart where every bar competes for attention buries it. Highlighting
one and recessing the rest says it in the encoding rather than in a caption
nobody reads. A live selection overrides it, since both mean the same thing:
one mark forward, the rest back.

Minimum size 3×3.

### `line` — change over an ordered dimension

```yaml
props: { x: month, y: [revenue, forecast], area: false, markers: true }
```

| Prop | Type | Notes |
|---|---|---|
| `x` | string | The ordered dimension. |
| `y` | string[] | 1–8 measures. |
| `area` | boolean | Fill under the line. Single series only. |
| `markers` | boolean | Defaults to on for 24 points or fewer. |

**One y-axis, always.** Two measures on different scales get two panels or a
common indexed base. A second axis makes any pair of lines cross wherever the
author's scaling happened to put them, which is why it is the most misread
chart there is.

Minimum size 4×3.

### `stack` — what each category is made of

```yaml
props: { category: channel, values: [orders, returns], mode: total }
```

| Prop | Type | Notes |
|---|---|---|
| `category` | string | The bars. |
| `values` | string[] | 1–8 measures, one segment each, in order. |
| `mode` | `total`\|`share` | `share` normalises every bar to full width. |
| `orientation` | `horizontal`\|`vertical` | Default `horizontal`. |
| `maxBars` | integer 1–200 | |

The form a pie chart is usually reaching for. A pie compares angles, which
people read badly, and shows one whole; this compares lengths against a shared
baseline and shows a whole per category, so "how big" and "what it is made of"
arrive together.

**`total` and `share` answer different questions.** `share` throws the totals
away and makes the mix the only story, which is right when the mix *is* the
story and misleading when one category has forty rows and another forty
thousand. The total travels with each bar either way, so the comparison stays
honest.

**The segments have to share a unit.** Revenue stacked on an order count is
metres plus seconds; the chart cannot tell, and draws one segment at 99.9% and a
sliver, which reads as a finding rather than a mistake. Segments whose `format`
differs get a note saying so.

A negative value cannot be stacked — there is no sensible place to draw it — so
it reads as absent rather than being flipped or folded into its neighbour.

Minimum size 4×4.

### `heatmap` — one number across two dimensions

```yaml
props: { x: channel, y: region, value: revenue, showValues: true }
```

| Prop | Type | Notes |
|---|---|---|
| `x` | string | Dimension across the top. |
| `y` | string | Dimension down the side. |
| `value` | string | The measure the shade encodes. |
| `showValues` | boolean | Default on, and dropped automatically where a cell is too small to hold a number. |
| `maxColumns`, `maxRows` | integer 1–60 | |

Nothing else here shows two dimensions at once. A grouped bar chart manages
about four groups before it becomes a picket fence; this keeps reading at twenty
by twenty, because position tells the cells apart and colour only has to carry
magnitude.

**The shade is sequential — one hue, light to dark.** That is what makes the
form safe: more is darker needs no legend to learn, whereas a rainbow invents an
order the eye does not agree on and forces a lookup per cell. The ramp follows
the theme's first colour and re-anchors in dark mode, where "more" means
*lighter* — further from the background either way.

**The scale spans the data, not zero.** A grid of values between 183k and 261k
anchored at zero is one flat block. Both ends are printed under the grid, so the
range is stated rather than implied.

A combination the query returned no row for is drawn as an absence, not as zero.

Minimum size 4×4.

## Reading a value

Every chart answers on hover, and answers the same way from the keyboard.

- **Bar, stacked bar and heatmap** show the mark's own number on hover, and the
  mark is reachable with Tab and activated with Enter or Space.
- **Line** takes focus as a whole: arrows walk the points, Home and End jump to
  the ends, Escape clears. Focus lands on the most recent point, because that is
  the one people came for.
- The readout is a live region, so what a sighted reader sees appear is what a
  screen reader is told. It sits in the panel's corner rather than following the
  cursor, so it never covers the thing being read.
- **A tooltip is never the only way to a value.** Bars carry direct labels,
  heatmap cells print their number, and the `table` panel exists.

## Colour

The rules the shipped panels follow, and which reviews will hold a new panel to:

- **A validated categorical palette, assigned in fixed order and never cycled.**
  Use `seriesVar(i)` from `packages/panels/src/theme.ts`. Do not generate hues:
  a generated ninth colour is either indistinguishable from an existing one or
  fails contrast, and usually both.
- **A ninth series folds to "Other"** rather than inventing a colour.
- **Identity is never colour alone.** Two or more series means a legend, direct
  labels, or both. Roughly one in twelve men has a colour-vision deficiency, and
  a legend is cheap.
- **Dark mode is selected from the palette's dark column** against the dark
  surface, not flipped. Inverting a light palette produces colours that are
  technically distinct and visually muddy.
- **Relief.** Bars carry direct value labels and a table view exists, so any
  encoding that cannot carry enough contrast on its own is still readable as
  numbers.

The brand verdigris `#1E6F5C` was measured against the chroma floor, failed it —
it reads grey in a chart — and is confined to UI chrome. That is the kind of
finding the palette validator exists to produce.

## Adding your own

Register a panel and it gains manifest validation and a builder form for free:

```tsx
import { defaultRegistry } from "@gridwright/panels";
import { obj, str, opt, bool } from "@gridwright/schema";

const registry = defaultRegistry().register({
  type: "gauge",
  label: "Gauge",
  description: "A single measure against a target.",
  schema: obj({ measure: str({ minLength: 1 }), target: str(), showBand: opt(bool()) }),
  defaults: (result) => ({ measure: result.columns[0]!.id, target: "" }),
  Component: MyGauge,
  minSize: { w: 3, h: 3 },
});

<Dashboard manifest={manifest} source={source} registry={registry} />
```

Your component receives:

```tsx
interface PanelProps<P> {
  result: QueryResult;                    // columns and columnar data
  props: P;                               // validated against your schema
  size: { width: number; height: number };// the measured content box, in real pixels
  select(dimensionId, value, row?): void; // emit a selection
  selected: Record<string, readonly Value[]>;
  title?: string;
  locale?: string;
}
```

Four things to get right:

1. **Draw at real pixels.** `size` is the measured box. Scaling a fixed viewBox
   stretches every label.
2. **Pass the clicked row to `select`.** An interaction may target a dimension
   other than the one you emitted, and it needs that dimension's own value from
   the same row — filtering `channel` by a region name empties the dashboard
   rather than narrowing it.
3. **Handle empty and truncated results.** `result.rowCount` can be 0 and
   `result.truncated` can be true. Say so; do not draw nothing.
4. **Use `requireColumn`** to resolve a prop to a column. It produces the error
   message the renderer and the CLI both show, naming the path and what was
   available.

See [CONTRIBUTING](../CONTRIBUTING.md#adding-a-panel-type) for the full
walkthrough, and open a
[panel proposal](https://github.com/yashumani/gridwright/issues/new?template=panel.yml)
if you want the design settled before writing SVG.
