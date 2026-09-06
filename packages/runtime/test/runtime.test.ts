import { describe, expect, it } from "vitest";
import {
  ApprovalStore,
  ScopedCache,
  SessionStore,
  cacheKey,
  digest,
  isPublished,
  type Artifact,
  type Scope,
  type Versions,
} from "../src/index.js";

/**
 * T17 and T18.
 *
 * T17 wants cross-session authorized retrieval, cross-user and cross-tenant
 * denial, and stale and revoked-cache tests. T18 wants approvals bound to
 * action and input, expiry and replay denial, and an immutable published
 * version.
 */

const V: Versions = { source: "src-1", policy: "pol-1", semantic: "sem-1", configuration: "cfg-1" };

const scope = (over: Partial<Scope> = {}): Scope => ({
  tenant: "acme",
  user: "u-1042",
  scopes: ["report.read"],
  domain: "support-operations",
  ...over,
});

const artifact = (over: Partial<Artifact> = {}): Artifact => ({
  id: "a-1",
  kind: "analysis",
  runId: "run-1",
  versions: V,
  createdAt: 0,
  value: { actual: 120 },
  ...over,
});

const opened = (options?: ConstructorParameters<typeof SessionStore>[0]) => {
  const s = new SessionStore(options);
  s.open("sess-1", scope(), V, ["report.read"]);
  return s;
};

describe("T17 · a session is readable by the principal it belongs to", () => {
  it("stores and returns an artifact across calls", () => {
    const s = opened();
    expect(s.put("sess-1", scope(), artifact()).ok).toBe(true);
    const got = s.get("sess-1", scope(), "a-1");
    expect(got.ok && got.value.value).toEqual({ actual: 120 });
  });

  it("lists by kind", () => {
    const s = opened();
    s.put("sess-1", scope(), artifact({ id: "a-1", kind: "analysis" }));
    s.put("sess-1", scope(), artifact({ id: "a-2", kind: "report" }));
    const list = s.list("sess-1", scope(), "report");
    expect(list.ok && list.value.map((a) => a.id)).toEqual(["a-2"]);
  });
});

describe("T17 · another principal cannot reach it", () => {
  it("refuses another tenant, and says tenant before it says user", () => {
    // A cross-tenant reader must not learn whether a user id exists over here.
    const s = opened();
    s.put("sess-1", scope(), artifact());
    const out = s.get("sess-1", scope({ tenant: "other-corp", user: "u-1042" }), "a-1");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("cross-tenant");
  });

  it("refuses another user in the same tenant", () => {
    const s = opened();
    s.put("sess-1", scope(), artifact());
    const out = s.get("sess-1", scope({ user: "u-9999" }), "a-1");
    expect(out.ok === false && out.code).toBe("cross-user");
  });

  it("refuses a reader missing a scope the session requires", () => {
    const s = opened();
    s.put("sess-1", scope(), artifact());
    const out = s.get("sess-1", scope({ scopes: [] }), "a-1");
    expect(out.ok === false && out.code).toBe("scope-insufficient");
  });

  it("refuses a reader in another domain", () => {
    const s = opened();
    const out = s.get("sess-1", scope({ domain: "finance-planning" }), "a-1");
    expect(out.ok === false && out.code).toBe("domain-mismatch");
  });

  it("rechecks on read, not only on write", () => {
    // The rule this store exists for. A store that checks on write and trusts
    // on read is a store where revoking access changes nothing already touched.
    const s = opened();
    s.put("sess-1", scope(), artifact());
    const before = s.get("sess-1", scope(), "a-1");
    expect(before.ok).toBe(true);
    const after = s.get("sess-1", scope({ scopes: [] }), "a-1");
    expect(after.ok).toBe(false);
  });
});

