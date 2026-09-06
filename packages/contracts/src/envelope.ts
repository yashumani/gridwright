/**
 * The versioned artifact two products hand to each other.
 *
 * Every requirement this file serves comes down to one idea: **a handoff
 * carries its own context, and the receiver checks it rather than trusting
 * it.** R19 lists what has to travel — run, session, domain, and the source,
 * policy, semantic, configuration and result versions — and says stale,
 * malformed or out-of-scope handoffs are rejected. That is a validation
 * problem, so this module is a validator and nothing else. It opens no
 * connections and calls no services.
 *
 * Three decisions are worth stating outright, because each of them is a thing
 * this module refuses to do.
 *
 * **Identity is not in the envelope.** R05 requires tenant, user and effective
 * scope to come from authenticated service context, and says request-body
 * fields cannot self-assign authority. The obvious reading is "ignore an
 * identity in the body". The stricter one, taken here, is that an envelope
 * carrying an identity field is *malformed* — because the only reason to put
 * one there is to have it believed, and a handoff built to be believed should
 * fail loudly at the boundary rather than travel on with a field that looks
 * authoritative and is not.
 *
 * **Receipts are copied, never minted.** R19 says to preserve an adapter's
 * existing receipt IDs rather than mint unsupported claims of certification.
 * So a receipt here is three fields — who issued it, its id, and when — and an
 * unknown key on one is a rejection. There is no constructor. A receipt exists
 * because an adapter returned it; this library has nothing to certify.
 *
 * **A newer contract is refused by name.** The same rule the manifest format
 * already follows: an envelope from a future version of the contract is
 * refused with its version in the message, not parsed on a best-effort basis.
 * A version mismatch must never be a silently wrong handoff.
 */

/** The contract version this build understands. */
export const CONTRACT_VERSION = 1;

/**
 * A receipt an adapter issued, carried verbatim.
 *
 * Not a certification, and not evidence of one. It is a pointer back into the
 * issuing system's own audit record, which is the only place the claim it
 * represents actually lives.
 */
export interface Receipt {
  /** The adapter that issued it, e.g. `talk2data`. */
  issuer: string;
  /** The issuer's own identifier. Opaque here. */
  id: string;
  /** RFC 3339, from the issuer's clock. */
  issuedAt: string;
}

/** The versions a handoff carries so a receiver can reject a stale one. */
export interface EnvelopeVersions {
  /** The data source's version or snapshot id. */
  source: string;
  /** The policy set in force when this was produced. */
  policy: string;
  /** The approved metric/semantic definitions used. */
  semantic: string;
  /** The report or adapter configuration used. */
  configuration: string;
  /** The producing computation's own result version. */
  result: string;
}

export interface Envelope<T = unknown> {
  /** Contract format version. A higher number is refused by name. */
  contract: number;
  /** What this envelope carries, e.g. `report.definition`. */
  kind: string;
  /** The coordinating run this handoff belongs to. */
  run: string;
  /** The session the run belongs to. */
  session: string;
  /** The business domain, checked against what the receiver admits. */
  domain: string;
  /** RFC 3339. When the producer built this. */
  issuedAt: string;
  /** RFC 3339. After this the handoff is stale and refused. */
  expiresAt: string;
  versions: EnvelopeVersions;
  /** Issuer receipts, carried through untouched. */
  receipts: Receipt[];
  /**
   * Authoritative semantic definition ids this artifact depends on. Explicit
   * mappings, per R07 — an id, never a label, because two metrics may share a
   * label and mean different things.
   */
  semanticRefs: string[];
  /** The artifact itself. Never read for identity, scope or authority. */
  payload: T;
}

/**
 * Identity, derived by the receiver from its authenticated service context.
 *
 * Passed *alongside* an envelope, never inside one. `provenance` records how
 * the identity was established, so a caller can require a stronger one for a
 * sensitive capability rather than treating every authenticated request alike.
 */
export interface ServiceContext {
  tenant: string;
  user: string;
  /** The effective access scope, already resolved by the caller. */
  scopes: readonly string[];
  /** How this identity was established. */
  provenance: "service-token" | "session" | "delegated";
  /** Domains this receiver will accept a handoff for. */
  domains: readonly string[];
  /** The approved semantic definitions, and their version. */
  semantics: { version: string; admitted: readonly string[] };
}

