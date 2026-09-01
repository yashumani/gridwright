# Security

## Reporting a vulnerability

Report privately through GitHub, not in a public issue:

**[Open a private security advisory](https://github.com/yashumani/gridwright/security/advisories/new)**
— on the repository, go to **Security → Report a vulnerability**.

Please include the manifest, expression or data file that triggers it, what you
expected, and what happened instead. A reproduction is worth more than a
description; the whole thing runs in a browser tab, so a minimal manifest is
usually enough.

Expect an acknowledgement within a few days. Gridwright is pre-1.0 and
maintained by a small number of people — if a fix will take a while, you will
be told that rather than left waiting. Please give us a chance to ship a fix
before publishing.

## What Gridwright treats as untrusted

This is the part worth reading before you deploy it, because it determines what
is a bug and what is your responsibility.

| Input | Trust | Why |
|---|---|---|
| The manifest (`.gw.yaml`) | **Untrusted** | Analysts write these, and the playground accepts uploads. Every ceiling, pattern check and escape exists because of this. |
| Measure expressions | **Untrusted** | They are a language, so they are parsed and analysed, never evaluated as JavaScript. |
| Data files (CSV, TSV, JSON) | **Untrusted** | Parsed by our own reader; nothing in a cell is ever interpreted as code. |
| Panel `props` | **Untrusted** | Validated against the panel's own schema before the component sees them. |
| The page embedding `<Dashboard>` | **Trusted** | It already runs your JavaScript. Gridwright cannot defend against its host. |
| A `DataSource` you supply | **Trusted** | It is your code, talking to your backend. See *Pushdown adapters* below. |

## What the design actually enforces

- **No dynamic evaluation anywhere.** No `eval`, no `new Function`, no
  string-bodied timers. Expressions are tokenised, parsed to an AST and either
  walked by an interpreter or compiled to SQL.
- **The grammar has no member-access node.** There is no `a.b` in the
  expression language, so an expression has no route to a host object even in
  principle — not because we filter for one, but because the shape cannot be
  written.
- **Object-internal names are rejected at the door.** `__proto__`,
  `constructor` and `prototype` are refused as identifiers, as record keys and
  as expression names. Both `JSON.parse` and the YAML parser materialise
  `__proto__` as a real own property, so this is a live concern, not a
  theoretical one. Shape checks use `Object.hasOwn`, and every record built from
  user keys uses a null-prototype object.
- **Every unbounded dimension of the format has a ceiling**, each with its own
  error message — manifest bytes, files, fields, measures, panels, filter
  values, expression length, AST depth and node count, parser recursion depth,
  YAML alias expansion, and result cells.
- **SQL identifiers are pattern-checked before interpolation** and refused
  otherwise. The plan compiler and the SQL emitter check independently, so a
  caller who hand-builds a plan cannot reach the query text with a raw
  identifier.
- **Data paths cannot leave the manifest's directory.** `gridwright validate
  --data` refuses `../` and absolute paths, so validating someone else's
  manifest is not an arbitrary file read.
- **Labels and values reach the DOM as React text.** No `dangerouslySetInnerHTML`
  anywhere in the project.
- **Nothing is uploaded.** The in-process engine runs every query in the tab.
  A file dropped into the playground never leaves the machine, and the
  standalone build makes no network requests at all after load.

## Pushdown adapters: read this before you write one

`planToSql` produces readable SQL with constants inlined, escaped for **ANSI
SQL** — Postgres, DuckDB, SQLite, Snowflake, BigQuery. Doubling the quote is
the whole of ANSI's escaping, and it is not enough for a backend that also
treats backslash as an escape character. **MySQL and MariaDB do, by default.**

Use **`planToSqlParams`** for anything that will actually execute. It binds
every constant — filter values and the constants inside measure expressions
alike — and returns `{ sql, params }` with `?` placeholders, so no manifest
string ever becomes SQL text:

```ts
const { sql, params } = planToSqlParams(plan);
const rows = await db.query(sql, params);   // rewrite ? to $1 if your driver wants that
```

`planToSql` is for `gridwright explain`, for display, and for backends you know
follow ANSI. If you interpolate its output into a MySQL query, you own the
result.

## Out of scope

- **Denial of service through a large manifest or data file.** The ceilings
  exist to give a clear error instead of a hang, not as a security boundary. A
  ten-million-row CSV will make a tab slow; that is documented behaviour.
- **Anything in the page hosting the dashboard.** If the host is compromised,
  Gridwright is running inside a compromised context and cannot help.
- **A `DataSource` you wrote.** Your adapter's SQL handling, credentials and
  authorization are yours. See the section above for the one trap we know of.
- **Dependency advisories.** Report those to the dependency. If one affects
  Gridwright specifically — a way to reach it through our API — that is in
  scope, and please say so.

## Supported versions

Pre-1.0. Fixes land on the latest release; there are no maintained release
branches yet. When 1.0 ships this section will say something more useful.