describe("T17 · a late result cannot overwrite an active session", () => {
  it("refuses an artifact computed against versions the session moved past", () => {
    // A12. The slow analysis returning after the user changed the period is
    // not wrong; it is answering a question nobody is asking any more.
    const s = opened();
    s.revise("sess-1", scope(), { ...V, configuration: "cfg-2" });
    const out = s.put("sess-1", scope(), artifact());
    expect(out.ok === false && out.code).toBe("stale-versions");
  });

  it("accepts one computed against the versions in force", () => {
    const s = opened();
    s.revise("sess-1", scope(), { ...V, configuration: "cfg-2" });
    const fresh = artifact({ versions: { ...V, configuration: "cfg-2" } });
    expect(s.put("sess-1", scope(), fresh).ok).toBe(true);
  });

  it("does not overwrite what was already there", () => {
    const s = opened();
    s.put("sess-1", scope(), artifact({ value: { actual: 120 } }));
    s.revise("sess-1", scope(), { ...V, source: "src-2" });
    s.put("sess-1", scope(), artifact({ value: { actual: 999 } }));
    const got = s.get("sess-1", scope(), "a-1");
    expect(got.ok && got.value.value).toEqual({ actual: 120 });
  });
});

describe("T17 · retention and deletion", () => {
  it("stops serving a session past its retention window", () => {
    let clock = 0;
    const s = new SessionStore({ retentionMs: 100, now: () => clock });
    s.open("sess-1", scope(), V);
    s.put("sess-1", scope(), artifact());
    clock = 500;
    expect(s.get("sess-1", scope(), "a-1").ok === false && s.get("sess-1", scope(), "a-1")).toMatchObject({
      code: "expired",
    });
    expect(s.expired()).toEqual(["sess-1"]);
  });

  it("keeps a session alive while it is being used", () => {
    let clock = 0;
    const s = new SessionStore({ retentionMs: 100, now: () => clock });
    s.open("sess-1", scope(), V);
    clock = 80;
    s.put("sess-1", scope(), artifact());
    clock = 150;
    expect(s.get("sess-1", scope(), "a-1").ok).toBe(true);
  });

  it("says a deleted session was deleted, not that it never existed", () => {
    // R20's deletion has to be observable. "No such session" would let a
    // deletion look like a bug and send someone hunting for it.
    const s = opened();
    s.put("sess-1", scope(), artifact());
    expect(s.delete("sess-1", scope())).toMatchObject({ ok: true, value: 1 });
    const out = s.get("sess-1", scope(), "a-1");
    expect(out.ok === false && out.code).toBe("deleted");
  });
});

describe("T17 · the cache key is the whole boundary", () => {
  it("gives two tenants different keys for the same request", () => {
    expect(cacheKey(scope(), V, { q: 1 })).not.toBe(cacheKey(scope({ tenant: "other" }), V, { q: 1 }));
  });

  it("gives two users different keys", () => {
    expect(cacheKey(scope(), V, { q: 1 })).not.toBe(cacheKey(scope({ user: "u-2" }), V, { q: 1 }));
  });

  it.each(["source", "policy", "semantic", "configuration"] as const)(
    "gives a different key when the %s version moves",
    (field) => {
      expect(cacheKey(scope(), V, { q: 1 })).not.toBe(
        cacheKey(scope(), { ...V, [field]: "moved" }, { q: 1 }),
      );
    },
  );

  it("treats the same scopes in another order as the same authority", () => {
    // Two orderings are the same authority. Treating them as different keys
    // halves the hit rate and makes a revocation test pass for a wrong reason.
    expect(cacheKey(scope({ scopes: ["a", "b"] }), V, { q: 1 })).toBe(
      cacheKey(scope({ scopes: ["b", "a"] }), V, { q: 1 }),
    );
  });

  it("never serves one tenant's answer to another", () => {
    const c = new ScopedCache();
    c.set(scope(), V, { q: 1 }, "acme answer");
    expect(c.get(scope({ tenant: "other" }), V, { q: 1 })).toBeUndefined();
  });
});

