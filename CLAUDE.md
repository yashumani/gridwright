# Working instructions

## Objective

Complete the agreed task or project release, not an open-ended stream
of development. Continue necessary engineering, testing, debugging,
and documentation; prioritize a usable, verified outcome.

A narrowly scoped request remains narrowly scoped. Analysis or review
is not authorization to implement. Safety, approval boundaries,
workspace rules, and execution/budget limits take precedence over
completion pressure.

## Environment

Determine the environment before any action that creates, modifies,
deletes, or deploys. State it in one line before the first state-changing
action and reassess when the target changes.

**Production / approval-required — stop and get explicit human approval
if ANY apply:**
- A resource, endpoint, or service connection name contains `prod`.
- Anything can place, receive, or route a real PSTN phone call,
  or enables live calling.
- The target branch is `main`, `master`, or `release/*`.
- The action changes shared infrastructure other people or running
  services depend on.
- The environment cannot be determined.

Available credentials are not approval. A development branch does not
authorize production, shared-infrastructure, or live-calling changes.

**Development — pre-authorized, do not ask per action:**
- Branch `dev`, `dev-*`, `feature/*`, `claude/*`, `codex/*`, `codex_ys/*`,
  or `backup/*`, with none of the approval-required conditions above.
- Creating/deleting temporary resources, migrations, test infrastructure,
  and pushing to your own feature branch are authorized by class within
  the agreed scope and existing cost/compute limits.

> **This repository.** `main` is the default branch and every release
> path runs through it, so **merging a pull request into `main` requires
> explicit human approval each time** — opening the PR and driving its
> CI to green does not. Publishing to GitHub Pages, npm, or any other
> outward-facing destination is shared infrastructure and needs the same
> explicit approval. Feature branches and pushes to them are
> pre-authorized. The PSTN clause above is inherited from the source
> document and does not apply to this repository; it is kept rather than
> removed so the rule set stays portable.

## Workspace

- Work in the canonical repository only. Never create another working
  copy, clone, worktree, or `_codex-*` directory to continue work.
- Recover lost continuity through the handoff, `git status`, and the
  branch; do not start a fresh copy.
- Commit to the existing feature branch. Never leave commits on a
  detached HEAD.
- Preserve unrelated user changes. If two locations could be the source
  of truth, ask which is canonical.

## Completion plan

- Recover the agreed outcome, mandatory requirements, acceptance
  criteria, target environment, and exclusions from the request and
  existing project context before adding work.
- Maintain one concise completion checklist in the existing project
  plan/progress document. If none exists and the task needs one,
  create only one. Do not create a new reporting system.
- Describe requirements as usable outcomes, each with an acceptance
  check and current status: verified, incomplete, unverified, or blocked.
  Identify the next action that advances completion.
- Keep the agreed scope stable. Do not invent requirements, silently
  reduce scope to an MVP, or redefine acceptance to match what
  already works.
- Separate optional improvements from mandatory work. New defects
  that prevent agreed correctness, security, or reliability are not
  optional; explain their impact.

> **This repository's plan of record** already exists and must not be
> duplicated:
>
> | Document | Holds |
> |---|---|
> | `docs/project/UNIFIED_PLATFORM_REQUIREMENTS.md` | User intent U1–U6, requirements R01–R28, non-goals |
> | `docs/project/DELIVERY_AND_ACCEPTANCE.md` | Tasks T01–T20, acceptance scenarios A01–A12, gates G0–G4 |
> | `docs/project/ARCHITECTURE_AND_CONTRACTS.md` | Component responsibilities and the bridge's two paths |
> | `docs/project/SOURCE_MAP_AND_DECISIONS.md` | Open decisions D01–D09 |
> | `README.md` "Status", `CHANGELOG.md` | What is deliberately not built, and what changed |
>
> Cite the T/R/A/G/D identifier a piece of work serves. These
> requirements supersede earlier planning that made dashboard copying, a
> template marketplace, or generic CSV inference the main objective —
> existing features remain useful, but they are not the objective.

## Execution

- Choose work because it satisfies a requirement, removes a necessary
  blocker, or provides acceptance evidence. Prefer the next action
  that most directly advances completion.
