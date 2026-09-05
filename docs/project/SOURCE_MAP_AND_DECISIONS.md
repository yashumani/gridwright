# Source map, compatibility boundaries and open decisions

Captured for the 2026-09-04 requirements baseline. Repository reads used explicit `main` refs. Sources below are documentation evidence, not an independent runtime audit. Git blob fingerprints identify exactly the content read; the linked branch can subsequently change.

[Start here](../../PROJECT_REQUIREMENTS.md) · [Requirements](UNIFIED_PLATFORM_REQUIREMENTS.md) · [Architecture](ARCHITECTURE_AND_CONTRACTS.md) · [Delivery](DELIVERY_AND_ACCEPTANCE.md)

## 1. Evidence labels

**User intent:** U1-U6 in the requirements document. These are paraphrases of the user's requested product direction, not workplace implementation evidence.

**Documented:** a capability or limitation stated in a repository file read during this change. Treat it as a source claim until code/runtime evidence is collected.

**Proposed:** the integration design, ownership, envelopes, neutral example and task sequence in this package. No new cross-repository feature is implemented here.

**Unresolved:** an input, authority decision or compatibility question not established by the supplied material.

Previously generated platform diagrams illustrate a target. They do not prove live connectivity, production compliance, implemented alerts or an authorization-capable agent. In particular, a 'governance agent' in a concept image does not replace deterministic enforcement.

## 2. Repository map

### S1 — Gridwright

