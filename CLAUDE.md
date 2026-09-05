# Working instructions

## Objective

Complete the agreed task, not an open-ended stream of development. A narrowly
scoped request stays narrowly scoped; analysis is not authorization to
implement. Safety, approval boundaries, workspace rules and budget limits take
precedence over completion pressure.

## Approval

**Standing authorization, granted 2026-09-05, until withdrawn.** Every pull
request and every merge into `main` is already approved. Do not pause to ask,
and do not treat a merge, a green pipeline or a progress update as a place to
stop and wait — work through to project completion. The owner reviews daily and
steps in directly when needed.

Still stop and report first, because a revert cannot undo these:

- Publishing to npm. A version is immutable and the package name is claimed
  permanently.
- Force-pushing over commits that are not yours, rewriting `main`'s history, or
  deleting a remote branch holding unmerged work.
- Writing a credential, token or secret into the repository, a log, or an
  outward request.
- A resource, endpoint or connection name containing `prod`, or an environment
  that cannot be determined.

Everything else is authorized without asking: feature branches and pushes to
them, opening and merging pull requests, the GitHub Pages deploy that a merge
into `main` triggers, temporary resources, test infrastructure and migrations.

State the target environment once when work starts, and again only when it
changes.

## Workspace

Work in the canonical repository only — never a second clone, worktree or
scratch copy. Recover continuity from `git status`, the branch and open PRs.
Commit to the existing feature branch; never leave commits on a detached HEAD.
Preserve unrelated changes; if two locations could be canonical, ask which.

## Plan of record

Already exists — do not duplicate it or start a new reporting system:

- `docs/project/UNIFIED_PLATFORM_REQUIREMENTS.md` — intent U1–U6, requirements
  R01–R28, non-goals
- `docs/project/DELIVERY_AND_ACCEPTANCE.md` — tasks T01–T20, scenarios A01–A12,
  gates G0–G4
- `docs/project/ARCHITECTURE_AND_CONTRACTS.md` — component responsibilities
- `docs/project/SOURCE_MAP_AND_DECISIONS.md` — open decisions D01–D09
- `README.md` "Status" and `CHANGELOG.md` — what is deliberately not built

Cite the T/R/A/G/D identifier each piece of work serves. These requirements
supersede earlier planning that made dashboard copying, a template marketplace
or generic CSV inference the objective; those features remain useful but are
not the goal.

Keep scope stable: do not invent requirements, quietly reduce to an MVP, or
redefine acceptance to match what already works. New defects that break agreed
correctness, security or reliability are not optional — explain their impact.

## Execution

Choose work that satisfies a requirement, removes a blocker, or produces
acceptance evidence. Finish and verify one capability end-to-end rather than
opening more partly-done work. Reuse what works; defer unrelated refactoring
and speculative infrastructure.

Repair failure causes within scope. Do not reopen verified work without a
reason, and do not re-run unchanged successful checks. A commit, plan or
progress update is not itself a reason to stop. When every agreed requirement
is verified, deliver and stop — do not start an optional improvement cycle.

## Done and evidence

Done means the outcome works in the required environment with every mandatory
acceptance criterion verified. Written code is not completion.

- CI must be green on the delivered version. That is required evidence, not a
  substitute for end-to-end acceptance.
- Never skip or weaken tests, suppress failures, or claim untested behaviour
  works. Mark unavailable validation as unverified.
- A new test must be shown to **fail against the unfixed code** before it counts
  as evidence a defect is closed.
- Rendering work is verified by driving the built page in Chromium and looking
  at it, not by reading the diff.
- Paste the smallest decisive output excerpt in a short **Evidence** section
  after the outcome summary. Never fabricate output; redact secrets.
- **Never report progress as a percentage.** Use exact scoped counts and name
  what remains.
- Distinguish completed scope, work awaiting approval, blocked work, and a
  checkpoint with work remaining.

Pipeline: GitHub Actions on `ubuntu-latest` — `check` (build, `pnpm test`, CLI
manifest validation, playground build), `Analyze`/`CodeQL`, `dependency-review`.

## Cost control

Context is re-sent every turn, so waste compounds. Cheapest correct method wins.

- **Read narrowly.** `grep`/`sed -n` a region over reading a whole file. Never
  re-read a file just written or edited.
- **Test narrowly, then broadly.** Run the single affected test file while
  iterating; run the full suite once before pushing.
- **Do not poll.** Background work notifies on completion. No sleep-loops, no
  repeated status checks. Poll only external state nothing will report, at
  intervals matched to how fast it changes.
- **No subagents unless asked.** Each starts cold and re-derives context already
  held here. If explicitly requested: disjoint write scopes, at most 2, all
  closed in the same turn.
- **Do not narrate tool calls.** Group related actions into one update.
- No token or cost telemetry exists in this environment. **Never claim usage or
  cost was measured.**

## Stopping

Stop and report when: the same command has run 5 times without new information;
3 consecutive attempts have failed; roughly 150 tool calls have passed with no
verifiable checkpoint; a blocker needs new approval, external action or a
material scope decision; or any safety or permission boundary requires it.

A solvable test failure is not an external blocker — diagnose it within these
limits. Do not evade a limit by switching tools, spellings or agents.

On stopping: report impact, what was tried, what remains, the recommended next
step, and exactly what is needed. Then end the turn. Do not start a different
approach unprompted, keep polling, or imply monitoring continues.

## Reporting

Communicate like a project lead who is also doing the engineering. Lead with
what became usable or verified, why it matters, and what still blocks
completion. Keep routine updates to 1–3 sentences at real checkpoints.

Write about capabilities, outcomes, risks and decisions rather than files and
commands. Do not invent business benefits or imply unmeasured benefits were
measured. Use plain language; define codebase-specific terms on first use.
Preserve the exactness of any command, error, path, identifier or number shown.

Finish with the outcome, remaining blockers, any required user action, and
concise evidence. Do not say no action is needed when approval or credentials
are required to proceed.

## Questions

Look first in the request, the plan of record, and the repository. Ask up front
and batched when ambiguity changes what gets built, acceptance cannot be
established, or sources conflict. Use existing conventions for routine
reversible details. Do not pause mid-execution to reconfirm authorized work.

## Continuity

A pull-request body is this project's handoff: goal, task/requirement
identifiers, acceptance status, findings, blockers, evidence, next action. Open
questions become a D-number in `SOURCE_MAP_AND_DECISIONS.md`. Do not create a
`handoffs/` directory. Reconcile recorded claims against current evidence — a
handoff is a continuity aid, not proof of acceptance.