export type ProblemCode =
  | "not-an-object"
  | "contract-unsupported"
  | "field-missing"
  | "field-type"
  | "identity-in-envelope"
  | "receipt-malformed"
  | "timestamp-malformed"
  | "expired"
  | "issued-after-expiry"
  | "domain-out-of-scope"
  | "semantic-version-mismatch"
  | "semantic-unknown";

export interface Problem {
  code: ProblemCode;
  /** Dotted path into the envelope, e.g. `versions.semantic`. */
  path: string;
  message: string;
}

export type EnvelopeResult<T> =
  | { ok: true; envelope: Envelope<T> }
  | { ok: false; problems: Problem[] };

/**
 * Fields that must never appear on an envelope.
 *
 * Not a sanitiser — a tripwire. Each of these is a way of saying "I am
 * someone", and the receiver already knows who the caller is from its own
 * authenticated context. An envelope carrying one is refused rather than
 * cleaned, because cleaning it would let a handoff built to escalate travel on
 * looking well-formed.
 */
const IDENTITY_FIELDS = [
  "tenant",
  "user",
  "userId",
  "scope",
  "scopes",
  "identity",
  "principal",
  "actAs",
  "impersonate",
  "roles",
  "permissions",
  "authority",
] as const;

const RECEIPT_FIELDS = new Set(["issuer", "id", "issuedAt"]);

const VERSION_FIELDS = ["source", "policy", "semantic", "configuration", "result"] as const;

/** RFC 3339 with a `Z` or numeric offset. Deliberately strict. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(
  o: Record<string, unknown>,
  key: string,
  path: string,
  problems: Problem[],
): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) {
    problems.push({ code: "field-missing", path, message: `${path} is required` });
    return undefined;
  }
  if (typeof v !== "string" || v.length === 0) {
    problems.push({ code: "field-type", path, message: `${path} must be a non-empty string` });
    return undefined;
  }
  return v;
}

function requireTimestamp(
  o: Record<string, unknown>,
  key: string,
  path: string,
  problems: Problem[],
): string | undefined {
  const v = requireString(o, key, path, problems);
  if (v === undefined) return undefined;
  if (!TIMESTAMP.test(v)) {
    problems.push({
      code: "timestamp-malformed",
      path,
      message: `${path} must be an RFC 3339 timestamp, got "${v}"`,
    });
    return undefined;
  }
  return v;
}

export interface ValidateOptions {
  /** The moment to judge staleness against. Injected so tests are fixed. */
  now?: Date;
}

/**
 * Validates one envelope against a receiver's own context.
 *
 * Every problem found is reported, not just the first: a producer fixing a
 * handoff should not have to make eleven round trips to learn eleven things.
 */
