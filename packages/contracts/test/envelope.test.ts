import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CONTRACT_VERSION,
  runConformance,
  validateEnvelope,
  type ConformanceCase,
  type Envelope,
  type ServiceContext,
} from "../src/index.js";

const context = (over: Partial<ServiceContext> = {}): ServiceContext => ({
  tenant: "acme",
  user: "u-1042",
  scopes: ["report.read"],
  provenance: "service-token",
  domains: ["support-operations"],
  semantics: { version: "sem-2026-09-01", admitted: ["metric.closed_cases"] },
  ...over,
});

const NOW = new Date("2026-09-06T00:30:00Z");

const envelope = (over: Record<string, unknown> = {}): Record<string, unknown> => {
  const base: Record<string, unknown> = {
    contract: 1,
    kind: "report.definition",
    run: "run-7781",
    session: "sess-2210",
    domain: "support-operations",
    issuedAt: "2026-09-06T00:00:00Z",
    expiresAt: "2026-09-06T01:00:00Z",
    versions: {
      source: "src-2026-09-05",
      policy: "pol-14",
      semantic: "sem-2026-09-01",
      configuration: "cfg-3",
      result: "res-9",
    },
    receipts: [{ issuer: "talk2data", id: "t2d-88213", issuedAt: "2026-09-06T00:00:00Z" }],
    semanticRefs: ["metric.closed_cases"],
    payload: { rows: [] },
  };
  return { ...base, ...over };
};

const codes = (v: unknown, ctx = context()) => {
  const r = validateEnvelope(v, ctx, { now: NOW });
  return r.ok ? [] : r.problems.map((p) => p.code);
};

describe("a handoff that is accepted", () => {
  it("comes back rebuilt field by field, not as the object that arrived", () => {
    // Anything the validator did not check must not survive into the value a
    // caller then trusts, or the check was decorative.
    const smuggled = { ...envelope(), extra: "not part of the contract" };
    const r = validateEnvelope(smuggled, context(), { now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("extra" in (r.envelope as unknown as Record<string, unknown>)).toBe(false);
    expect(r.envelope.contract).toBe(CONTRACT_VERSION);
    expect(r.envelope.versions.semantic).toBe("sem-2026-09-01");
  });

  it("carries the issuer's receipt through untouched", () => {
    const r = validateEnvelope(envelope(), context(), { now: NOW });
    expect(r.ok && r.envelope.receipts).toEqual([
      { issuer: "talk2data", id: "t2d-88213", issuedAt: "2026-09-06T00:00:00Z" },
    ]);
  });
});

describe("identity cannot travel in the envelope", () => {
  // R05. The receiver already knows who is calling, from its own authenticated
  // context. A field here can only be an attempt to be believed.
  it.each([
    ["tenant", "other-corp"],
    ["user", "u-0001"],
    ["scopes", ["admin"]],
    ["scope", "admin"],
    ["identity", { user: "root" }],
    ["principal", "root"],
    ["actAs", "u-0001"],
    ["impersonate", "u-0001"],
    ["roles", ["admin"]],
    ["permissions", ["report.write"]],
    ["authority", "granted"],
  ])("refuses an envelope carrying %s", (field, value) => {
    expect(codes(envelope({ [field]: value }))).toContain("identity-in-envelope");
  });

  it("refuses rather than quietly dropping the field", () => {
    // Dropping would let a handoff built to escalate travel on looking
    // well-formed. The difference is visible only in whether it is refused.
    const r = validateEnvelope(envelope({ tenant: "other-corp" }), context(), { now: NOW });
    expect(r.ok).toBe(false);
  });

  it("does not confuse a payload's own columns with an identity", () => {
    // The tripwire is on the envelope. A support view with a user column has
    // to be able to travel, or the rule is unusable.
    const payload = { columns: ["user", "scopes"], rows: [["u-1", "admin"]] };
    expect(codes(envelope({ payload }))).toEqual([]);
  });
});

describe("versions", () => {
  it("refuses a newer contract by name", () => {
    const r = validateEnvelope(envelope({ contract: 2 }), context(), { now: NOW });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems[0]!.code).toBe("contract-unsupported");
    expect(r.problems[0]!.message).toContain("2");
    expect(r.problems[0]!.message).toContain("1");
  });

  it("refuses an older contract too", () => {
    expect(codes(envelope({ contract: 0 }))).toEqual(["contract-unsupported"]);
  });

  it("stops at the version rather than reporting a shape it cannot read", () => {
    // Listing missing fields of a contract we do not understand is guesswork.
    const r = validateEnvelope({ contract: 99 }, context(), { now: NOW });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems).toHaveLength(1);
  });

  it("refuses numbers computed against a different semantic version", () => {
    const versions = { ...(envelope()["versions"] as object), semantic: "sem-2026-08-01" };
    expect(codes(envelope({ versions }))).toEqual(["semantic-version-mismatch"]);
  });

  it("refuses a semantic reference the receiver has not approved", () => {
    // R07: explicit mappings to approved knowledge, never a label match.
    expect(codes(envelope({ semanticRefs: ["metric.invented_here"] }))).toEqual([
      "semantic-unknown",
    ]);
  });

  it("does not match a definition by its label", () => {
    // Two definitions can share a label and mean different things, so an id
    // that is not admitted stays refused however familiar it looks.
    const ctx = context({
      semantics: { version: "sem-2026-09-01", admitted: ["metric.closed_cases"] },
    });
    expect(codes(envelope({ semanticRefs: ["Closed cases"] }), ctx)).toEqual(["semantic-unknown"]);
  });
});

