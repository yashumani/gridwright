import type { Envelope, ServiceContext } from "./envelope.js";

/**
 * The check every tool call passes before it runs.
 *
 * R22 asks for deterministic policy enforcement at each MCP or tool boundary:
 * registered capability, schema, identity, scope, resource, arguments, quotas
 * and output classification — and it adds a sentence that shapes this whole
 * module: *a policy agent may advise but cannot grant access.*
 *
 * So there is no `allow`. Advice can only subtract. A model, a policy service
 * or a heuristic can hand in a denial and it will be honoured; hand in a
 * permission and there is nowhere for it to go, because the type has no field
 * for it. That is a stronger guarantee than a rule saying not to, and it costs
 * one omission.
 *
 * The checks run in a fixed order and the first failure stops. Order is part
 * of the contract: an unregistered capability must not have its arguments
 * validated, and a caller who fails scope must not learn whether their
 * arguments were well-formed. R04's budget — timeout, steps, retries — is
 * checked here too, so a bounded workflow is bounded by the same gate that
 * authorises it rather than by whoever remembers to.
 */

/** How much a value may be exposed. Ordered: each admits the ones before it. */
export const CLASSIFICATIONS = ["public", "internal", "restricted"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/** A tiny argument schema. Deliberately not a general JSON Schema. */
export type ArgumentType = "string" | "number" | "boolean" | "string[]";

export interface ArgumentSpec {
  type: ArgumentType;
  required?: boolean;
  /** For strings: the complete set of accepted values. */
  oneOf?: readonly string[];
  /** For strings and arrays: the longest accepted length. */
  maxLength?: number;
}

export interface Budget {
  timeoutMs: number;
  /** Most steps one invocation may take. */
  steps: number;
  /** Most retries after the first attempt. */
  retries: number;
}

export interface CapabilityDescriptor {
  name: string;
  /** Bumped when the arguments or meaning change. Requests name a version. */
  version: number;
  /** Every one of these must be held. There is no "any of". */
  requiredScopes: readonly string[];
  /** The weakest identity provenance this capability accepts. */
  minimumProvenance: ServiceContext["provenance"];
  arguments: Record<string, ArgumentSpec>;
  /** The most sensitive thing this capability can return. */
  outputClassification: Classification;
  /** The ceiling. A request may ask for less, never more. */
  budget: Budget;
}

export interface CapabilityRequest {
  capability: string;
  version: number;
  arguments: Record<string, unknown>;
  /** What this invocation asks for. Must fit inside the descriptor's ceiling. */
  budget: Budget;
}

/**
 * What a policy adviser may contribute.
 *
 * A denial and a reason. There is no counterpart that grants, and that absence
 * is the point — see the module comment.
 */
export interface Advice {
  deny?: { reason: string };
}

export type DenialCode =
  | "capability-unregistered"
  | "capability-version"
  | "identity-provenance"
  | "scope-insufficient"
  | "arguments-invalid"
  | "budget-exceeded"
  | "classification-refused"
  | "advised-denial";

export interface Denial {
  code: DenialCode;
  message: string;
}

export type Decision =
  | { allowed: true; descriptor: CapabilityDescriptor; budget: Budget }
  | { allowed: false; denial: Denial };

/** What the receiver is willing to let out, and how it identifies itself. */
export interface EnforcementContext extends ServiceContext {
  /** The most sensitive classification this caller may receive. */
  maxClassification: Classification;
}

const PROVENANCE_RANK: Record<ServiceContext["provenance"], number> = {
  delegated: 0,
  session: 1,
  "service-token": 2,
};

function checkArguments(
  spec: Record<string, ArgumentSpec>,
  args: Record<string, unknown>,
): string | undefined {
  for (const key of Object.keys(args)) {
    if (!(key in spec)) return `unknown argument "${key}"`;
  }
  for (const [key, s] of Object.entries(spec)) {
    const v = args[key];
    if (v === undefined || v === null) {
      if (s.required) return `argument "${key}" is required`;
      continue;
    }
    if (s.type === "string[]") {
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
        return `argument "${key}" must be an array of strings`;
      }
      if (s.maxLength !== undefined && v.length > s.maxLength) {
        return `argument "${key}" has ${v.length} entries, over the limit of ${s.maxLength}`;
      }
      continue;
    }
    if (typeof v !== s.type) return `argument "${key}" must be a ${s.type}`;
    if (s.type === "string") {
      const str = v as string;
      if (s.maxLength !== undefined && str.length > s.maxLength) {
        return `argument "${key}" is ${str.length} characters, over the limit of ${s.maxLength}`;
      }
      if (s.oneOf && !s.oneOf.includes(str)) {
        return `argument "${key}" must be one of ${s.oneOf.join(", ")}`;
      }
    }
    if (s.type === "number" && !Number.isFinite(v as number)) {
      return `argument "${key}" must be a finite number`;
    }
  }
  return undefined;
}

