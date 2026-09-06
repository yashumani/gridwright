# Delivery plan and acceptance evidence

Version 0.1 · All implementation tasks below are initially **planned**.

[Requirements](UNIFIED_PLATFORM_REQUIREMENTS.md) · [Architecture](ARCHITECTURE_AND_CONTRACTS.md) · [Sources and decisions](SOURCE_MAP_AND_DECISIONS.md)

## 1. Execution policy

Implement one complete product slice per development cycle. Read current code and source-repository instructions first; this documentation does not freeze an old commit or authorize broader access. Use existing source projects through adapters and keep their release processes intact.

A task closes only with a linked implementation commit/PR, relevant automated checks, sanitized evidence, limitations and acceptance outcome. Tests claimed in a README are not new test execution. Do not call a mock integration a live connector. Do not copy private source artifacts into the public repository.

## 2. Twenty ordered tasks

Ownership is proposed, not an assignment or approval to modify another repository. Tasks with dependencies start only after those contracts are settled. Read-only fixture work can proceed while production-only decisions remain open.

| Task | Deliverable | Depends on | Requirements | Completion evidence |
|---|---|---|---|---|
| T01 | Reconcile this baseline with current PRs and source-project policies; record product domain and candidate coordinator boundaries. | None | R01,R02,R26,R28 | Decision log and requirements-to-owner map; unresolved decisions remain explicit. |
| T02 | Trace one authorized skeleton/configuration-to-view example. Until available, create an explicitly synthetic support-operations fixture. | T01 | R10-R15 | Input tables, key relationships, expected structure/results and no claims of workplace compatibility. |
| T03 | Define versioned integration envelopes, adapter capability descriptions and conformance fixtures. | T01 | R04,R05,R07,R19,R22 | Positive/negative schema tests, identity provenance and version-rejection tests. |
| T04 | Reproduce the prior Gridwright integration review findings and fix confirmed failures. | T01 | R16-R18,R25,R28 | Failing-then-passing tests for filters, invalid drafts, document replacement, JSON routing, serialization and keyboard ownership. |
| T05 | Read bounded `.xlsx` named configuration tables with source-cell/row provenance. | T02 | R10,R24 | Workbook fixtures, invalid/unsupported structures, formula/macro policy and resource-limit tests. |
| T06 | Add read-only SQL configuration and prepared-view descriptors through an approved backend adapter. | T02,T03 | R05,R11,R12,R24 | Real database integration fixture, parameterization, identifier/scope checks and no browser credentials. |
| T07 | Implement explicit view bindings and metadata normalization, with uniqueness/cardinality/grain validation. | T05,T06 | R07,R12 | Valid binding and duplicate/missing/incompatible binding tests. |
| T08 | Implement the deterministic bridge compiler using existing Gridwright runtime contracts where adequate. | T07 | R13-R15 | Configuration -> definition/provenance snapshots, dependency-cycle and unsupported-rule diagnostics. |
| T09 | Render the required skeleton-driven report with headings, empty rows, totals, formats and supported interactions. | T04,T08 | R14,R17,R18 | Browser evidence and structural/numerical assertions, not screenshots alone. |
| T10 | Add metadata revision, last-valid preview, explicit overrides, export/reopen and rollback. | T09 | R16,R27 | Metadata-only changes, second-view binding and round-trip tests. |
| T11 | Integrate a scoped UKB client for approved context packs and source/approval/freshness evidence. | T03 | R05-R07 | Retrieval, denied access, missing context, unpublished objects and source-version tests. |
| T12 | Integrate Talk2Data domain admission and executable metric/query contracts through a typed adapter. | T03,T06 | R02,R05,R07,R09 | Valid/ambiguous/out-of-domain queries and receipt-backed numerical outputs. |
| T13 | Expose supported variance/time/attribution behavior behind a service or approved library adapter. | T03,T12 | R08,R09 | Golden numerical reconciliation and unsupported-operation rejection. |
| T14 | Implement deterministic capability enforcement, scope propagation, budgets and output validation. | T03 | R04,R05,R22-R25 | Denial, forged scope, malformed arguments, injection, unavailable-policy and egress tests. |
| T15 | Add the bounded coordinating workflow and optional specialists; preserve each source runtime's limits. | T11-T14 | R01-R04,R19,R25 | One parent run, bounded delegation, cancellation/retry evidence and no uncontrolled child spawning. |
| T16 | Implement the unified domain chat + report workspace with shared analysis snapshot and visible evidence. | T09,T12,T13,T15 | R17-R19,R25 | Full browser journey where chat, analytics and report values reconcile. |
| T17 | Add scoped sessions/artifact persistence and tested cache invalidation, retention and deletion. | T03,T15 | R19-R21 | Cross-session authorized retrieval; cross-user/tenant denial; stale and revoked-cache tests. |
| T18 | Add separately enabled human-reviewed configuration/knowledge publication, without autonomous approval. | T10,T11,T14 | R16,R20,R23 | Approvals bound to action/input, expiry/replay denial and immutable published version. |
| T19 | Qualify a full private-runtime integration and synthetic deploy-first preview at desktop/tablet/phone sizes. | T16-T18 | R24-R28 | Same-commit CI, browser, accessibility, dependency-failure, audit and rollback evidence. |
| T20 | Run final acceptance on one domain and demonstrate reuse with a second compatible view/profile. Publish a truthful readiness report. | T19 | R01-R28 | All required scenarios pass; remaining external compatibility/production gaps explicitly listed. |

