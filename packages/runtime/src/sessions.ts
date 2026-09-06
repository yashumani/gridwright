import { createHash } from "node:crypto";

/**
 * Scoped sessions, artifacts and a cache that respects the same boundary
 * (task T17).
 *
 * R19 through R21 ask for four separate things that a naive store conflates
 * into one map: session history, working context, investigation artifacts and
 * approved durable knowledge. This module holds the first three; the fourth is
 * UKB's, and nothing here can promote anything into it.
 *
 * The rule that shapes everything below is R21's, and it is the one most
 * implementations get wrong: **authorization is rechecked when an artifact is
 * retrieved, not only when it was stored.** A store that checks on write and
 * trusts on read is a store where revoking someone's access changes nothing
 * they have already touched. So every read takes a scope and is answered
 * against the scope, and a cache entry's identity includes the scope it was
 * computed under — which is what makes "no cross-tenant reuse" a property of
 * the key rather than a promise about the caller.
 *
 * The second rule is A12's: a late or incompatible result cannot overwrite an
 * active session. Results carry the versions they were computed against, and a
 * write whose versions are not the session's current ones is refused rather
 * than applied — a slow analysis returning after the user changed the period
 * must not silently replace the numbers on screen.
 */

/** Who is asking. Derived from authenticated context, never from a body. */
export interface Scope {
  tenant: string;
  user: string;
  scopes: readonly string[];
  domain: string;
}

/** The versions a result was computed against. All of them, per R19. */
export interface Versions {
  source: string;
  policy: string;
  semantic: string;
  configuration: string;
}

export type ArtifactKind = "message" | "analysis" | "report" | "evidence" | "note";

export interface Artifact<T = unknown> {
  id: string;
  kind: ArtifactKind;
  /** The run that produced it. */
  runId: string;
  versions: Versions;
  createdAt: number;
  /** Sanitised payload. Secrets never reach a store. */
  value: T;
}

export type StoreOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: StoreDenial; reason: string };

export type StoreDenial =
  | "no-such-session"
  | "cross-tenant"
  | "cross-user"
  | "scope-insufficient"
  | "domain-mismatch"
  | "stale-versions"
  | "expired"
  | "deleted";

interface StoredSession {
  id: string;
  owner: Scope;
  /** Scopes a reader must hold. Copied at creation; not the reader's to send. */
  requiredScopes: readonly string[];
  versions: Versions;
  createdAt: number;
  lastTouchedAt: number;
  artifacts: Map<string, Artifact>;
  deletedAt?: number;
}

export interface SessionOptions {
  /** How long a session survives without being touched. Default 24h. */
  retentionMs?: number;
  now?: () => number;
}

const sameVersions = (a: Versions, b: Versions): boolean =>
  a.source === b.source &&
  a.policy === b.policy &&
  a.semantic === b.semantic &&
  a.configuration === b.configuration;

export class SessionStore {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly retentionMs: number;
  private readonly now: () => number;