Source: [README](https://github.com/yashumani/gridwright/blob/main/README.md), read at `main`; blob `0ff991e9eece299d8ea8dbfc1939c21c0476bf47`. Main was `e33e73cfe0f93118f68ace7437b6425109815233` before this documentation change.

Documented: schema-driven React dashboards, versioned manifest, expression and query layers, panel schemas, builder and local data execution. The README states that MemorySource is the only adapter and that production data has not yet been exercised. The documented file formats are CSV/TSV/JSON, not an Excel configuration bridge.

Proposed role: metadata bridge and report presentation, consuming approved analytical results without changing their meaning. Preserve existing package boundaries. This requirements package adds no runtime fields to the strict manifest.

Supporting sources: [architecture](../architecture.md), blob `57408bde890f0629c916519144a513178ba02559`; [data sources](../data-sources.md), blob `c40bec7271eb156a33d767376c456190ab9bdeeb`; [contributing](../../CONTRIBUTING.md), blob `d61854b6ffc8c16d3fb52ba6333b1e20d49db5fe`. Architecture and data-source excerpts were read in this change; the manifest discussion also uses the earlier repository review, not a fresh schema audit.

### S2 — Unified AI Orchestrator

Source: [README](https://github.com/yashumani/unified-ai-orchestrator/blob/main/README.md); blob `8bdc4fc8a7530584f1f903e9dd2310da9e8da369`.

Documented: loopback-only local orchestration with pinned Ollama `qwen3:4b`, guarded repository tools, persistent scoped trust, allowlisted read-only capability discovery and run receipts; portfolio analysis uses GET/HEAD-only GitHub access. Repository writes are constrained to permitted development branches; protected branches/paths remain excluded. The browser receives bounded summaries rather than raw prompts/file bodies/evidence. Public ingress and GitHub Pages are outside that runtime's architecture.

Proposed role: candidate coordinator or reusable coordination contracts. Adding domain-data services, remote deployment or new write scopes is a new approved profile, not an implied permission from this requirements document. No private dependency internals or local paths are reproduced here.

### S3 — Unified Knowledge Base

Source: [README](https://github.com/yashumani/unified-knowledge-base/blob/main/README.md); blob `090efa6cfd90a66cc67da10ce48ece97d2d92d2e`.

Documented: a governed context runtime with REST/SDK/MCP/UI adapters; local Ollama enrichment yields suggestions, while human review creates approved published knowledge. Access filtering is applied during retrieval. The README explicitly calls the project a scaffold, using a shared service token rather than full user identity, with persistence/hybrid retrieval and SSO among remaining work. MCP approval is refused by default; an optional supervised override is not authorization for autonomous approval in this integration.

Proposed role: approved evidence/context packs, not the arithmetic engine. The integration cannot assume production per-user isolation from the present shared-token setup. The public scaffold prohibits employer data and certain workplace-like example domains; keep the first shared fixture generic support operations.

Supporting source: [Context Pack](https://github.com/yashumani/unified-knowledge-base/blob/main/docs/CONTEXT_PACK.md); blob `f85c8bda6dd9a7d9ae56bd18148f6f5098e40482`. Preserve native context-pack IDs, evidence, access decision and caveats through the adapter.

### S4 — FP&A Variance Copilot

Source: [README](https://github.com/yashumani/drill-down-anamoly/blob/main/README.md); blob `b46b6b327b73a6fa98a17d034b5df289fbc3bd79`.

Documented: evidence-first Actual/comparison analysis, time intelligence, supported multidimensional attribution, readiness checks, optional grounded chat and deterministic presentation. Its contract accepts one metric identity per file; sum, support-weighted average and period-end behavior are distinct. Detailed ratio and distinct-count attribution are disabled pending governed strategies. Narrative models cannot alter certified numbers. Enterprise identity, tenant isolation, authenticated execution and other hardening remain work.

Proposed role: supported deterministic analytical capabilities and evidence contract. Do not presume the browser implementation is already a remotely callable service. Keep its FP&A semantics intact; a generic support adapter needs an explicit mapping and conformance fixture, not a renamed financial label. Do not propagate its example data into UKB's public scaffold.

### S5 — Talk2Data Conversational Intelligence

Source: [README](https://github.com/yashumani/talk2data-conversational-intelligence/blob/main/README.md); blob `4f156cda156ea323a9e4bfe13e67d76c5e5c28be`.

Documented: local-first domain admission, semantic registry, deterministic Business Query IR, read-only SQLite/PostgreSQL reference execution, coverage/result validation, query receipts and scoped sessions. The current example uses a specific Domain Pack; it is not automatically the production domain for the unified product. Models do not define metrics, grant access, receive credentials or calculate certified results.

Supporting source: [roadmap](https://github.com/yashumani/talk2data-conversational-intelligence/blob/main/docs/roadmap.md); blob `600a7b2e413cb5db81bdc6d003176b976cb87898`. Unified AI Brain integration, secure memory fabric and bounded Hermes workflows remain roadmap stages. Do not describe that adapter boundary as a completed multi-agent system. The README includes client-supplied demo access context; target enterprise identity requires server-authenticated scope.

Proposed role: conversational/domain/query boundary and verification, with typed delegation under one coordinator. Preserve source semantics, receipts and existing security controls.

### S6 — HarnessLab

Source: [README](https://github.com/yashumani/harnesslab/blob/main/README.md); blob `33569d73f8754949614cf03d7cd83f8a11fb87d6`.

Documented: deterministic harness planning, capability/approval guidance, durable artifacts and an executable bounded temporary Architecture Critic. The critic allows one worker/invocation with no tools, no child spawning and no MCP/A2A execution. Optional model gateways do not relax deterministic controls. The README states no open-source license has been selected.

Proposed role: interface/contract alignment and optional advisory critique, not a general-purpose MCP tool runner. Do not copy or redistribute implementation/assets under Gridwright's MIT license by assumption.

### X1 — Supplementary external protocol reference

[MCP authorization, versioned reference](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) was consulted specifically for resource/audience validation and prohibition of token passthrough. It is not a claim that this is the newest revision or that any source project conforms to it. Select and test the actual transport/protocol revision before implementation. This external reference informs a proposed security requirement; the user and repository sources remain the basis of the product scope.

## 3. Cross-project conflicts to resolve, not conceal

| Boundary | Documented difference | Required treatment |
|---|---|---|
| Identity | UKB shared-token scaffold versus target per-user/tenant scope and Talk2Data demo access-context fields | Build authenticated adapter context; never trust caller-provided identity as authorization. |
| Model/runtime | Different pinned models and providers across projects | Preserve project pins; select an explicit integration profile without silent downloads or cloud fallback. |
| Deployment | Static demos, private services and a strictly loopback-only coordinator coexist | Separate public synthetic preview from private execution; a shared UI does not authorize public ingress. |
| Semantic authority | Published knowledge, executable query metrics, variance contracts and report formulas serve different purposes | Link IDs/versions and reconcile contracts; no automatic overwrites between registries. |
| Public examples | Different source-project domain examples and public-scaffold rules | Use a new neutral synthetic fixture; do not bulk-copy domain packs or data. |
| Agent capability | Planned multi-agent stages and a no-tools critic are not a general executor | Explicit adapter/capability approval and tests before live delegation. |
| Licensing | Independent projects do not necessarily share Gridwright's license | Check permissions before code reuse; favor service contracts first. |

## 4. Open decisions and assumptions

| ID | Unresolved decision | Safe planning default / unblock path |
|---|---|---|
| D01 | Actual workbook, SQL metadata and supplied script structure, plus their precedence | Use clearly synthetic fixtures; claim no workplace compatibility. A sanitized authorized sample can later establish exact behavior. |
| D02 | First production domain and vocabulary | Propose generic support operations for acceptance only. Production domain remains unselected. |
| D03 | Integration host, capability-broker owner and delegated runtime relationship | Existing orchestrator is a candidate; do not expand current trust or add competing recursive coordinators. |
| D04 | Shared identity, service authentication and authorization propagation | Require an authenticated private profile before sensitive integration; shared development tokens are not production identity. |
| D05 | SQL system and supported calculation/result adapter semantics | Validate first on an approved synthetic database. SQLite/PostgreSQL references do not establish SQL Server or Qlik equivalence. |
| D06 | Configuration authoring source and allowed write-back | Read-only first. Preserve source metadata and explicit drafts/overrides; do not synchronize writes silently. |
| D07 | Runtime/model profile, budgets, retention and performance targets | Honor source-project limits; benchmark the chosen fixture and record explicit thresholds before release. |
| D08 | Public/private delivery and export data inclusion | Public preview contains synthetic data only; private runtime unchanged; data inclusion requires explicit choice. |
| D09 | Formal Qlik/Vizlib compatibility scope and rights to reference artifacts | Reference behavior only when authorized; no arbitrary script conversion or proprietary code/template copying. |

## 5. Review limitations and freshness

Six relevant repository READMEs and the listed supporting documents were read for this change. No private repository content, workplace files or raw conversations were imported. No complete portfolio inventory, fresh code audit, numerical benchmark, live service integration or model run was performed.

The six prior Gridwright workflow findings come from the earlier review in this conversation. Some were isolated logic reproductions and others source-traced; their present status requires fresh reproduction. Task T04 records them without asserting that they remain exploitable or have been repaired.

At the initial Gridwright repository read, the default branch still differed from `main`. This package is based explicitly on `main`; it does not change the default branch, branch protection, deployment configuration or any existing PR. Future agents must verify the branch/ref before claiming current status.