describe("T17 · a stale or revoked cache entry is not served", () => {
  it("expires an entry past its ttl", () => {
    let clock = 0;
    const c = new ScopedCache({ ttlMs: 100, now: () => clock });
    c.set(scope(), V, { q: 1 }, "answer");
    clock = 150;
    expect(c.get(scope(), V, { q: 1 })).toBeUndefined();
  });

  it("stops serving a revoked principal before the entry expires", () => {
    // R21: revocation invalidates access. A mark checked on read cannot miss
    // an entry, where a sweep can.
    const c = new ScopedCache();
    c.set(scope(), V, { q: 1 }, "answer");
    expect(c.get(scope(), V, { q: 1 })).toBe("answer");
    c.revoke("acme", "u-1042");
    expect(c.get(scope(), V, { q: 1 })).toBeUndefined();
  });

  it("drops everything computed under a version that moved", () => {
    const c = new ScopedCache();
    c.set(scope(), V, { q: 1 }, "a");
    c.set(scope(), V, { q: 2 }, "b");
    c.set(scope(), { ...V, semantic: "sem-2" }, { q: 3 }, "c");
    expect(c.invalidateVersion("semantic", "sem-1")).toBe(2);
    expect(c.get(scope(), { ...V, semantic: "sem-2" }, { q: 3 })).toBe("c");
  });

  it("evicts rather than growing without bound", () => {
    const c = new ScopedCache({ maxEntries: 2 });
    c.set(scope(), V, { q: 1 }, "a");
    c.set(scope(), V, { q: 2 }, "b");
    c.set(scope(), V, { q: 3 }, "c");
    expect(c.size).toBeLessThanOrEqual(2);
  });
});

describe("T18 · an approval names what it approved", () => {
  const config = { rows: ["queue_a", "queue_b"], label: "Closed cases" };
  const at = { tenant: "acme", domain: "support-operations" };

  const store = (o?: ConstructorParameters<typeof ApprovalStore>[0]) => new ApprovalStore(o);

  it("verifies against the exact action, input and scope", () => {
    const s = store();
    s.record({ id: "ap-1", actor: "person@example.invalid", action: "config.publish", value: config, scope: at });
    expect(s.verify("ap-1", "config.publish", config, at).ok).toBe(true);
  });

  it("refuses when the value changed after approval", () => {
    // Without this, "approve the config change" approves whatever the config
    // later becomes.
    const s = store();
    s.record({ id: "ap-1", actor: "p", action: "config.publish", value: config, scope: at });
    const changed = { ...config, rows: [...config.rows, "queue_c"] };
    const out = s.verify("ap-1", "config.publish", changed, at);
    expect(out.ok === false && out.code).toBe("wrong-input");
  });

  it("refuses a different action, with no prefix matching", () => {
    const s = store();
    s.record({ id: "ap-1", actor: "p", action: "config.publish", value: config, scope: at });
    expect(s.verify("ap-1", "config.publish.force", config, at)).toMatchObject({ code: "wrong-action" });
    expect(s.verify("ap-1", "knowledge.publish", config, at)).toMatchObject({ code: "wrong-action" });
  });

  it("refuses another tenant or domain", () => {
    const s = store();
    s.record({ id: "ap-1", actor: "p", action: "config.publish", value: config, scope: at });
    expect(s.verify("ap-1", "config.publish", config, { ...at, tenant: "other" })).toMatchObject({
      code: "wrong-scope",
    });
  });

  it("does not care what order the value's keys were in", () => {
    // A digest that disagrees because a serialiser changed its mind about key
    // order is a spurious refusal, and spurious refusals train people to work
    // around approvals.
    expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 }));
  });
});

describe("T18 · expiry and replay", () => {
  const at = { tenant: "acme", domain: "support-operations" };

  it("refuses an approval past its expiry", () => {
    let clock = 0;
    const s = new ApprovalStore({ now: () => clock });
    s.record({ id: "ap-1", actor: "p", action: "a", value: 1, scope: at, lifetimeMs: 100 });
    clock = 200;
    expect(s.verify("ap-1", "a", 1, at)).toMatchObject({ code: "expired" });
  });

  it("caps a lifetime longer than the store allows", () => {
    let clock = 0;
    const s = new ApprovalStore({ maxLifetimeMs: 50, now: () => clock });
    const r = s.record({ id: "ap-1", actor: "p", action: "a", value: 1, scope: at, lifetimeMs: 999_999 });
    expect(r.expiresAt).toBe(50);
  });

  it("refuses a second use", () => {
    const s = new ApprovalStore();
    s.record({ id: "ap-1", actor: "p", action: "a", value: 1, scope: at });
    expect(s.publish({ approvalId: "ap-1", action: "a", value: 1, scope: at, publishedBy: "p" }).ok).toBe(true);
    const replay = s.publish({ approvalId: "ap-1", action: "a", value: 1, scope: at, publishedBy: "p" });
    expect(replay.ok === false && replay.code).toBe("already-used");
  });

  it("leaves the approval spendable when only verified", () => {
    // A preview must be able to ask "would this be allowed" without spending
    // the approval, or check-then-act becomes a race.
    const s = new ApprovalStore();
    s.record({ id: "ap-1", actor: "p", action: "a", value: 1, scope: at });
    expect(s.verify("ap-1", "a", 1, at).ok).toBe(true);
    expect(s.publish({ approvalId: "ap-1", action: "a", value: 1, scope: at, publishedBy: "p" }).ok).toBe(true);
  });
});

