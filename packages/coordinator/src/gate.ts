import {
  CapabilityRegistry,
  scanText,
  type Advice,
  type CapabilityRequest,
  type Classification,
  type Decision,
  type EnforcementContext,
  type Finding,
} from "@gridwright/contracts";

/**
 * The gate every tool call goes through (task T14).
 *
 * `@gridwright/contracts` already decides whether a call is permitted. What was
 * missing is the part that has to sit *around* the call: propagating the scope
 * that was authorised, checking what comes back, and failing closed when the
 * policy that would decide is not there.
 *
 * Three properties are worth stating because each is a way the obvious
 * implementation leaks.
 *
 * **Scope propagates by construction.** A capability is invoked with the
 * context the gate approved, not with one the callee assembles. There is no
 * parameter through which a specialist can widen its own scope, because the
 * invocation signature does not have one — R05 as a type rather than a rule.
 *
 * **Output is classified on the way out.** A capability declares the most
 * sensitive thing it can return; the gate checks the caller may receive that
 * *before* the call, and checks the actual result again *after*. The second
 * check is not redundant: a service can answer with more than its descriptor
 * promised, and the descriptor is a claim about the service rather than a
 * constraint on it.
 *
 * **No policy means no privileged execution.** If the adviser cannot be
 * reached, a call that needed advice does not proceed. The architecture says
 * privileged execution fails closed, and the failure mode of the alternative —
 * treating an unreachable policy service as silence, and silence as consent —
 * is how an outage becomes an escalation.
 */

export type RunStatus =
  | "running"
  | "needs_clarification"
  | "denied"
  | "awaiting_approval"
  | "partial"
  | "failed"
  | "cancelled"
  | "completed";

export interface Budget {
  timeoutMs: number;
  steps: number;
  retries: number;
}

/** What a capability is given. It cannot reach anything not named here. */
export interface Invocation<A = Record<string, unknown>> {
  readonly capability: string;
  readonly version: number;
  readonly arguments: A;
  /** The scope the gate approved. Read-only, and not the callee's to change. */
  readonly context: Readonly<EnforcementContext>;
  readonly budget: Readonly<Budget>;
  /** Resolves once the run is cancelled. A long call should race this. */
  readonly cancelled: () => boolean;
}

export type CapabilityHandler<A = Record<string, unknown>, R = unknown> = (
  invocation: Invocation<A>,
) => Promise<R>;

export interface GateOutcome<R = unknown> {
  status: RunStatus;
  /** Present only when the call ran and returned. */
  result?: R;
  /** Why it did not, in a code a caller can branch on. */
  reason?: string;
  code?: string;
  /** Classification of what actually came back, when anything did. */
  classification?: Classification;
  /** R24 findings over the returned text. */
  untrusted: Finding[];
  /** Steps and retries actually spent, for a parent run's accounting. */
  spent: { steps: number; retries: number; elapsedMs: number };
}

/**
 * How the gate learns whether a policy adviser had anything to say.
 *
 * Returning `undefined` means "nothing to add". Throwing means the adviser
 * could not be consulted, which is different and is treated as such.
 */
export type PolicyAdviser = (request: CapabilityRequest) => Promise<Advice | undefined>;

export interface GateOptions {
  /** Consulted after every deterministic check. Optional. */
  adviser?: PolicyAdviser;
  /** Capabilities that must not run without an adviser's opinion. */
  requiresAdvice?: readonly string[];
  /** Longest returned text scanned per field. Default 4000. */
  maxTextLength?: number;
}

const CLASSIFICATIONS: readonly Classification[] = ["public", "internal", "restricted"];

/** Walks a returned value and reports the highest classification it carries. */
function classifyResult(value: unknown, declared: Classification): Classification {
  // A service can answer with more than its descriptor promised. The declared
  // level is the floor, not the answer.
  let seen = declared;
  const visit = (v: unknown, depth: number): void => {
    if (depth > 6 || seen === "restricted") return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    if (typeof v === "object" && v !== null) {
      for (const [key, item] of Object.entries(v)) {
        const marker = key.toLowerCase();
        if (marker === "classification" && typeof item === "string") {
          const found = CLASSIFICATIONS.indexOf(item.toLowerCase() as Classification);
          if (found > CLASSIFICATIONS.indexOf(seen)) seen = CLASSIFICATIONS[found]!;
        }
        if (marker === "sensitivity" && typeof item === "string" && item.toLowerCase() !== "public") {
          if (CLASSIFICATIONS.indexOf("restricted") > CLASSIFICATIONS.indexOf(seen)) {
            seen = "restricted";
          }
        }
        visit(item, depth + 1);
      }
    }
  };
  visit(value, 0);
  return seen;
}

/** Collects every string in a returned value, bounded, for scanning. */
function strings(value: unknown, path: string, out: [string, string][], depth = 0): void {
  if (out.length >= 200 || depth > 6) return;
  if (typeof value === "string") {
    out.push([value, path]);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => strings(v, `${path}[${i}]`, out, depth + 1));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out, depth + 1);
  }
}

