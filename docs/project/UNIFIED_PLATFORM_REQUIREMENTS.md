# Unified platform requirements

Version 0.1 · 2026-09-04 · New integration requirements, not an implementation report.

[Start here](../../PROJECT_REQUIREMENTS.md) · [Architecture](ARCHITECTURE_AND_CONTRACTS.md) · [Delivery](DELIVERY_AND_ACCEPTANCE.md) · [Sources and decisions](SOURCE_MAP_AND_DECISIONS.md)

## 1. User intent and authority

The following intent comes from the user's clarification in this project, paraphrased without copying the conversation or any workplace material:

| Intent | Requirement |
|---|---|
| U1 | Use an Excel skeleton/configuration and SQL configuration metadata, not a copied dashboard. |
| U2 | Provide reusable bridge logic connecting those definitions to the final business-data view and finished report. |
| U3 | Supported changes should be configuration changes, not per-report React or bridge development. |
| U4 | Bring the knowledge base, variance analysis, AI chatbot and MCP governance projects together behind one orchestrated experience. |
| U5 | Support a multi-agent chatbot specific to one domain and reusable for other products. |
| U6 | Store requirements in the repository so work can continue across products, developers and conversation threads. |

These user requirements supersede earlier planning that made dashboard copying, a template marketplace or generic CSV inference the main objective. Existing features remain useful. The detailed requirements below are the proposed engineering interpretation; unsettled product choices are recorded as decisions, not silently approved.

## 2. Target experience

A user enters a domain workspace, chooses an allowed reporting scope and asks a business question. The coordinator checks domain fit and permissions, retrieves approved context, and invokes only the analytical capabilities needed. Separately, the bridge reads the report skeleton, configuration metadata and explicit view bindings. The runtime renders a report aligned to the verified analysis. The answer distinguishes measured changes, supported drivers, missing context and hypotheses, with evidence and freshness visible.

A report author can change supported labels, ordering, parameters, bindings and formulas in configuration. The shared bridge revalidates and regenerates the definition without report-specific code changes. Chat-assisted configuration changes are drafts requiring the appropriate validation and approval; the agent does not overwrite approved metadata autonomously.

## 3. Functional requirements

All R-items are planned integration requirements. Existing building blocks are described in the source map; no R-item is marked implemented by this documentation change.

