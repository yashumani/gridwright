import { createHash } from "node:crypto";

/**
 * Approval records, and publication that cannot happen without one (task T18).
 *
 * R23 puts the whole design in one sentence: *a summary saying 'approved' is
 * not an approval record.* An approval here is a fact about a specific actor
 * approving a specific action on a specific input, with an expiry and a single
 * use — and every one of those five words is a way an approval gets misused
 * when it is missing.
 *
 * **Bound to the input, not to the intent.** The approval carries a digest of
 * the exact value approved. A change to that value after approval — one word
 * in a definition, one row in a configuration — produces a different digest and
 * the approval no longer applies. Without this, "approve the config change"
 * approves whatever the config becomes.
 *
 * **Bound to the action.** An approval to publish knowledge does not authorise
 * publishing configuration. Actions are compared exactly; there is no prefix
 * matching, because prefix matching is how `config.publish` quietly satisfies
 * `config.publish.force`.
 *
 * **One use.** A recorded consumption makes replay a refusal rather than a
 * second publication. An approval that can be spent twice is a permission, and
 * permissions are not what this is for.
 *
 * **Nothing here approves anything.** There is no path by which the process
 * asking for approval can create one — `record` takes a verified actor from the
 * caller's authenticated context, and a run has no way to reach it. Autonomous
 * approval is prevented by the absence of an API, not by a check.
 *
 * And read-only mode: when the store is opened read-only, `publish` refuses
 * regardless of how good the approval is. R23 keeps the first integrated
 * investigation read-only, and a mode that can be talked out of is not a mode.
 */

export interface ApprovalRecord {
  id: string;
  /** Established by the caller's authenticated context. Never self-asserted. */
  actor: string;
  /** The exact action, compared exactly. */
  action: string;
  /** What was approved, as a digest of the value itself. */
  inputDigest: string;
  /** The scope the approval was granted under. */
  scope: { tenant: string; domain: string };
  grantedAt: number;
  expiresAt: number;
  /** Set when spent. An approval is good once. */
  consumedAt?: number;
}

export type ApprovalRefusal =
  | "no-such-approval"
  | "wrong-action"
  | "wrong-input"
  | "wrong-scope"
  | "expired"
  | "already-used"
  | "read-only";

export type ApprovalOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: ApprovalRefusal; reason: string };

/** A stable digest of a value, so an approval names what it approved. */
export function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

/**
 * JSON with object keys sorted.
 *
 * `{a:1,b:2}` and `{b:2,a:1}` are the same configuration, and a digest that
 * disagrees would invalidate an approval because a serialiser changed its mind
 * about key order — which is exactly the sort of spurious refusal that trains
 * people to work around approvals.
 */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

/** A published version. Immutable once written. */
export interface PublishedVersion<T = unknown> {
  action: string;
  version: number;
  value: T;
  inputDigest: string;
  approvalId: string;
  publishedBy: string;
  publishedAt: number;
}

export interface ApprovalOptions {
  /** When true, `publish` always refuses. R23's read-only first integration. */
  readOnly?: boolean;
  /** Longest an approval may be valid for. Default 1 hour. */
  maxLifetimeMs?: number;
  now?: () => number;
}

export class ApprovalStore {
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly published = new Map<string, PublishedVersion[]>();
  private readonly readOnly: boolean;
  private readonly maxLifetimeMs: number;
  private readonly now: () => number;