export class CapabilityGate {
  private readonly registry: CapabilityRegistry;
  private readonly handlers = new Map<string, CapabilityHandler<never, unknown>>();
  private readonly adviser: PolicyAdviser | undefined;
  private readonly requiresAdvice: Set<string>;
  private readonly maxTextLength: number;

  constructor(registry: CapabilityRegistry, options: GateOptions = {}) {
    this.registry = registry;
    this.adviser = options.adviser;
    this.requiresAdvice = new Set(options.requiresAdvice ?? []);
    this.maxTextLength = options.maxTextLength ?? 4000;
  }

  /** Binds a handler to a registered capability. */
  implement<A, R>(name: string, version: number, handler: CapabilityHandler<A, R>): void {
    this.handlers.set(`${name}@${version}`, handler as unknown as CapabilityHandler<never, unknown>);
  }

  /**
   * Runs one capability, or explains why it did not run.
   *
   * Never throws for a denial: a denial is a state a caller renders, and an
   * exception is a state a caller forgets to catch.
   */
  async call<R = unknown>(
    request: CapabilityRequest,
    context: EnforcementContext,
    cancelled: () => boolean = () => false,
  ): Promise<GateOutcome<R>> {
    const started = Date.now();
    const spent = { steps: 0, retries: 0, elapsedMs: 0 };
    const done = (o: Omit<GateOutcome<R>, "spent" | "untrusted"> & { untrusted?: Finding[] }) => ({
      untrusted: [],
      ...o,
      spent: { ...spent, elapsedMs: Date.now() - started },
    });

    if (cancelled()) return done({ status: "cancelled", reason: "the run was cancelled" });

    // Advice first — but only to *obtain* it. The deterministic checks below
    // still decide, and the registry runs advice last so an advised denial can
    // never mask a real failure.
    let advice: Advice | undefined;
    if (this.adviser) {
      try {
        advice = await this.adviser(request);
      } catch {
        if (this.requiresAdvice.has(request.capability)) {
          // Fails closed. Treating an unreachable adviser as silence, and
          // silence as consent, is how an outage becomes an escalation.
          return done({
            status: "denied",
            code: "policy-unavailable",
            reason: `"${request.capability}" needs a policy decision and the adviser could not be reached`,
          });
        }
        advice = undefined;
      }
    } else if (this.requiresAdvice.has(request.capability)) {
      return done({
        status: "denied",
        code: "policy-unavailable",
        reason: `"${request.capability}" needs a policy decision and no adviser is configured`,
      });
    }

    const decision: Decision = this.registry.authorize(request, context, advice ?? {});
    if (!decision.allowed) {
      return done({ status: "denied", code: decision.denial.code, reason: decision.denial.message });
    }

    const handler = this.handlers.get(`${request.capability}@${request.version}`);
    if (!handler) {
      return done({
        status: "failed",
        code: "capability-unimplemented",
        reason: `"${request.capability}" is registered but nothing implements it here`,
      });
    }

    const invocation: Invocation = Object.freeze({
      capability: request.capability,
      version: request.version,
      arguments: Object.freeze({ ...request.arguments }),
      // Frozen, so a handler cannot widen the scope it was given.
      context: Object.freeze({ ...context, scopes: Object.freeze([...context.scopes]) }),
      budget: Object.freeze({ ...decision.budget }),
      cancelled,
    });

    let result: unknown;
    let attempt = 0;
    for (;;) {
      spent.steps += 1;
      try {
        result = await this.withDeadline(
          handler(invocation as never),
          decision.budget.timeoutMs,
          request.capability,
        );
        break;
      } catch (error) {
        if (cancelled()) return done({ status: "cancelled", reason: "the run was cancelled" });
        if (attempt >= decision.budget.retries) {
          return done({
            status: "failed",
            code: "capability-failed",
            reason: `"${request.capability}" failed: ${(error as Error).message}`,
          });
        }
        attempt += 1;
        spent.retries += 1;
      }
    }

    if (cancelled()) return done({ status: "cancelled", reason: "the run was cancelled" });

    // The second classification check. The first one trusted the descriptor;
    // this one looks at what actually came back.
    const classification = classifyResult(result, decision.descriptor.outputClassification);
    if (CLASSIFICATIONS.indexOf(classification) > CLASSIFICATIONS.indexOf(context.maxClassification)) {
      return done({
        status: "denied",
        code: "classification-refused",
        reason:
          `"${request.capability}" returned ${classification} content and this caller may ` +
          `receive at most ${context.maxClassification}`,
        classification,
      });
    }

    const found: [string, string][] = [];
    strings(result, request.capability, found);
    const untrusted: Finding[] = [];
    for (const [value, path] of found) {
      untrusted.push(...scanText(value, path, { maxLength: this.maxTextLength }));
    }

    return done({ status: "completed", result: result as R, classification, untrusted });
  }

  private async withDeadline<T>(work: Promise<T>, timeoutMs: number, at: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${at} exceeded ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
