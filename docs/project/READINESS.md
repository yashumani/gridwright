# Readiness report

2026-09-07 · against `main` · 1,044 passing tests, CI green

[Requirements](UNIFIED_PLATFORM_REQUIREMENTS.md) · [Delivery](DELIVERY_AND_ACCEPTANCE.md) · [Architecture](ARCHITECTURE_AND_CONTRACTS.md) · [Sources and decisions](SOURCE_MAP_AND_DECISIONS.md)

This is task T20's deliverable: a truthful account of what is ready, what is
not, and what the difference depends on. It is written to be useful to someone
deciding whether to put this in front of a real user, which means the second
half matters more than the first.

## The one-paragraph version

The metadata bridge works end to end and is proven against a fixture whose
numbers were fixed before any code was written. The governance layer — typed
handoffs, a capability gate, a bounded run, scoped sessions, action-bound
approvals — is built and tested. The clients for the knowledge, conversational
and variance services are built against those projects' real contracts and pass
a conformance suite. **No service has been contacted.** Every adapter takes an
injected transport, and the evidence is against fixtures shaped from those
contracts, so what is established is that the clients speak the contracts as
written — not that any deployment answers. Gates G0, G1 and G2 are met. G3 needs
a private environment that does not exist yet, and that is an access decision
rather than an engineering one.

## What is ready

**The bridge.** An Excel skeleton plus SQL configuration metadata plus explicit
bindings compile to a validated report definition, fill from a prepared view,
and render in React. Configured headings, order, hierarchy and empty rows
survive whatever the query returns — the golden fixture has a queue the view
returns nothing for, and it is on the screen. Calculations go through the
governed expression system, and an unsupported rule, a cycle, an unknown
reference or a division by zero is refused by name.

**The numbers are the ones the plan fixed in advance.** Actual 120 against
comparison 100, contributions +10 and +10, a third queue with no data, polarity
`unset` because nobody approved a direction. Asserted, not described.

**Configuration is authoritative.** A label, a calculation or a binding changes
and the definition regenerates with no bridge code touched. A second compatible
view binds and reconciles; an incompatible one is refused with the column it
lacks. Invalid drafts stay apart from the last valid version, and rollback
discards only drafts.

**The governance layer.** Identity comes from authenticated service context and
an envelope carrying one is refused as malformed. Capability checks run in a
fixed, tested order and a policy outage fails closed. One run owns one budget,
cancellation reaches a call in flight, and a specialist has no way to start
another run. Sessions recheck authorization on retrieval; the cache key carries
the whole boundary. Approvals are bound to an actor, an action and an input
digest, are single-use, and read-only cannot publish.

**Everything external is treated as data.** Workbook expansion, cells, rows,
query results, payloads and capability arguments are bounded; a result over a
limit is refused rather than truncated. Configuration cells, context packs,
certified answers, analysis narratives and capability results are scanned for
text that is trying to be read as an instruction.

**The surfaces agree.** One frozen analysis snapshot sits behind the answer and
the report, and `reconcile` compares the certified claim, the analysis and the
bridge's total row. A value with no receipt is reported even when the number is
right.

## What is not ready, and why

**No service has been contacted.** This is the single most important sentence in
this document. `@gridwright/adapters` holds real clients for UKB, Talk2Data and
the variance product, built from those repositories' own contracts. Each takes
an injected transport. The conformance evidence is against fixtures shaped from
those contracts. A running deployment could differ — in its paths, its error
shapes, its auth, or in ways nobody predicts until the first real call. **Treat
every integration claim here as "the client is correct against the contract as
published", never as "the integration works".**

**There is no private runtime.** T19 asks for a full private-runtime
qualification. The synthetic half is done — same-commit CI, browser evidence at
three sizes in both themes, accessibility, subpath hosting, an export with an
explicit data-inclusion choice. The half that needs an authenticated private
profile is not started, because there is no such profile. That is **D04** and
**D07**.

**The demo is not deployed.** GitHub Pages fails on every merge at
`configure-pages` with `Get Pages site failed… Error: Not Found`. Everything
before it succeeds. A repository administrator has to set Settings → Pages →
Build and deployment → Source: **GitHub Actions**, once. A workflow token is
never a repository administrator, which is why an earlier `enablement: true`
attempt was wrong and was removed.

**Nothing is published to npm.** Package metadata is complete; no publish has
been attempted. A version is immutable and a name is claimed permanently, so
this waits for an explicit decision and a token.

**No Qlik or Vizlib compatibility is claimed.** None was attempted, none is
tested, and **D09** governs whether any ever is. The SQLite work establishes
nothing about SQL Server — **D05** says so explicitly and this report repeats it
because the gap is easy to forget.

**Excel-to-SQL precedence is unresolved.** **D01**. The bridge refuses a
conflict between the workbook and the metadata snapshot rather than picking a
winner, which is the correct behaviour while the decision is open and the wrong
behaviour once it is made.

## Evidence

```
pnpm build                     clean
pnpm test                      1044 passed (1044)
CI on main                     check, review, Analyze, CodeQL — green

scripts/verify-a05.mjs         18/18   answer and report agree, in a browser
scripts/verify-a11.mjs         26/26   three sizes, subpath hosting, no network
scripts/verify-accessibility   108/108 two apps, three sizes, both themes
```

Every fix in this project ships with a test that was **watched failing** against
the unfixed code, and every guard has been removed once to confirm a test breaks
without it. That standard is the reason to trust the numbers above; it is also
the reason this report can be specific about what is untested.

## What the browser checks do not cover

The accessibility script reports specific failures — a skipped heading level, a
table without header scope, a control nobody can see the focus on, body text
below 4.5:1 — and it found five real defects, including the em dash that stands
for a missing value being too faint to read. It does not tell you whether the
reading order makes sense, whether a label says something useful, or whether a
chart's meaning survives without colour. Those need a person, and no person has
done that pass.

## Recommended next steps, in order

1. **Set the Pages source.** One setting, and the demo the README points at
   becomes real. Nothing else is blocked on it, but it is the cheapest thing on
   this list.
2. **Decide D04 and D07** — shared identity and the runtime profile. Everything
   in G3 waits on them, and no amount of further engineering here moves them.
3. **Stand up one service and point a transport at it.** The first real call is
   worth more than any further fixture work; it is the only way to learn what
   the contracts got wrong.
4. **Have someone use the workspace.** The reading-order and label-quality pass
   that no script can do.
5. **Decide about npm.** Only if the packages are meant to be consumed outside
   this repository.

## Gate status

| Gate | State | What it means |
|---|---|---|
| G0 Documented | **Met** | Requirements, sources, decisions and acceptance tests are committed and reviewable |
| G1 Bridge proof | **Met** | T02, T04–T10, with the golden fixture asserted end to end |
| G2 Read-only integrated domain | **Met** | T03, T11–T18, and all twelve scenarios recorded with evidence |
| G3 Controlled private pilot | **Open** | Needs an approved private environment. T19's synthetic half is done |
| G4 Reusable release | **Open** | Needs G3, then a repeatable deployment and a signed-off limits list |

Each gate's own definition names what it must not be mistaken for. G1 is not
Qlik compatibility or production readiness. G2 is not authorization for writes.
G3 is not confidential-data approval for a public demo. Those distinctions are
the point of the gates and this report does not blur them.