- Complete and verify capabilities end-to-end instead of repeatedly
  polishing components or opening more partially finished work.
- Reuse working components. Defer unrelated refactoring, speculative
  infrastructure, extra features, and unnecessary documentation.
- Investigate failures and repair their causes within authorized scope
  and stopping limits. Before a hard stop, change tactics only when
  evidence supports a bounded approach to the same requirement.
- Reopen verified work only for relevant changes, new defects/evidence,
  or required revalidation. Do not repeat unchanged successful checks
  without a reason; do not rely on stale results.
- Keep executing authorized work after progress updates. A plan, commit,
  submitted job, checkpoint, or handoff is not a reason by itself
  to end the task.
- When all agreed requirements are verified, deliver the result and stop.
  Do not begin an optional improvement cycle.

## Done and evidence

- Done means the agreed outcome works in the required environment and
  all mandatory acceptance criteria are verified. Written code or
  successful job submission is not completion.
- Where a pipeline exists, the relevant pipeline for the delivered
  version must be green. This is required evidence, not a substitute
  for missing functionality or end-to-end acceptance.
- Do not skip or weaken required tests, suppress failures, or claim
  untested behavior works. Mark blocked or unavailable validation
  as unverified.
- Completion claims require actual evidence. Paste the smallest decisive
  command/pipeline-output excerpt in a short Evidence section after the
  outcome summary; reference full output in existing validation records.
  Never fabricate output; redact secrets.
- Keep evidence traceable to the tested version and relevant
  environment/configuration. Do not present a component's acceptance
  as acceptance of the entire project.
- Never report progress as a percentage. Use exact, clearly scoped
  counts and explain remaining requirements.
- Distinguish completed scope, work awaiting approval, blocked work,
  and a checkpoint with work remaining. Do not claim production release
  when promotion has not occurred.

> **This repository.** The pipeline is GitHub Actions on
> `ubuntu-latest` — `check` (build, `pnpm test`, CLI manifest
> validation, playground build), `Analyze`/`CodeQL`, and
> `dependency-review`. A new test must be shown to fail against the
> unfixed code before it counts as evidence that a defect is closed.
> Rendering work is verified by driving the built page in Chromium and
> looking at it, not by reading the diff.

## Stopping

Stop and report when:
- The same command has run 5 times without new information.
- 3 consecutive attempts have failed.
- You have polled 10 times.
- The task passes approximately 150 tool calls with no verifiable
  checkpoint.
- An unplanned blocker requires new approval, external action,
  additional budget, or a material scope/architecture decision.
- Any environment, safety, or permission boundary requires a stop.

An unexpected but solvable development/test failure is not automatically
an external blocker. Diagnose and fix it within the limits above.

Use sensible polling intervals. Do not evade limits by switching tools,
jobs, agents, or command spellings, or by creating artificial checkpoints.

On stopping: close spawned agents, refresh the handoff, and report the
project impact, what was tried, what failed or remains pending, the
recommended next step, and exactly what is needed. End the turn.

Do not, after a stopping condition: start a different approach unprompted,
spawn an agent to work around it, create a new directory, or keep polling.
A stopped run is not a completed project. Do not imply monitoring
continues after the turn ends.

## Subagents

- Only for disjoint write scopes with no shared state;
  maximum 2 concurrent.
- Every spawned agent must be closed in the same turn.
- Sequential work stays in the main thread. Subagents cannot bypass
  workspace or stopping rules.

## Reporting

- Communicate like a project lead; continue doing the engineering work.
  Apply this to initial explanations, in-progress updates, and
  final responses.
- Lead with what became usable or verified, why it matters for the
  project, and what still prevents completion. Explain the next
  completion-focused action when relevant.
- Make most narrative about capabilities, outcomes, readiness, risks,
  and decisions—not files, commands, branches, or internal machinery.
  Do not invent business benefits or imply intended benefits
  were measured.
- Keep routine updates to 1–3 natural sentences at meaningful
  checkpoints. Group related actions; do not narrate every tool call
  or repeat a status template mechanically.
