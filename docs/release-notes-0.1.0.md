# Gridwright 0.1.0: standalone preview

A reusable reporting library, CLI and browser playground using synthetic data.
The manifest drives filtering, aggregation, joins and React panels; the metadata
bridge preserves configured report structure. This is a pre-1.0 public preview.

## Downloads

- `gridwright-playground-0.1.0.html`: a self-contained app with synthetic examples,
  usable offline by opening the file in a browser.
- `gridwright-packages-0.1.0.tgz`: 13 built package tarballs plus a source/hash manifest.
  Install all tarballs together with npm; see [getting started](https://github.com/yashumani/gridwright/blob/v0.1.0/docs/getting-started.md#install-the-standalone-release).
- `manifest.json` and `SHA256SUMS`: exact source commit and artifact integrity.

The release workflow builds and runs the full suite, validates three reference
manifests with their data, verifies an external packed-package React/TypeScript/CLI
consumer, and runs the synthetic report, responsive export and accessibility
browser checks before creating this release. The Pages demo is deployed through
its separate main-branch workflow.

## Small release fixes

- Portable Windows rejection/path fixtures and explicit SQLite test cleanup.
- Bounded test workers preserve the existing large-data performance thresholds.
- CodeQL init/analyze pinned together at v4.38.2 and grouped for future updates.
- Clean-consumer acceptance in CI; browser discovery works on supported hosts.
- UKB responses with missing/unknown access decisions fail closed; denied
  responses retain no objects or evidence. Eight regressions reproduced the
  former permissive behavior before the repair.
- Credential-free package qualification separated from real npm publication.

## Limits

Packages are **not published to npm**. GitHub tarball installation is the supported
distribution for this preview. Node 22 is verified by the release workflow;
React 19.3 is used by the consumer acceptance. APIs may change before 1.0.

External service adapters are experimental fixture-qualified modules. Current
Talk2Data endpoint/response/identity differences and UKB identity/deployment
still need a separate private integration qualification. No live service,
SQL Server/Qlik/Vizlib compatibility, confidential data or production deployment
is accepted by this release. Private G3/G4 gates remain open.

Only conservative CSV inference and many-to-one joins are supported. Formatted
numbers, non-ASCII field identifiers, many-to-many joins and scale beyond the
documented in-browser limits remain excluded. Automated accessibility checks do
not replace a human reading-order/chart-meaning review. MIT license applies.