export class CapabilityRegistry {
  private readonly byName = new Map<string, CapabilityDescriptor>();

  constructor(descriptors: readonly CapabilityDescriptor[] = []) {
    for (const d of descriptors) this.register(d);
  }

  register(descriptor: CapabilityDescriptor): void {
    this.byName.set(`${descriptor.name}@${descriptor.version}`, descriptor);
  }

  /** Every registered capability, for a caller that needs to publish a list. */
  all(): CapabilityDescriptor[] {
    return [...this.byName.values()];
  }

  /**
   * Decides one invocation.
   *
   * The order is deliberate and tested: registration, then version, then
   * identity, then scope, then arguments, then budget, then output
   * classification, then advice. Advice runs last so a denial is never the
   * reason a real failure went unreported.
   */
  authorize(
    request: CapabilityRequest,
    context: EnforcementContext,
    advice: Advice = {},
  ): Decision {
    const deny = (code: DenialCode, message: string): Decision => ({
      allowed: false,
      denial: { code, message },
    });

    const anyVersion = [...this.byName.values()].some((d) => d.name === request.capability);
    const descriptor = this.byName.get(`${request.capability}@${request.version}`);
    if (!descriptor) {
      return anyVersion
        ? deny(
            "capability-version",
            `capability "${request.capability}" has no registered version ${request.version}`,
          )
        : deny("capability-unregistered", `capability "${request.capability}" is not registered`);
    }

    if (PROVENANCE_RANK[context.provenance] < PROVENANCE_RANK[descriptor.minimumProvenance]) {
      return deny(
        "identity-provenance",
        `"${descriptor.name}" needs an identity established by ${descriptor.minimumProvenance}, ` +
          `and this one is ${context.provenance}`,
      );
    }

    const missing = descriptor.requiredScopes.filter((s) => !context.scopes.includes(s));
    if (missing.length > 0) {
      return deny("scope-insufficient", `missing scope: ${missing.join(", ")}`);
    }

    const bad = checkArguments(descriptor.arguments, request.arguments);
    if (bad) return deny("arguments-invalid", bad);

    const b = request.budget;
    const ceiling = descriptor.budget;
    if (b.timeoutMs > ceiling.timeoutMs || b.steps > ceiling.steps || b.retries > ceiling.retries) {
      return deny(
        "budget-exceeded",
        `asked for ${b.timeoutMs}ms/${b.steps} steps/${b.retries} retries, over ` +
          `${ceiling.timeoutMs}ms/${ceiling.steps} steps/${ceiling.retries} retries`,
      );
    }
    if (b.timeoutMs <= 0 || b.steps <= 0 || b.retries < 0) {
      return deny("budget-exceeded", "a budget must be positive");
    }

    if (
      CLASSIFICATIONS.indexOf(descriptor.outputClassification) >
      CLASSIFICATIONS.indexOf(context.maxClassification)
    ) {
      return deny(
        "classification-refused",
        `"${descriptor.name}" returns ${descriptor.outputClassification} output and this caller ` +
          `may receive at most ${context.maxClassification}`,
      );
    }

    if (advice.deny) {
      return deny("advised-denial", `denied on advice: ${advice.deny.reason}`);
    }

    return { allowed: true, descriptor, budget: b };
  }
}

/**
 * The scope a handoff is judged under — always the receiver's own context.
 *
 * A one-line function that exists to be the only answer to "where does the
 * scope come from". A payload cannot contribute to it, which is what makes
 * R05 checkable rather than a convention: the envelope is not even a
 * parameter here.
 */
export function effectiveScope(context: ServiceContext): readonly string[] {
  return context.scopes;
}

/** Convenience: the run/session/domain a handoff belongs to, for logging. */
export function handoffTrace(envelope: Envelope): {
  run: string;
  session: string;
  domain: string;
  receipts: string[];
} {
  return {
    run: envelope.run,
    session: envelope.session,
    domain: envelope.domain,
    receipts: envelope.receipts.map((r) => `${r.issuer}:${r.id}`),
  };
}