  constructor(options: SessionOptions = {}) {
    this.retentionMs = options.retentionMs ?? 24 * 60 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  open(id: string, owner: Scope, versions: Versions, requiredScopes: readonly string[] = []): void {
    const at = this.now();
    this.sessions.set(id, {
      id,
      owner: { ...owner, scopes: [...owner.scopes] },
      requiredScopes: [...requiredScopes],
      versions,
      createdAt: at,
      lastTouchedAt: at,
      artifacts: new Map(),
    });
  }

  /**
   * The single authorization check, applied on every read and every write.
   *
   * One function rather than a check at each call site, because the failure
   * mode of the alternative is a path somebody forgot — and the path somebody
   * forgets is always a read.
   */
  private authorize(sessionId: string, reader: Scope): StoreOutcome<StoredSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, code: "no-such-session", reason: `no session "${sessionId}"` };
    }
    if (session.deletedAt !== undefined) {
      return { ok: false, code: "deleted", reason: "this session was deleted" };
    }
    if (this.now() - session.lastTouchedAt > this.retentionMs) {
      return { ok: false, code: "expired", reason: "this session is past its retention window" };
    }
    // Tenant before user: a cross-tenant read must not be able to learn
    // whether a user id exists in another tenant.
    if (session.owner.tenant !== reader.tenant) {
      return { ok: false, code: "cross-tenant", reason: "this session belongs to another tenant" };
    }
    if (session.owner.user !== reader.user) {
      return { ok: false, code: "cross-user", reason: "this session belongs to another user" };
    }
    if (session.owner.domain !== reader.domain) {
      return { ok: false, code: "domain-mismatch", reason: "this session is for another domain" };
    }
    const missing = session.requiredScopes.filter((s) => !reader.scopes.includes(s));
    if (missing.length > 0) {
      return { ok: false, code: "scope-insufficient", reason: `missing scope: ${missing.join(", ")}` };
    }
    return { ok: true, value: session };
  }

  /**
   * Stores an artifact, refusing one computed against versions the session has
   * moved past.
   *
   * A12: a late or incompatible result cannot overwrite an active session. The
   * analysis that returns after the user changed the period is not wrong — it
   * is answering a question nobody is asking any more.
   */
  put<T>(sessionId: string, reader: Scope, artifact: Artifact<T>): StoreOutcome<Artifact<T>> {
    const found = this.authorize(sessionId, reader);
    if (!found.ok) return found;
    const session = found.value;

    if (!sameVersions(session.versions, artifact.versions)) {
      return {
        ok: false,
        code: "stale-versions",
        reason:
          "this result was computed against versions the session has moved past; it is not " +
          "written, because a late answer must not replace a current one",
      };
    }

    session.artifacts.set(artifact.id, artifact as Artifact);
    session.lastTouchedAt = this.now();
    return { ok: true, value: artifact };
  }

  get<T>(sessionId: string, reader: Scope, artifactId: string): StoreOutcome<Artifact<T>> {
    const found = this.authorize(sessionId, reader);
    if (!found.ok) return found;
    const artifact = found.value.artifacts.get(artifactId);
    if (!artifact) {
      return { ok: false, code: "no-such-session", reason: `no artifact "${artifactId}"` };
    }
    found.value.lastTouchedAt = this.now();
    return { ok: true, value: artifact as Artifact<T> };
  }

  list(sessionId: string, reader: Scope, kind?: ArtifactKind): StoreOutcome<Artifact[]> {
    const found = this.authorize(sessionId, reader);
    if (!found.ok) return found;
    const all = [...found.value.artifacts.values()];
    return { ok: true, value: kind ? all.filter((a) => a.kind === kind) : all };
  }

  /** Moves the session to new versions, so later writes are checked against them. */
  revise(sessionId: string, reader: Scope, versions: Versions): StoreOutcome<Versions> {
    const found = this.authorize(sessionId, reader);
    if (!found.ok) return found;
    found.value.versions = versions;
    found.value.lastTouchedAt = this.now();
    return { ok: true, value: versions };
  }

  /**
   * Deletes a session and everything in it.
   *
   * Tombstoned rather than dropped, so a later read is told the session was
   * deleted rather than that it never existed — R20's deletion has to be
   * observable, and "no such session" would let a deletion look like a bug.
   */
  delete(sessionId: string, reader: Scope): StoreOutcome<number> {
    const found = this.authorize(sessionId, reader);
    if (!found.ok) return found;
    const count = found.value.artifacts.size;
    found.value.artifacts.clear();
    found.value.deletedAt = this.now();
    return { ok: true, value: count };
  }

  /** Sessions past retention, for a sweeper. Reading one already refuses. */
  expired(): string[] {
    const at = this.now();
    return [...this.sessions.values()]
      .filter((s) => s.deletedAt === undefined && at - s.lastTouchedAt > this.retentionMs)
      .map((s) => s.id);
  }
}

/**
 * A cache whose key is the whole boundary (R21).
 *
 * Everything that could change the right answer is in the key: tenant, user,
 * effective scope, domain, and each of the four versions. A hit is therefore
 * only ever a hit for the exact conditions it was computed under, which is what
 * makes "no cross-tenant reuse" a property of the key rather than a rule the
 * caller has to remember.
 *
 * Scopes are sorted before hashing, because `["a","b"]` and `["b","a"]` are the
 * same authority and a cache that treats them as different keys quietly halves
 * its own hit rate — and, worse, makes a revocation test pass for the wrong
 * reason.
 */
export function cacheKey(scope: Scope, versions: Versions, request: unknown): string {
  const material = JSON.stringify({
    t: scope.tenant,
    u: scope.user,
    s: [...scope.scopes].sort(),
    d: scope.domain,
    v: [versions.source, versions.policy, versions.semantic, versions.configuration],
    r: request,
  });
  return createHash("sha256").update(material).digest("hex");
}

export interface CacheEntry<T> {
  value: T;
  storedAt: number;
  scope: Scope;
  versions: Versions;
}

export interface CacheOptions {
  /** How long an entry may be served. Default 5 minutes. */
  ttlMs?: number;
  /** Most entries held. Oldest is evicted first. Default 1000. */
  maxEntries?: number;
  now?: () => number;
}

export class ScopedCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly revoked = new Set<string>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: CacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 1000;
    this.now = options.now ?? (() => Date.now());
  }

  set<T>(scope: Scope, versions: Versions, request: unknown, value: T): string {
    const key = cacheKey(scope, versions, request);
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, storedAt: this.now(), scope, versions });
    return key;
  }

  get<T>(scope: Scope, versions: Versions, request: unknown): T | undefined {
    const key = cacheKey(scope, versions, request);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.storedAt > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    // A revoked principal's entries stop being served even before they expire.
    if (this.revoked.has(`${entry.scope.tenant}/${entry.scope.user}`)) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  /**
   * Stops serving anything computed for this principal.
   *
   * R21: revocation invalidates access. Marking rather than sweeping, because
   * a sweep that misses one entry is a revocation that did not happen, and a
   * mark checked on read cannot miss.
   */
  revoke(tenant: string, user: string): void {
    this.revoked.add(`${tenant}/${user}`);
  }

  /** Drops everything computed under a version that has moved on. */
  invalidateVersion(field: keyof Versions, value: string): number {
    let dropped = 0;
    for (const [key, entry] of this.entries) {
      if (entry.versions[field] === value) {
        this.entries.delete(key);
        dropped += 1;
      }
    }
    return dropped;
  }

  get size(): number {
    return this.entries.size;
  }
}