  constructor(options: ApprovalOptions = {}) {
    this.readOnly = options.readOnly ?? false;
    this.maxLifetimeMs = options.maxLifetimeMs ?? 60 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Records an approval a person gave.
   *
   * `actor` comes from the caller's authenticated context. There is no
   * parameter here a run could fill in for itself, which is what makes
   * "no agent self-approves" structural.
   */
  record(input: {
    id: string;
    actor: string;
    action: string;
    value: unknown;
    scope: { tenant: string; domain: string };
    lifetimeMs?: number;
  }): ApprovalRecord {
    const grantedAt = this.now();
    const lifetime = Math.min(input.lifetimeMs ?? this.maxLifetimeMs, this.maxLifetimeMs);
    const record: ApprovalRecord = {
      id: input.id,
      actor: input.actor,
      action: input.action,
      inputDigest: digest(input.value),
      scope: { ...input.scope },
      grantedAt,
      expiresAt: grantedAt + lifetime,
    };
    this.approvals.set(record.id, record);
    return record;
  }

  /**
   * Checks an approval against the exact action, input and scope.
   *
   * Does not consume it — `publish` does. Separating them means a caller can
   * ask "would this be allowed" without spending the approval, which is what
   * a preview needs and what a check-then-act race would otherwise cost.
   */
  verify(
    approvalId: string,
    action: string,
    value: unknown,
    scope: { tenant: string; domain: string },
  ): ApprovalOutcome<ApprovalRecord> {
    const record = this.approvals.get(approvalId);
    if (!record) {
      return { ok: false, code: "no-such-approval", reason: `no approval "${approvalId}"` };
    }
    if (record.consumedAt !== undefined) {
      return {
        ok: false,
        code: "already-used",
        reason: "this approval was already spent; an approval is good once",
      };
    }
    if (this.now() >= record.expiresAt) {
      return { ok: false, code: "expired", reason: "this approval has expired" };
    }
    if (record.action !== action) {
      return {
        ok: false,
        code: "wrong-action",
        reason: `this approval is for "${record.action}", not "${action}"`,
      };
    }
    if (record.scope.tenant !== scope.tenant || record.scope.domain !== scope.domain) {
      return { ok: false, code: "wrong-scope", reason: "this approval was granted for another scope" };
    }
    if (record.inputDigest !== digest(value)) {
      return {
        ok: false,
        code: "wrong-input",
        reason:
          "the value changed since it was approved; the approval names what was approved, not " +
          "what the value later became",
      };
    }
    return { ok: true, value: record };
  }

  /**
   * Publishes a value, spending its approval.
   *
   * Read-only is checked first and cannot be argued with. Then the approval,
   * then the write — and the approval is consumed before the version is
   * recorded, so a failure after this point cannot leave a spendable approval
   * behind a completed publication.
   */
  publish<T>(input: {
    approvalId: string;
    action: string;
    value: T;
    scope: { tenant: string; domain: string };
    publishedBy: string;
  }): ApprovalOutcome<PublishedVersion<T>> {
    if (this.readOnly) {
      return {
        ok: false,
        code: "read-only",
        reason: "this runtime is read-only; publication needs a separately enabled capability",
      };
    }

    const verified = this.verify(input.approvalId, input.action, input.value, input.scope);
    if (!verified.ok) return verified;

    verified.value.consumedAt = this.now();

    const history = this.published.get(input.action) ?? [];
    const version: PublishedVersion<T> = {
      action: input.action,
      version: history.length + 1,
      // Frozen and deep-copied: a published version that a later edit can
      // reach is not a version, it is a reference to whatever the value is now.
      value: JSON.parse(JSON.stringify(input.value)) as T,
      inputDigest: verified.value.inputDigest,
      approvalId: input.approvalId,
      publishedBy: input.publishedBy,
      publishedAt: this.now(),
    };
    Object.freeze(version);
    history.push(version as PublishedVersion);
    this.published.set(input.action, history);
    return { ok: true, value: version };
  }

  /** Every published version of an action, oldest first. */
  history(action: string): readonly PublishedVersion[] {
    return this.published.get(action) ?? [];
  }

  /** The version in force, or undefined if nothing was ever published. */
  current(action: string): PublishedVersion | undefined {
    return this.published.get(action)?.at(-1);
  }
}

/**
 * A draft is a draft.
 *
 * R16 and R23 both require unapproved work to stay separate from what is
 * published. This is the whole rule as a function: given a store and an
 * action, a value is either the published one or it is not, and no third
 * state — "pending", "effectively approved", "approved in spirit" — exists.
 */
export function isPublished(store: ApprovalStore, action: string, value: unknown): boolean {
  const current = store.current(action);
  return current !== undefined && current.inputDigest === digest(value);
}