- Use plain language and standard industry terms. Do not invent project
  vocabulary. Define codebase-specific terms on first use.
- When commands, errors, paths, identifiers, or numbers are shown,
  preserve their exactness. This is an accuracy requirement, not
  a requirement to show every technical detail.
- Keep routine technical inventories and telemetry in existing
  logs/handoffs. Surface necessary evidence, material failures,
  approval requests, and cost risks promptly.
- Finish with the project outcome, remaining requirements/blockers,
  any genuinely required user action, and concise evidence. Do not
  say no action is needed when approval, credentials, or a new
  authorized run is needed to proceed.

## Questions

- First look for answers in the current request, agreed requirements,
  repository guidance, and matching handoff. Do not ask for
  information already available.
- Ask up front, batched, when unresolved ambiguity changes what gets
  built, acceptance cannot be established from existing context,
  sources conflict, or a change touches a shared surface.
- A short request alone is not a reason to ask again for known
  acceptance criteria. For unresolved material choices, ask before
  implementing; use existing conventions for routine, reversible details.
- Do not stop mid-execution to request permission for authorized work
  or reconfirm an agreed plan. Required approval boundaries and
  stopping conditions still apply.

## Telemetry

> **Not executable in Claude Code, and recorded as such rather than
> worked around.** The source document says to load `ultrathink` and
> start its token telemetry. In Claude Code `ultrathink` is a
> reasoning-effort keyword a user types in a prompt, not a loadable
> skill, and this environment exposes no token- or cost-telemetry tool.
> Searching the tool surface for one returns nothing.
>
> So the measurable-cost instruction cannot be honoured here, and the
> rule that survives it is the one that matters: **never claim usage or
> cost was measured when it was not.** Do not present token counts,
> spend, or efficiency as measured. If a telemetry tool is added to this
> environment later, restore the original instruction and delete this
> note.

Keep routine telemetry out of the main project narrative.

## Handoff

> **Adapted.** The source document uses the `codex-handoff` skill and
> `$CODEX_HOME/handoffs/latest.md`. Neither exists here: there is no
> such skill, and `CODEX_HOME` is unset. Claude Code summarises its own
> context when a session grows long, so continuity across compaction is
> automatic and does not need a file.
>
> The durable half of the requirement still applies, and this repository
> already has somewhere for it to live — so **do not create a
> `handoffs/` directory or any new reporting system.** Record continuity
> in what exists: the task/requirement identifier in the commit message
> and pull-request body, status against `docs/project/`, and open
> questions in `SOURCE_MAP_AND_DECISIONS.md` as a D-number.

- When continuing, read the current branch, `git status`, the open pull
  requests, and `docs/project/DELIVERY_AND_ACCEPTANCE.md`. Confirm they
  match the canonical project and branch before relying on any of them.
- A pull-request body is this project's handoff. Include: goal, the
  task/requirement identifiers served, acceptance status, findings,
  blockers, validation evidence, and the next completion-focused action.
- Reconcile recorded claims with current evidence. A handoff is a
  continuity aid, not proof of acceptance; updating it is not itself
  project completion.

---

## Provenance and adaptations

Adopted from a Codex `agents.md` at the user's request. The body above is
that document; four things were changed because they name machinery that
does not exist in Claude Code, and silently leaving them in would produce
instructions that cannot be followed:

| Section | Change |
|---|---|
| Environment | Added `claude/*` to the pre-authorized branch list beside `codex/*`. Added a note making the `main`-merge and outward-publication approval rule concrete for this repository, and marking the inherited PSTN clause as not applicable here. |
| Completion plan | Named this repository's existing plan of record so "one checklist, no new reporting system" points at real documents. |
| Done and evidence | Named this repository's actual pipeline and its two local verification habits. |
| Telemetry | `ultrathink` is not a loadable skill here and no telemetry tool is exposed; recorded as unavailable, keeping the rule against claiming unmeasured cost. |
| Handoff | `codex-handoff` and `$CODEX_HOME` do not exist; continuity is recorded in commits, pull-request bodies and `docs/project/` instead. |

Nothing was removed. If any adaptation is wrong, correct it here rather
than working around it in a session.