Suggested implementation homes: bridge/report work in Gridwright; conversational semantics in Talk2Data; context review/retrieval in UKB; attribution in the variance project; coordination in an explicitly approved orchestrator integration profile; broker/contract ownership settled in D03. Do not scatter copies of the same authoritative logic among all repositories.

## 3. Acceptance scenarios

These are test specifications, not results. Each scenario requires a recorded pass/fail and evidence reference before release.

| ID | Scenario | Required outcome |
|---|---|---|
| A01 | Skeleton + configuration + bindings + data view | An authorized workbook and SQL metadata produce the expected React report without per-report code. Preserve order, hierarchy, headings and configured empty lines. |
| A02 | Metadata-only reuse | Change label, order, supported calculation and binding; regenerate with unchanged bridge code. Bind a second compatible view and reconcile independently. |
| A03 | Calculation correctness | Test missing values, zero denominators, negative adjustments, period boundaries, additive/weighted/period-end rules and invalid formulas. Undefined is not silently zero; totals are calculated at the right grain. |
| A04 | Domain and knowledge | Reject or clarify out-of-domain/ambiguous questions before data access. Use published authorized context only, retain evidence/freshness and distinguish unavailable from denied. |
| A05 | Unified numerical answer | Chat, analytics and report use the same metric/version, scope, periods, filters and source snapshot. Every displayed material value links to an appropriate receipt/result. |
| A06 | Identity and authorization | A second principal/tenant cannot obtain another's artifacts, cached answers, sessions or data by changing IDs or request-body clearance. Revocation takes effect on subsequent access. |
| A07 | Tool governance and hostile input | Config cells, retrieved text and tool output cannot grant permissions, trigger arbitrary code/SQL, leak credentials or bypass allowed resources. Test SQL identifiers separately from bound values. |
| A08 | Bounded agents and failures | Deadlines, tool/step budgets, retries and cancellation are enforced. No delegated run spawns unlimited children. Model/KB/SQL/policy failures return explicit partial/failure states. |
| A09 | Approval and publication | Draft knowledge and config remain drafts. Approval is verified against the exact action and input digest; stale, expired and replayed approvals are rejected. Read-only mode cannot publish. |
| A10 | Editor and report reliability | Reproduce/retest all six prior workflow concerns. Switching documents/modes preserves correct state, keyboard chart navigation does not move panels and serialization retains intended configuration. |
| A11 | Responsive export and deployment | Real-browser desktop/tablet/phone tests, keyboard/focus/error flows, source-subpath hosting and clean-environment export succeed. Data inclusion is explicit; public preview contains synthetic assets only. |
| A12 | Evidence, sessions and handoff | Retained sanitized artifacts identify run and relevant source/config/semantic/policy versions. Restore/reopen is reproducible; late or incompatible results cannot overwrite an active session. Another developer follows the repository handoff without relying on chat memory. |

### Suggested synthetic golden fixture

Use a generic support workload, not a workplace or finance-planning example. Suppose closed-case counts are Actual 120 versus comparison 100, with two non-overlapping queues contributing 70 vs 60 and 50 vs 40. Expected arithmetic variance is +20; contributions are +10 and +10. Do not automatically call this 'good': business polarity belongs to the approved metric definition. A 'Total' row plus headings and one configured missing category must preserve the skeleton. A non-additive metric is a separate test and must not inherit sum behavior.