describe("staleness", () => {
  it("refuses a handoff past its expiry", () => {
    const r = validateEnvelope(envelope(), context(), { now: new Date("2026-09-06T02:00:00Z") });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.map((p) => p.code)).toEqual(["expired"]);
  });

  it("accepts one still inside its window", () => {
    expect(codes(envelope())).toEqual([]);
  });

  it("refuses a window that closes before it opens", () => {
    // Otherwise a clock skew reads as permanently fresh.
    expect(
      codes(envelope({ issuedAt: "2026-09-06T01:00:00Z", expiresAt: "2026-09-06T00:00:00Z" })),
    ).toEqual(["issued-after-expiry"]);
  });

  it("refuses a timestamp nobody agreed how to read", () => {
    expect(codes(envelope({ expiresAt: "tomorrow" }))).toEqual(["timestamp-malformed"]);
  });
});

describe("receipts are carried, not minted", () => {
  it("refuses a receipt carrying a claim of its own", () => {
    // R19: preserve an issuer's receipt ids rather than mint unsupported
    // claims of certification. This is what that looks like on the wire.
    const receipts = [
      { issuer: "talk2data", id: "t2d-1", issuedAt: "2026-09-06T00:00:00Z", certified: true },
    ];
    expect(codes(envelope({ receipts }))).toEqual(["receipt-malformed"]);
  });

  it("refuses a receipt with nowhere to trace back to", () => {
    expect(codes(envelope({ receipts: [{ id: "t2d-1", issuedAt: "2026-09-06T00:00:00Z" }] })))
      .toEqual(["field-missing"]);
  });

  it("accepts an adapter that issues none", () => {
    expect(codes(envelope({ receipts: [] }))).toEqual([]);
  });

  it("distinguishes no receipts from no receipts key", () => {
    const without = { ...envelope() };
    delete without["receipts"];
    expect(codes(without)).toContain("field-missing");
  });
});

describe("scope of the handoff itself", () => {
  it("refuses a domain this receiver does not admit", () => {
    expect(codes(envelope({ domain: "finance-planning" }))).toEqual(["domain-out-of-scope"]);
  });
});

describe("reporting", () => {
  it("reports every problem, not the first", () => {
    const r = validateEnvelope({ contract: 1, payload: {} }, context(), { now: NOW });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // kind, run, session, domain, issuedAt, expiresAt, versions, receipts,
    // semanticRefs — nine things wrong, said once.
    expect(r.problems).toHaveLength(9);
    expect(new Set(r.problems.map((p) => p.path)).size).toBe(9);
  });

  it("refuses something that is not an object at all", () => {
    expect(codes("report.definition")).toEqual(["not-an-object"]);
    expect(codes([envelope()])).toEqual(["not-an-object"]);
    expect(codes(null)).toEqual(["not-an-object"]);
  });
});

describe("the conformance suite", () => {
  const file = JSON.parse(
    readFileSync(resolve(process.cwd(), "fixtures/contracts/conformance.json"), "utf8"),
  ) as { contract: number; cases: ConformanceCase[] };

  it("is written against this contract version", () => {
    expect(file.contract).toBe(CONTRACT_VERSION);
  });

  it("passes every case", () => {
    // The suite is the thing another repository's adapter runs to show it
    // speaks this contract. If it does not hold here it proves nothing there.
    const report = runConformance(file.cases);
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(report.total);
    expect(report.total).toBeGreaterThanOrEqual(19);
  });

  it("holds every case to the exact set of codes", () => {
    // A validator reporting an extra unrelated failure has not passed, and
    // neither has one reporting a subset. Checked by breaking a case.
    const loosened = file.cases.map((c) =>
      c.name.startsWith("an expired") ? { ...c, expect: { ok: false, codes: [] } } : c,
    );
    const report = runConformance(loosened);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain("expired");
  });

  it("covers both an accepted handoff and every refusal reason", () => {
    const accepted = file.cases.filter((c) => c.expect.ok);
    const refused = new Set(file.cases.flatMap((c) => c.expect.codes));
    expect(accepted.length).toBeGreaterThan(0);
    // Every code the validator can produce is exercised by a case; a code
    // nobody tests is a rule nobody has checked.
    expect([...refused].sort()).toEqual([
      "contract-unsupported",
      "domain-out-of-scope",
      "expired",
      "field-missing",
      "identity-in-envelope",
      "issued-after-expiry",
      "not-an-object",
      "receipt-malformed",
      "semantic-unknown",
      "semantic-version-mismatch",
      "timestamp-malformed",
    ]);
  });

  it("says why each case exists", () => {
    // A conformance suite an adapter author cannot argue with is a suite they
    // will work around instead.
    for (const c of file.cases) expect(c.because.length).toBeGreaterThan(20);
  });
});

describe("the type is the documentation", () => {
  it("names every version R19 asks a handoff to carry", () => {
    const r = validateEnvelope(envelope(), context(), { now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e: Envelope = r.envelope;
    expect(Object.keys(e.versions).sort()).toEqual([
      "configuration",
      "policy",
      "result",
      "semantic",
      "source",
    ]);
    expect(e.run).toBeTruthy();
    expect(e.session).toBeTruthy();
    expect(e.domain).toBeTruthy();
  });
});
