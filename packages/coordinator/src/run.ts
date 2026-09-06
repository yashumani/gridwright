import type { CapabilityRequest, EnforcementContext, Finding } from "@gridwright/contracts";
import { CapabilityGate, type Budget, type GateOutcome, type RunStatus } from "./gate.js";

/**
 * One run, one parent, a fixed budget (task T15).
 *
 * R01 and R04 between them say the thing this file exists to enforce: one
 * coordinator owns each user run, specialists get a task and a budget rather
 * than the ability to start more work, and a deterministic path is used when a
 * deterministic path is enough.
 *
 * The design decision that does the most here is what a specialist *is*. It is
 * a function that receives a `Step` and may call capabilities through the gate
 * — and that is all. It cannot start another run, because nothing it is given
 * can start one. "No delegated run spawns unlimited children" is therefore not
 * a limit that is checked; it is a shape with no recursion in it.
 *
 * The budget is spent, not merely declared. Every capability call subtracts
 * from one pool held by the run, so three specialists cannot each be given
 * "five steps" and take fifteen. When the pool is empty the run stops and says
 * `partial` — labelled, and never combined into an answer that looks complete.
 *
 * Cancellation propagates by being the same function everywhere. One flag, set
 * once, read by the run before each step, by the gate before and after each
 * call, and by any specialist that bothers to look.
 */

export interface RunBudget {
  /** Wall clock for the whole run. */
  totalMs: number;
  /** Capability calls the whole run may make. */
  steps: number;
  /** Retries the whole run may spend, across every call. */
  retries: number;
}

export interface Step {
  /** What this specialist was asked to do. Minimum context, by design. */
  readonly task: string;
  readonly context: Readonly<EnforcementContext>;
  /** Calls a capability through the gate, spending the run's budget. */
  readonly call: <R = unknown>(request: CapabilityRequest) => Promise<GateOutcome<R>>;
  readonly cancelled: () => boolean;
  /** What is left. A specialist that wants to be polite can look. */
  readonly remaining: () => { steps: number; retries: number; ms: number };
}

export type Specialist<R = unknown> = (step: Step) => Promise<R>;

export interface SpecialistSpec<R = unknown> {
  name: string;
  task: string;
  run: Specialist<R>;
  /**
   * Whether this specialist is needed for this question.
   *
   * R04: do not invoke every agent for every question. A specialist that
   * cannot contribute is not called, and that decision is made here rather
   * than inside the specialist after it has already spent a step.
   */
  when?: (context: Readonly<EnforcementContext>) => boolean;
}

export interface RunResult {
  status: RunStatus;
  runId: string;
  /** Each specialist's outcome, in the order they were run. */
  outcomes: { name: string; status: RunStatus; result?: unknown; reason?: string }[];
  /** Everything the gate flagged, across every call. */
  untrusted: Finding[];
  spent: { steps: number; retries: number; elapsedMs: number };
  /** Why the run stopped early, when it did. */
  stoppedBecause?: string;
}

export interface RunOptions {
  runId: string;
  context: EnforcementContext;
  budget: RunBudget;
  /** A clock, so a test is not at the mercy of a real one. */
  now?: () => number;
}

/**
 * The coordinator.
 *
 * Deliberately not an agent. It selects specialists, spends a budget and
 * collects typed results; it does not plan, and it has no path by which a
 * model could change what it does.
 */
export class Run {
  private readonly gate: CapabilityGate;
  private readonly options: RunOptions;
  private readonly now: () => number;
  private cancelledAt: number | undefined;
  /**
   * Why the run stopped, recorded where it stopped.
   *
   * Running out of time and being cancelled both stop the run, and both set
   * the same flag — so the reason has to be captured at the moment it is
   * decided. Reading it back off that flag afterwards reports every timeout as
   * a cancellation, which is a different thing to tell a user.
   */
  private stopReason: "cancelled" | "out of time" | undefined;
  /**
   * Whether the run has begun, tracked separately from when.
   *
   * A truthiness check on the start time reads fine and is wrong: a clock that
   * legitimately reports 0 — an injected one in a test, a monotonic one on a
   * fresh process — makes a started run look unstarted, and the deadline below
   * then never fires.
   */
  private running = false;
  private started = 0;
  private stepsLeft: number;
  private retriesLeft: number;
  private readonly untrusted: Finding[] = [];
  private used = { steps: 0, retries: 0 };

  constructor(gate: CapabilityGate, options: RunOptions) {
    this.gate = gate;
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.stepsLeft = options.budget.steps;
    this.retriesLeft = options.budget.retries;
  }

  /** Stops the run at the next checkpoint. Idempotent. */
  cancel(): void {
    if (this.cancelledAt !== undefined) return;
    this.cancelledAt = this.now();
    this.stopReason = "cancelled";
  }