describe("T18 · read-only cannot publish", () => {
  const at = { tenant: "acme", domain: "support-operations" };

  it("refuses however good the approval is", () => {
    // A mode that can be argued with is not a mode.
    const s = new ApprovalStore({ readOnly: true });
    s.record({ id: "ap-1", actor: "p", action: "a", value: 1, scope: at });
    const out = s.publish({ approvalId: "ap-1", action: "a", value: 1, scope: at, publishedBy: "p" });
    expect(out.ok === false && out.code).toBe("read-only");
  });

  it("does not spend the approval it refused", () => {
    const s = new ApprovalStore({ readOnly: true });
    const r = s.record({ id: "ap-1", actor: "p", action: "a", value: 1, scope: at });
    s.publish({ approvalId: "ap-1", action: "a", value: 1, scope: at, publishedBy: "p" });
    expect(r.consumedAt).toBeUndefined();
  });
});

describe("T18 · a published version is immutable", () => {
  const at = { tenant: "acme", domain: "support-operations" };

  it("does not change when the caller mutates the value afterwards", () => {
    // A published version a later edit can reach is not a version; it is a
    // reference to whatever the value is now.
    const s = new ApprovalStore();
    const value = { rows: ["a"] };
    s.record({ id: "ap-1", actor: "p", action: "cfg", value, scope: at });
    const out = s.publish({ approvalId: "ap-1", action: "cfg", value, scope: at, publishedBy: "p" });
    value.rows.push("b");
    expect(out.ok && (out.value.value as { rows: string[] }).rows).toEqual(["a"]);
  });

  it("keeps every version, numbered", () => {
    const s = new ApprovalStore();
    for (const [i, v] of [{ n: 1 }, { n: 2 }].entries()) {
      s.record({ id: `ap-${i}`, actor: "p", action: "cfg", value: v, scope: at });
      s.publish({ approvalId: `ap-${i}`, action: "cfg", value: v, scope: at, publishedBy: "p" });
    }
    expect(s.history("cfg").map((v) => v.version)).toEqual([1, 2]);
    expect(s.current("cfg")?.value).toEqual({ n: 2 });
  });

  it("records who published and under which approval", () => {
    const s = new ApprovalStore();
    s.record({ id: "ap-1", actor: "approver@example.invalid", action: "cfg", value: 1, scope: at });
    const out = s.publish({
      approvalId: "ap-1",
      action: "cfg",
      value: 1,
      scope: at,
      publishedBy: "publisher@example.invalid",
    });
    expect(out.ok && out.value).toMatchObject({
      approvalId: "ap-1",
      publishedBy: "publisher@example.invalid",
    });
  });
});

describe("T18 · a draft is a draft", () => {
  const at = { tenant: "acme", domain: "support-operations" };

  it("says an unapproved value is not published", () => {
    const s = new ApprovalStore();
    expect(isPublished(s, "cfg", { n: 1 })).toBe(false);
  });

  it("says so only for the exact value that was published", () => {
    const s = new ApprovalStore();
    s.record({ id: "ap-1", actor: "p", action: "cfg", value: { n: 1 }, scope: at });
    s.publish({ approvalId: "ap-1", action: "cfg", value: { n: 1 }, scope: at, publishedBy: "p" });
    expect(isPublished(s, "cfg", { n: 1 })).toBe(true);
    expect(isPublished(s, "cfg", { n: 2 })).toBe(false);
  });
});
