# Gridwright documentation

Start here if you are new:

- **[Getting started](getting-started.md)** — a working dashboard from a file
  and a manifest, then embedding one in your own app.

Reference:

- **[The manifest](manifest.md)** — every key in the format, with its type,
  default and limit.
- **[Expressions](expressions.md)** — the two-tier model and the full function
  catalogue.
- **[Joins](joins.md)** — relations, why cardinality is a correctness mechanism
  rather than metadata, and what is refused.
- **[Panels](panels.md)** — the four that ship, their props, the colour rules,
  and how to add your own.
- **[Data sources](data-sources.md)** — file loading, measured scale limits, and
  the `DataSource` seam for a real warehouse.

Background:

- **[Architecture](architecture.md)** — how a query actually runs, what each
  package owns, and how the builder edits without breaking.
- **[Security policy](../SECURITY.md)** — trust boundaries, what the design
  enforces, and how to report a problem.
- **[Contributing](../CONTRIBUTING.md)** — setup, the verification bar, and
  conventions.

Cross-project requirements and handoff:

- **[Shared orchestrator and metadata-bridge requirements](../PROJECT_REQUIREMENTS.md)** —
  the clarified Excel/SQL bridge and domain-chat integration with knowledge,
  verified analytics and MCP governance. Includes source boundaries, proposed
  contracts, twenty delivery tasks and acceptance gates. Documentation only;
  this is not a claim that the shared platform is implemented.