## 4. Release gates

| Gate | Meaning | Must not be mistaken for |
|---|---|---|
| G0: Documented | Requirements, sources, decisions and acceptance tests are committed and reviewable. | Implemented integration. |
| G1: Bridge proof | T02,T04-T10 prove metadata -> bound data -> report with actual workbook/database fixtures. | Qlik/Vizlib script compatibility or production readiness. |
| G2: Read-only integrated domain | T03,T11-T17 and A01-A08/A10/A12 demonstrate knowledge, chat, verified analytics and report orchestration. | Authorization for writes or unrestricted multi-agent operation. |
| G3: Controlled private pilot | T18-T19, all scenarios and identity/persistence/retention/rollback gates pass on an approved private environment. | Confidential-data approval for a public static demo. |
| G4: Reusable release | T20 proves repeatable deployment and the agreed cross-product reuse contract, with remaining limits signed off. | Completion of every source project's roadmap. |

## 5. Next cycle and evidence record

## 6. Delivered so far

Recorded against evidence, not intent. Every row below has merged code, tests
that were checked against the unfixed behaviour, and a green pipeline.

| Task | Status | Where |
|---|---|---|
| T02 | Delivered | `fixtures/support-ops/` — skeleton workbook, SQL metadata, bindings, prepared view, expected results |
| T05 | Delivered | `packages/bridge` — bounded `.xlsx` reading with cell provenance |
| T06 | Delivered | `packages/bridge/src/sql.ts`, exported at `@gridwright/bridge/sql` — read-only connector against a real SQLite fixture |
| T07 | Delivered | Explicit bindings, validated before computation |
| T08 | Delivered | Deterministic compile to a report definition |
| T09 | Delivered | Fill from view data, and `<Report>` in `@gridwright/react` |
| T10 | Delivered | Revisions: revise, preview, roll back, export, reopen |
| T03 | Delivered | `packages/contracts` — versioned envelopes, capability descriptors, and `fixtures/contracts/conformance.json` as the suite another adapter runs against itself |
| T11 | Delivered | `packages/adapters/src/ukb.ts` — context packs, with denied access, missing context and unpublished drafts kept as three different outcomes |
| T12 | Delivered | `packages/adapters/src/talk2data.ts` — all ten admission verdicts, the compiled query and receipt-backed claims |
| T13 | Delivered | `packages/adapters/src/variance.ts` and `semantics.ts` — golden reconciliation, unsupported-operation rejection, and the R07 mapping across three vocabularies |
| T14 | Delivered | `packages/coordinator/src/gate.ts` — scope frozen into the invocation, output classified again on the way back, and privileged execution failing closed without a policy |
| T15 | Delivered | `packages/coordinator/src/run.ts` — one parent run, one budget pool, cancellation that reaches a call in flight, and a specialist shape with no recursion in it |

### Acceptance scenarios, recorded against evidence

Section 3 lists these as specifications. This is what each one currently has.