| ID | Requirement and observable behavior | Intent |
|---|---|---|
| R01 | Compose products through versioned adapters and retain separate source ownership. One coordinator owns each user run; do not create uncontrolled nested orchestrators or merge repositories by default. | U4,U6 |
| R02 | Bind every product instance and request to an approved domain profile: vocabulary, metrics, units, calendar, valid operations, knowledge scope and allowed tools. Out-of-domain or ambiguous questions clarify, decline or route only through explicit policy. Personas cannot alter permissions. | U5 |
| R03 | Retain local Ollama as the default model direction. Honor each product's existing model and deployment policy; no automatic model download, replacement, cloud fallback, paid-service activation or data egress. Exact shared profile remains a decision. | U4,U5 |
| R04 | Coordinate a bounded workflow. Each specialist has a task, minimum context, explicit tools, timeout, step/retry budget and typed result. Use a deterministic or single-agent path when enough; do not invoke every agent for every question. | U4,U5 |
| R05 | Derive tenant, user and effective access scope from authenticated service context. Agents and request-body fields cannot self-assign authority. Each downstream service rechecks authorization. | U4,U5 |
| R06 | Retrieve published, authorized knowledge as context packs with source references, approval/version, freshness, caveats and conflicts. Missing context and denied access are different outcomes. | U4,U5 |
| R07 | Keep authoritative executable metric definitions versioned and traceable to approved knowledge. Synchronize by explicit mappings, not label matching. Resolve definition/unit/grain conflicts before computation. | U4 |
| R08 | Invoke deterministic analytics for Actual/comparison, period alignment, variance, aggregation and supported driver attribution. Preserve metric-specific additivity and polarity. Do not enable ratios/distinct-count attribution merely because a chart can display them. | U4 |
| R09 | Release numerical claims only with result/receipt linkage, data coverage and declared precision. Separate arithmetic contribution, association and causal explanation; a narrative or external note is not causal proof. | U4,U5 |
| R10 | Read supported `.xlsx` configuration tables as structured skeleton/configuration input with workbook/sheet/table/row provenance. Do not execute macros, external links or arbitrary formulas. Define how calculated cells are accepted or rejected; reject ambiguous or unsupported workbook constructs clearly. | U1 |
| R11 | Read SQL configuration metadata through an approved, read-only service connector with server-held credentials and bounded queries. Excel and SQL may supply separate definitions or represent stages of one workflow; inspect the reference artifacts before choosing precedence. | U1,U2 |
| R12 | Bind skeleton elements and logical definitions to approved business-data views using stable IDs, explicit field mappings, grain, units, filters and cardinality rules. Distinguish the SQL reporting view from the final React report. | U2 |
| R13 | Compile configuration deterministically into a validated report definition, execution requirements and provenance map. Reuse the existing Gridwright manifest where adequate; introduce a supported wrapper/extension with migration tests only when required. Unknown rules fail explicitly. | U2,U3 |
| R14 | Preserve configured headings, row/column order, hierarchy, calculated lines and empty required rows independently of which records a query returns. Define blank/zero/not-available policies explicitly; never silently discard skeleton structure. | U1,U2 |
| R15 | Parse supported calculations through the governed expression system and resolve dependencies. Check missing references, cycles, nulls, division by zero, incompatible units, totals and aggregation levels. No raw JavaScript or unrestricted SQL from metadata. | U1,U2 |
| R16 | Support metadata-only revision -> validate -> preview -> approve/publish when applicable -> rollback. Source configuration is authoritative; generated runtime definitions are not a second unsynchronized authoring source. Keep invalid drafts separate from last-valid versions. | U3 |
| R17 | Render the resolved report in React with required table configuration, KPIs/charts where relevant, filters and responsive layouts. Neither chat nor a renderer may silently substitute invented values for missing results. | U2,U4 |
| R18 | Synchronize question scope, reporting period, filters and numerical results across chat, analytics and report views using one analysis snapshot. Any intentional selector exemption must be explicit; no mismatched KPI and detail populations. | U4,U5 |
| R19 | Exchange typed artifacts with run, session, domain, source, policy, semantic, configuration and result versions. Reject stale, malformed or out-of-scope handoffs. Preserve adapters' existing receipt IDs rather than minting unsupported claims of certification. | U4,U6 |
| R20 | Separate session history, working context, investigation artifacts and approved durable knowledge. Use scoped retention/deletion and authorized cross-session retrieval. Chat content never becomes official knowledge without the review/publish process. | U4,U5 |
| R21 | Keep response, retrieval, query and model-runtime caches conceptually separate from durable memory. Cache hits must respect current access, domain, policy, semantic/config/source versions and deletion/revocation. No cross-tenant reuse. | U4,U5 |
| R22 | Put deterministic policy enforcement at every MCP/tool boundary: registered capability, schema, identity, scope, resource, arguments, quotas and output classification. A policy agent may advise but cannot grant access. MCP is an adapter, not the entire backend. | U4 |
| R23 | Keep the first integrated investigation read-only. Publishing approved knowledge, changing source configuration, external writes, deletion and deployment require separately authorized capabilities with action-bound approvals and idempotency. A summary saying 'approved' is not an approval record. | U4 |
| R24 | Treat files, retrieved text, metadata and tool outputs as untrusted data. Bound file expansion, cells/rows, payloads, query time and output size; detect instructions embedded in evidence, prevent credential exposure and block unauthorized egress. | U1,U4 |
| R25 | Expose running, denied, needs-clarification, partial, failed, cancelled and completed states. Timeouts/retries remain bounded; cancellation propagates. Partial results stay labeled and cannot be combined into apparently complete answers. | U4,U5 |
| R26 | Preserve each product's deployment boundary. Publish synthetic static previews separately from authenticated/private runtime services. Release a verified same-commit artifact with smoke tests and rollback; do not expose a loopback-only service publicly. | U4,U6 |
| R27 | Enable reuse through a domain profile, capability bindings and configuration package, not a forked implementation per domain. Export templates, reports and evidence with explicit data-inclusion choice, access checks and version metadata. | U3,U5,U6 |
| R28 | Maintain testable requirements, contract fixtures, numerical reconciliation, security tests and real-browser journeys. Documentation and generated diagrams must distinguish proposed design from implemented and verified behavior. | U6 |

## 4. Non-goals and scope limits

No wholesale repository merger, generic autonomous super-agent, unrestricted natural-language-to-SQL executor, Qlik/Vizlib code or proprietary-template copying, arbitrary Qlik-script interpreter, automatic workplace-data ingestion, paid-service enrollment, or public hosting of private runtimes is authorized by this plan.

The source Qlik script is a possible reference for behavior when a sanitized, authorized sample is available. Running Qlik or embedding Vizlib is not required to demonstrate an independently implemented metadata bridge. Any actual Qlik compatibility claim requires a separately specified and tested input contract.

A template marketplace, unrelated consumer applications and large visualization expansion are outside the first integrated slice. Existing product roadmaps are not automatically cancelled or imported wholesale.

## 5. First-slice definition of done

Use a synthetic single-domain example approved for public use. A workbook skeleton plus SQL metadata binds a prepared view; approved knowledge provides the metric definition and caveats; deterministic analytics produces a supported variance; the same verified values appear in chat and a React report. A metadata-only edit changes the output, and a second compatible view can be bound without changing the bridge code.

Permission denial, unknown bindings, stale context, missing periods, unavailable dependencies and invalid formulas produce explicit safe outcomes. No private data is published, no agent self-approves, and each material value is traceable through typed evidence. See acceptance scenarios A01-A12 and release gates G0-G4.
