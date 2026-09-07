import { Report } from "@gridwright/react";
import { reconcile, type AnalysisSnapshot } from "./snapshot.js";

/**
 * The chat and the report, side by side, reading one snapshot (task T16).
 *
 * There is no state in this component and no fetching. Both are deliberate: a
 * surface that can fetch is a surface that can disagree with the one next to
 * it, and R18's whole point is that they cannot. Everything drawn here comes
 * from the frozen snapshot it was handed.
 *
 * Two presentation rules follow from the requirements rather than taste.
 *
 * **Evidence is visible, not available.** A05 requires every displayed material
 * value to link to a receipt. A tooltip satisfies the letter of that and misses
 * it entirely — nobody hovers to check a number they already believe. So the
 * receipt is drawn next to the figure, in small type, always.
 *
 * **A disagreement is louder than the numbers.** When reconciliation fails, the
 * problems are the first thing on the page. The alternative — showing the
 * numbers with a quiet warning underneath — is how a page gets screenshotted
 * without the warning.
 */

export interface WorkspaceProps {
  snapshot: AnalysisSnapshot;
  title?: string;
  locale?: string;
}

function Scope({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const { scope } = snapshot;
  const filters = scope.filters.flatMap((f) => f.values.map((v) => `${f.dimension}: ${v}`));
  return (
    <dl className="gww-scope" data-testid="scope">
      <div>
        <dt>Period</dt>
        <dd data-testid="period">{scope.period.label}</dd>
      </div>
      <div>
        <dt>Compared with</dt>
        <dd data-testid="comparison">{scope.comparison.label}</dd>
      </div>
      <div>
        <dt>Filters</dt>
        <dd data-testid="filters">{filters.length > 0 ? filters.join(" · ") : "none"}</dd>
      </div>
      <div>
        <dt>Definitions</dt>
        <dd data-testid="semantic-version">{snapshot.versions.semantic}</dd>
      </div>
    </dl>
  );
}

function Answer({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const byId = new Map(snapshot.values.map((v) => [v.id, v]));

  if (snapshot.claims.length === 0) {
    return (
      <p className="gww-empty" data-testid="no-answer">
        No certified claim was produced for this question.
      </p>
    );
  }

  return (
    <ul className="gww-claims" data-testid="claims">
      {snapshot.claims.map((claim, i) => {
        const value = byId.get(claim.valueId);
        return (
          <li key={i} className="gww-claim" data-claim={claim.valueId}>
            <p className="gww-statement">{claim.statement}</p>
            <p className="gww-receipt" data-testid={`receipt-${i}`}>
              {/* Drawn, not hovered: nobody checks a number they believe. */}
              {claim.receiptId ? (
                <>
                  <span className="gww-receipt-label">receipt</span>{" "}
                  <code>{claim.receiptId}</code>
                  {value?.source ? <> · {value.source}</> : null}
                </>
              ) : (
                <span className="gww-untraceable">no receipt — this figure cannot be traced</span>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function Evidence({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const context = snapshot.context;
  if (!context) return null;

  if (context.decision === "denied") {
    return (
      <p className="gww-denied" data-testid="context-denied">
        Context for this question is restricted for the current scope. It exists; it was not
        returned.
      </p>
    );
  }

  return (
    <div className="gww-evidence" data-testid="evidence">
      <h3>Approved context</h3>
      <ul>
        {context.objects.map((o) => (
          <li key={o.id} data-object={o.id}>
            <strong>{o.title}</strong>
            {o.summary ? <> — {o.summary}</> : null}
          </li>
        ))}
      </ul>
      {context.citations.length > 0 && (
        <ul className="gww-citations" data-testid="citations">
          {context.citations.map((c, i) => (
            <li key={i}>
              <q>{c.quote}</q>{" "}
              <span className="gww-source">
                {c.title ?? c.source_id}
                {c.source_version_id ? ` · ${c.source_version_id}` : ""}
                {c.locator ? ` · ${c.locator}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {context.caveats.length > 0 && (
        <ul className="gww-caveats" data-testid="caveats">
          {context.caveats.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
      <p className="gww-freshness" data-testid="freshness">
        Sources are {context.freshness.status}
        {context.freshness.oldest_source_age_days !== undefined
          ? `, oldest ${context.freshness.oldest_source_age_days} days`
          : ""}
        .
      </p>
    </div>
  );
}

export function Workspace({ snapshot, title, locale }: WorkspaceProps) {
  const problems = reconcile(snapshot);

  return (
    <div className="gww-root" data-testid="workspace" data-snapshot={snapshot.snapshotId}>
      <header className="gww-head">
        <h1>{title ?? snapshot.question}</h1>
        <Scope snapshot={snapshot} />
      </header>

      {/* First on the page, deliberately. A quiet warning under the numbers is
          how a page gets screenshotted without the warning. */}
      {problems.length > 0 && (
        <div className="gww-disagreement" role="alert" data-testid="disagreement">
          <strong>
            {problems.length === 1
              ? "One figure on this page cannot be reconciled"
              : `${problems.length} figures on this page cannot be reconciled`}
          </strong>
          <ul>
            {problems.map((p, i) => (
              <li key={i} data-code={p.code}>
                <em>{p.between}</em> — {p.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!snapshot.complete && (
        <p className="gww-partial" role="status" data-testid="partial">
          This is a partial answer: {snapshot.completeness}.
        </p>
      )}

      <div className="gww-body">
        <section className="gww-chat" aria-label="Answer">
          <h2>Answer</h2>
          <Answer snapshot={snapshot} />
          <Evidence snapshot={snapshot} />
        </section>

        <section className="gww-report" aria-label="Report">
          <h2>Report</h2>
          {snapshot.report ? (
            <div className="gww-table-scroll">
            <Report
              result={snapshot.report}
              {...(locale ? { locale } : {})}
              periodLabels={{
                [snapshot.report.periods[0] ?? "actual"]: snapshot.scope.period.label,
                [snapshot.report.periods[1] ?? "comparison"]: snapshot.scope.comparison.label,
              }}
            />
            </div>
          ) : (
            <p className="gww-empty" data-testid="no-report">
              No report was configured for this question.
            </p>
          )}
        </section>
      </div>

      {snapshot.diagnostics.length > 0 && (
        <ul className="gww-diagnostics" data-testid="diagnostics">
          {snapshot.diagnostics.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
