import type { FilledCell, FilledRow, ReportResult } from "@gridwright/bridge";

/**
 * Renders a filled bridge report.
 *
 * The skeleton decided this table's shape long before any data arrived, so
 * this component draws what it is given and never edits it: no filtering out
 * empty rows, no reordering, no substituting a value for a missing one. R14
 * survives here or it survives nowhere, because this is the last place it
 * could be broken.
 *
 * Two presentation decisions follow from the requirements rather than taste.
 *
 * **A missing value is drawn as missing.** An em dash with a screen-reader
 * label, in the muted ink — never an empty cell, which reads as a zero someone
 * forgot to format, and never 0, which is a measurement the source did not
 * make. Where the blank policy supplied a number the number is shown, and the
 * cell still carries `data-availability="not_available"` so the distinction is
 * inspectable.
 *
 * **A variance is not coloured good or bad.** The obvious thing is green for
 * up and red for down, and it would be wrong here: R09 puts polarity in the
 * approved metric definition, and this fixture's is `unset`. Colouring +20
 * green would assert something nobody approved. The sign is shown; the
 * judgement is not.
 */

export interface ReportProps {
  result: ReportResult;
  /** Report heading. */
  title?: string;
  /** Column labels, keyed by period name. Falls back to the period's own name. */
  periodLabels?: Record<string, string>;
  /** Locale for number formatting. */
  locale?: string;
}

const INDENT_STEP = 14;

function formatNumber(n: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
}

/** A signed number, so a variance reads as a direction without asserting a verdict. */
function formatSigned(n: number, locale?: string): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${formatNumber(Math.abs(n), locale)}`;
}

function Cell({
  cell,
  signed,
  locale,
}: {
  cell: FilledCell;
  signed?: boolean;
  locale?: string;
}) {
  const missing = cell.value === null;
  return (
    <td
      className={`gw-rpt-num${missing ? " gw-rpt-missing" : ""}`}
      data-availability={cell.availability}
    >
      {missing ? (
        <>
          <span aria-hidden="true">—</span>
          <span className="gw-sr-only">not available</span>
        </>
      ) : signed ? (
        formatSigned(cell.value!, locale)
      ) : (
        formatNumber(cell.value!, locale)
      )}
    </td>
  );
}

function Row({
  row,
  periods,
  locale,
}: {
  row: FilledRow;
  periods: string[];
  locale?: string;
}) {
  return (
    <tr className={`gw-rpt-row gw-rpt-${row.kind}`} data-row-key={row.rowKey}>
      <th scope="row" style={{ paddingLeft: 10 + row.indent * INDENT_STEP }}>
        {row.heading}
      </th>
      {periods.map((p) => (
        <Cell key={p} cell={row.cells[p]!} locale={locale} />
      ))}
      <Cell cell={row.variance} signed locale={locale} />
    </tr>
  );
}

export function Report({ result, title, periodLabels, locale }: ReportProps) {
  const label = (p: string) => periodLabels?.[p] ?? p;

  return (
    <div className="gw-root gw-rpt">
      {title && <h1 className="gw-title">{title}</h1>}
      <table className="gw-rpt-table">
        <thead>
          <tr>
            <th scope="col" className="gw-rpt-head-row">
              &nbsp;
            </th>
            {result.periods.map((p) => (
              <th key={p} scope="col">
                {label(p)}
              </th>
            ))}
            <th scope="col">Variance</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <Row key={row.rowKey} row={row} periods={result.periods} locale={locale} />
          ))}
        </tbody>
      </table>

      {result.diagnostics.length > 0 && (
        <ul className="gw-rpt-notes">
          {result.diagnostics.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