export function validateEnvelope<T = unknown>(
  value: unknown,
  context: ServiceContext,
  options: ValidateOptions = {},
): EnvelopeResult<T> {
  const problems: Problem[] = [];
  if (!isObject(value)) {
    return {
      ok: false,
      problems: [{ code: "not-an-object", path: "", message: "an envelope must be an object" }],
    };
  }

  // Version first. Everything below assumes this build's field set, so
  // reporting the shape of a contract we do not know would be guesswork.
  const contract = value["contract"];
  if (typeof contract !== "number" || !Number.isInteger(contract)) {
    return {
      ok: false,
      problems: [
        { code: "field-type", path: "contract", message: "contract must be an integer version" },
      ],
    };
  }
  if (contract > CONTRACT_VERSION) {
    return {
      ok: false,
      problems: [
        {
          code: "contract-unsupported",
          path: "contract",
          message: `envelope contract ${contract} is newer than this build's ${CONTRACT_VERSION}`,
        },
      ],
    };
  }
  if (contract < CONTRACT_VERSION) {
    return {
      ok: false,
      problems: [
        {
          code: "contract-unsupported",
          path: "contract",
          message: `envelope contract ${contract} is no longer supported; this build reads ${CONTRACT_VERSION}`,
        },
      ],
    };
  }

  for (const field of IDENTITY_FIELDS) {
    if (field in value) {
      problems.push({
        code: "identity-in-envelope",
        path: field,
        message:
          `"${field}" cannot travel in an envelope — identity and scope are derived ` +
          "from authenticated service context, so a field here can only be an attempt to assert one",
      });
    }
  }

  const kind = requireString(value, "kind", "kind", problems);
  requireString(value, "run", "run", problems);
  requireString(value, "session", "session", problems);
  const domain = requireString(value, "domain", "domain", problems);
  const issuedAt = requireTimestamp(value, "issuedAt", "issuedAt", problems);
  const expiresAt = requireTimestamp(value, "expiresAt", "expiresAt", problems);

  const versions = value["versions"];
  if (!isObject(versions)) {
    problems.push({ code: "field-missing", path: "versions", message: "versions is required" });
  } else {
    for (const field of VERSION_FIELDS) {
      requireString(versions, field, `versions.${field}`, problems);
    }
  }

  const receipts = value["receipts"];
  if (!Array.isArray(receipts)) {
    problems.push({ code: "field-missing", path: "receipts", message: "receipts is required (use [] for none)" });
  } else {
    receipts.forEach((r, i) => {
      const path = `receipts[${i}]`;
      if (!isObject(r)) {
        problems.push({ code: "receipt-malformed", path, message: `${path} must be an object` });
        return;
      }
      for (const key of Object.keys(r)) {
        if (!RECEIPT_FIELDS.has(key)) {
          problems.push({
            code: "receipt-malformed",
            path: `${path}.${key}`,
            message:
              `unknown receipt field "${key}" — a receipt is an issuer's identifier carried ` +
              "verbatim, not a place to attach a claim",
          });
        }
      }
      requireString(r, "issuer", `${path}.issuer`, problems);
      requireString(r, "id", `${path}.id`, problems);
      requireTimestamp(r, "issuedAt", `${path}.issuedAt`, problems);
    });
  }

  const refs = value["semanticRefs"];
  if (!Array.isArray(refs)) {
    problems.push({
      code: "field-missing",
      path: "semanticRefs",
      message: "semanticRefs is required (use [] for none)",
    });
  } else {
    refs.forEach((r, i) => {
      if (typeof r !== "string" || r.length === 0) {
        problems.push({
          code: "field-type",
          path: `semanticRefs[${i}]`,
          message: "a semantic reference must be a non-empty id",
        });
        return;
      }
      // An explicit mapping, per R07. A definition the receiver has not
      // approved is refused; there is no label match to fall back on, because
      // two metrics can share a label and mean different things.
      if (!context.semantics.admitted.includes(r)) {
        problems.push({
          code: "semantic-unknown",
          path: `semanticRefs[${i}]`,
          message: `"${r}" is not an approved semantic definition for this receiver`,
        });
      }
    });
  }

  if (!("payload" in value)) {
    problems.push({ code: "field-missing", path: "payload", message: "payload is required" });
  }

  if (domain !== undefined && !context.domains.includes(domain)) {
    problems.push({
      code: "domain-out-of-scope",
      path: "domain",
      message: `domain "${domain}" is not one this receiver admits`,
    });
  }

  if (isObject(versions) && typeof versions["semantic"] === "string") {
    if (versions["semantic"] !== context.semantics.version) {
      problems.push({
        code: "semantic-version-mismatch",
        path: "versions.semantic",
        message:
          `handoff was computed against semantic version "${versions["semantic"]}", ` +
          `and this receiver is on "${context.semantics.version}"`,
      });
    }
  }

  if (issuedAt !== undefined && expiresAt !== undefined) {
    const from = Date.parse(issuedAt);
    const until = Date.parse(expiresAt);
    if (until <= from) {
      problems.push({
        code: "issued-after-expiry",
        path: "expiresAt",
        message: "expiresAt must be after issuedAt",
      });
    } else {
      const now = (options.now ?? new Date()).getTime();
      if (now >= until) {
        problems.push({
          code: "expired",
          path: "expiresAt",
          message: `handoff expired at ${expiresAt}`,
        });
      }
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  // Rebuilt field by field rather than cast, so nothing unvalidated rides
  // along on the object the caller gets back.
  const v = versions as Record<string, unknown>;
  return {
    ok: true,
    envelope: {
      contract: CONTRACT_VERSION,
      kind: kind!,
      run: value["run"] as string,
      session: value["session"] as string,
      domain: domain!,
      issuedAt: issuedAt!,
      expiresAt: expiresAt!,
      versions: {
        source: v["source"] as string,
        policy: v["policy"] as string,
        semantic: v["semantic"] as string,
        configuration: v["configuration"] as string,
        result: v["result"] as string,
      },
      receipts: (receipts as Receipt[]).map((r) => ({
        issuer: r.issuer,
        id: r.id,
        issuedAt: r.issuedAt,
      })),
      semanticRefs: [...(refs as string[])],
      payload: value["payload"] as T,
    },
  };
}
