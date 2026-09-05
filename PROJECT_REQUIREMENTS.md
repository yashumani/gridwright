# Shared orchestrator and metadata-bridge requirements

Requirements baseline: 2026-09-04 · Version: 0.1 · Delivery status: documentation only.

## Start here

This is the repository handoff for the clarified Gridwright requirement and its integration with the other products. It records the user's requested direction; the detailed service contracts, ownership assignments, example domain and implementation sequence below are proposals, not claims that integration already works. Existing approved security boundaries remain in force.

**Build one reusable orchestrated experience in which a domain-specific chatbot can retrieve approved knowledge, request verified variance analysis, and produce a metadata-driven React report through governed capabilities.**

The original Gridwright requirement remains essential: **Excel skeleton/configuration + SQL configuration metadata + explicit bindings to a final business-data view -> reusable bridge logic -> validated report definition and results -> React presentation.** Users maintain supported metadata and bindings; they do not rewrite report-specific React code or the bridge. This is not a Qlik dashboard copier, arbitrary Qlik-script interpreter, or simply a chart-template gallery.

The workplace workbook, SQL schema and supplied Qlik script have not been provided. Their exact keys, transformations, precedence and output structures are unresolved. This public specification records the pattern only; it does not reconstruct or publish workplace material.

## Read in this order

| Document | Purpose |
|---|---|
| [Unified platform requirements](docs/project/UNIFIED_PLATFORM_REQUIREMENTS.md) | User intent, functional requirements and non-goals. |
| [Architecture and contracts](docs/project/ARCHITECTURE_AND_CONTRACTS.md) | Component boundaries, bridge workflow, typed handoffs and governance. |
| [Delivery and acceptance](docs/project/DELIVERY_AND_ACCEPTANCE.md) | Twenty ordered tasks, acceptance scenarios and release gates. |
| [Source map and decisions](docs/project/SOURCE_MAP_AND_DECISIONS.md) | What the repositories actually document, source fingerprints, conflicts and open decisions. |

## Reuse the portfolio; do not merge it blindly

Proposed responsibilities, subject to the source projects' own policies:

- `unified-ai-orchestrator`: candidate coordination host, with an explicitly approved integration profile rather than expansion of its existing repository tools.
- `talk2data-conversational-intelligence`: domain admissibility, conversational interpretation, governed semantic/query planning and verified claims.
- `unified-knowledge-base`: approved context packs, definitions, evidence, lineage and review/publish lifecycle.
- `drill-down-anamoly`: deterministic variance, time comparison, attribution and analytical evidence.
- `gridwright`: metadata bridge, report configuration, reusable runtime and React presentation.
- `harnesslab`: bounded harness/critic contracts and evaluation patterns; its current critic is not a general MCP executor.

These are documented capabilities and proposed integration roles, not evidence of existing cross-repository interoperability. See the source map before implementing an adapter. Do not copy a source project's code or assets without checking its license and authorization.

## First integration milestone

Use one employer-neutral synthetic domain fixture. Read a skeleton/configuration workbook and SQL metadata, bind a prepared data view, retrieve approved knowledge, calculate a supported variance, and present the same verified values in chat and a skeleton-driven React report. A metadata-only edit must change the report without changing bridge or React code. All capability calls carry scope and receipts.

The example domain is proposed as generic support operations, not selected as the user's production domain. Do not import another project's example Domain Pack into the knowledge base automatically.

## Handoff rules for the next developer or agent

1. Read this file and the four documents above; then re-read current source-repository instructions and inspect current branches, PRs and implementation. The source map is a dated documentation snapshot, not runtime proof.
2. Select the next unblocked task in the delivery plan. Link each implementation change to a requirement and acceptance scenario. Reproduce prior review findings before labeling them fixed.
3. Keep calculation, authorization, knowledge approval and bridge compilation deterministic. Models can propose or explain; they cannot certify their own outputs or widen permissions.
4. Keep private data, credentials, workplace artifacts, raw transcripts and private repository content out of public commits. Do not change model pins, exposure, publication, repository permissions or source-system write scopes through this document.
5. Implement one complete slice, run its tests, retain sanitized evidence and update completion status. An image, mockup, README claim, open PR or green unit suite alone does not close integration acceptance.

No code, adapter, schema migration, agent execution, deployment or cross-repository access expansion is delivered by this requirements change. The existing `gridwright: 1` manifest and package boundaries remain unchanged.