| Scenario | Status | Evidence, or what is missing |
|---|---|---|
| A01 Skeleton + configuration + bindings + data view | **Passed** | The golden fixture runs workbook → bindings → definition → data → screen; `expected.json` is asserted, not described. Order, hierarchy, headings and the configured empty row all survive |
| A02 Metadata-only reuse | **Passed** | Label, calculation and binding each changed and regenerated with no bridge code changed; a second compatible view bound and reconciled independently |
| A03 Calculation correctness | **Passed** | `packages/bridge/test/acceptance-a03.test.ts` — 27 tests over missing values, zero denominators, negative adjustments, period boundaries, aggregation rules, invalid formulas and total grain. Undefined is never zero; one defect found and fixed |
| A10 Editor and report reliability | **Passed** | All six prior concerns retested; three defects found and closed, each held by a test checked against the unfixed code |
| A04 Domain and knowledge | Not started | Needs UKB (T11) |
| A05 Unified numerical answer | Not started | Needs Talk2Data and the variance product (T12, T13, T16) |
| A06 Identity and authorization | Not met | The contract refuses a request-body clearance and derives scope from service context (T03), but there are no sessions or stored artifacts to attempt cross-tenant retrieval against (T17) |
| A07 Tool governance and hostile input | Not met | SQL identifiers are allowlisted and values bound, config cells and payloads are size-bounded, capability arguments are schema-checked, and **configuration text is scanned for embedded instructions** — a hostile heading, note or metric label is reported with its cell and does not stop the report. Retrieved text and model output are still unscanned in practice, because nothing yet retrieves or generates them (T11, T12, T14) |
| A08 Bounded agents and failures | Not met | Timeout, step and retry budgets are enforced by the gate that authorises a call (T03). Cancellation and "no delegated run spawns unlimited children" need an orchestrator (T15) |
| A09 Approval and publication | Not started | Needs T18 |
| A11 Responsive export and deployment | **Passed** | `scripts/verify-a11.mjs` drives the built demo in Chromium at 1440×900, 834×1112 and 390×844, hosted under a project subpath — 26 checks: no horizontal overflow before or after loading a dashboard, panels rendered, Tab reaches a visibly focused control, no external network requests, no page errors, and an unreadable file reported rather than swallowed. Two defects found and fixed |
| A12 Evidence, sessions and handoff | Not met | Export and reopen are reproducible and version metadata travels (T10, T03), but there is no session for a late result to fail to overwrite (T17) |
| T04 | Delivered | Six named concerns audited; three defects found and closed in `packages/builder` |

**G1 is met.** It requires T02 and T04-T10, and all seven are delivered. The
golden fixture runs end to end — workbook, bindings, definition, data, screen —
and `expected.json` is asserted rather than described.

T04 named six concerns. Four were already covered by tests that pass and were
checked, not re-implemented; two were live defects, and chasing the second one
surfaced a third. Each fix is held by a test shown to fail with the fix removed.

| Concern | Finding | Evidence |
|---|---|---|
| Filters | Covered | `packages/react/test/dashboard.test.tsx`, `packages/engine/test/engine.test.ts` — cross-filtering, a panel not filtering itself, ANDed filters, post measures against the filtered total |
| Invalid drafts | Covered | "reports issues rather than emitting an invalid manifest silently" (builder); the revision history keeps a broken draft apart from the last valid version (bridge) |
| JSON routing | Covered | "loads a declared json table through the upload path" — a declared JSON table is parsed as JSON, not as CSV |
| Serialization | Covered | Round trip: an untouched export, an edited export and repeated export/import all re-import unchanged |
| Keyboard ownership | **Defect, fixed** | An arrow key pressed on a focused chart mark moved the panel around it. The canvas now yields to whatever interactive thing holds the keyboard |
| Document replacement | **Defect, fixed** | A replaced `manifest` prop was ignored entirely — the editor kept editing the file that was closed. It now loads the new document, without resetting on its own edits echoed back through `onChange` |
| (found while fixing the above) | **Defect, fixed** | The "last manifest that compiled" fallback survived a document replacement, so a new file that does not compile drew the previous file's panels under its name. The canvas is now empty, with the problems beside it |

Not established by any of the above: Qlik or Vizlib compatibility, SQL Server
equivalence (D05 limits the SQLite work to first validation), any live
connector, or any integration with the knowledge, chat or variance products.
Excel-to-SQL precedence remains open as D01, and the bridge refuses a conflict
rather than resolving one.

**G2 is not met.** It requires T03 and T11-T17 plus scenarios A01-A08, A10 and
A12. T03 is delivered; T11-T17 are not started, and each of them integrates a
service this repository does not have — UKB, Talk2Data, the variance product and
an approved orchestrator. What T03 establishes is the contract they will be held
to, and a suite an adapter runs to prove it speaks that contract; it establishes
nothing about any of those services being reachable, and none is claimed.

D03 — who owns the capability broker and hosts the integration — stays open.
T03 defines the contract shape, not the host, and nothing in it presumes an
answer.

Next cycle: T11-T17 are blocked on service access, which is an external
dependency rather than an engineering one. Do not begin with a generic chatbot
wrapper or a new gallery.

Record task, requirement IDs, source commit(s), fixture version, adapter/model/policy versions, commands/checks, results, evidence location, blockers and next task in each PR. Preserve source boundaries and mark mocked versus live integrations clearly.

This change adds documentation only. It does not rerun prior application tests, verify workplace behavior, operate a model, activate a connector or certify a live deployment. GitHub CI on a documentation commit remains a repository check, not integration acceptance.