  private cancelled = (): boolean => {
    if (this.cancelledAt !== undefined) return true;
    if (this.running && this.now() - this.started > this.options.budget.totalMs) {
      this.cancelledAt = this.now();
      this.stopReason = "out of time";
      return true;
    }
    return false;
  };

  private remaining = () => ({
    steps: this.stepsLeft,
    retries: this.retriesLeft,
    ms: Math.max(0, this.options.budget.totalMs - (this.now() - this.started)),
  });

  async execute(specialists: readonly SpecialistSpec[]): Promise<RunResult> {
    this.started = this.now();
    this.running = true;
    const outcomes: RunResult["outcomes"] = [];
    let stoppedBecause: string | undefined;

    for (const spec of specialists) {
      if (this.cancelled()) {
        stoppedBecause = this.stopReason;
        break;
      }
      if (spec.when && !spec.when(this.options.context)) {
        // R04: a deterministic or single-agent path when that is enough.
        outcomes.push({ name: spec.name, status: "completed", reason: "not needed for this question" });
        continue;
      }
      if (this.stepsLeft <= 0) {
        stoppedBecause = "the run's step budget is spent";
        break;
      }

      const step: Step = Object.freeze({
        task: spec.task,
        context: Object.freeze({
          ...this.options.context,
          scopes: Object.freeze([...this.options.context.scopes]),
        }),
        call: this.callThroughGate,
        cancelled: this.cancelled,
        remaining: this.remaining,
      });

      try {
        const result = await spec.run(step);
        outcomes.push({ name: spec.name, status: "completed", result });
      } catch (error) {
        outcomes.push({
          name: spec.name,
          status: "failed",
          reason: `${spec.name} failed: ${(error as Error).message}`,
        });
      }
    }

    const elapsedMs = this.now() - this.started;
    const anyFailed = outcomes.some((o) => o.status === "failed");
    const ranAll = outcomes.length === specialists.length;

    let status: RunStatus;
    if (this.stopReason === "cancelled" && !ranAll) status = "cancelled";
    else if (this.stopReason === "out of time" && !ranAll) status = "partial";
    else if (!ranAll) status = "partial";
    else if (anyFailed) status = "partial";
    else status = "completed";

    return {
      status,
      runId: this.options.runId,
      outcomes,
      untrusted: this.untrusted,
      spent: { ...this.used, elapsedMs },
      ...(stoppedBecause ? { stoppedBecause } : {}),
    };
  }

  /**
   * The only way a specialist reaches anything.
   *
   * Spends the run's pool rather than a per-specialist one, so three
   * specialists each promised five steps cannot take fifteen between them.
   */
  private callThroughGate = async <R>(request: CapabilityRequest): Promise<GateOutcome<R>> => {
    if (this.stepsLeft <= 0) {
      return {
        status: "partial",
        code: "budget-exhausted",
        reason: "the run's step budget is spent",
        untrusted: [],
        spent: { steps: 0, retries: 0, elapsedMs: 0 },
      };
    }
    if (this.cancelled()) {
      return {
        status: "cancelled",
        reason: "the run was cancelled",
        untrusted: [],
        spent: { steps: 0, retries: 0, elapsedMs: 0 },
      };
    }

    // A request may never ask for more than the run has left.
    const capped: CapabilityRequest = {
      ...request,
      budget: this.cap(request.budget),
    };

    const outcome = await this.gate.call<R>(capped, this.options.context, this.cancelled);
    this.stepsLeft -= outcome.spent.steps;
    this.retriesLeft -= outcome.spent.retries;
    this.used.steps += outcome.spent.steps;
    this.used.retries += outcome.spent.retries;
    this.untrusted.push(...outcome.untrusted);
    return outcome;
  };

  private cap(requested: Budget): Budget {
    return {
      timeoutMs: Math.min(requested.timeoutMs, Math.max(1, this.remaining().ms)),
      steps: Math.max(1, Math.min(requested.steps, this.stepsLeft)),
      retries: Math.max(0, Math.min(requested.retries, this.retriesLeft)),
    };
  }
}

/**
 * A partial result stays partial.
 *
 * R25 forbids combining partial results into an apparently complete answer,
 * and this is the one function a caller assembling a reply should go through.
 * It exists so the check is in one place rather than re-derived, badly, at
 * each surface that renders an answer.
 */
export function describeCompleteness(result: RunResult): {
  complete: boolean;
  label: string;
} {
  if (result.status === "completed") return { complete: true, label: "complete" };
  if (result.status === "cancelled") {
    return { complete: false, label: "cancelled before it finished — this is not a full answer" };
  }
  const missing = result.outcomes.filter((o) => o.status !== "completed").map((o) => o.name);
  return {
    complete: false,
    label:
      `partial${result.stoppedBecause ? ` (${result.stoppedBecause})` : ""}` +
      (missing.length > 0 ? ` — ${missing.join(", ")} did not contribute` : ""),
  };
}
