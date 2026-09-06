import { describe, expect, it } from "vitest";
import {
  CapabilityRegistry,
  effectiveScope,
  handoffTrace,
  validateEnvelope,
  type CapabilityDescriptor,
  type CapabilityRequest,
  type EnforcementContext,
} from "../src/index.js";

const readReport: CapabilityDescriptor = {
  name: "report.read",
  version: 1,
  requiredScopes: ["report.read"],
  minimumProvenance: "session",
  arguments: {
    reportId: { type: "string", required: true, maxLength: 64 },
    periods: { type: "string[]", maxLength: 4 },
    includeData: { type: "boolean" },
  },
  outputClassification: "internal",
  budget: { timeoutMs: 5_000, steps: 3, retries: 1 },
};

const readRestricted: CapabilityDescriptor = {
  ...readReport,
  name: "report.read_restricted",
  outputClassification: "restricted",
  minimumProvenance: "service-token",
  requiredScopes: ["report.read", "report.restricted"],
};

const registry = () => new CapabilityRegistry([readReport, readRestricted]);

const context = (over: Partial<EnforcementContext> = {}): EnforcementContext => ({
  tenant: "acme",
  user: "u-1042",
  scopes: ["report.read"],
  provenance: "service-token",
  domains: ["support-operations"],
  semantics: { version: "sem-2026-09-01", admitted: ["metric.closed_cases"] },
  maxClassification: "internal",
  ...over,
});

const request = (over: Partial<CapabilityRequest> = {}): CapabilityRequest => ({
  capability: "report.read",
  version: 1,
  arguments: { reportId: "rpt-1" },
  budget: { timeoutMs: 4_000, steps: 2, retries: 1 },
  ...over,
});

const denial = (r: ReturnType<CapabilityRegistry["authorize"]>) =>
  r.allowed ? undefined : r.denial.code;

describe("a call that should go through", () => {
  it("is allowed, and carries the budget it asked for", () => {
    const d = registry().authorize(request(), context());
    expect(d.allowed).toBe(true);
    if (!d.allowed) return;
    expect(d.budget).toEqual({ timeoutMs: 4_000, steps: 2, retries: 1 });
    expect(d.descriptor.name).toBe("report.read");
  });
});

describe("registration", () => {
  it("refuses a capability nobody registered", () => {
    expect(denial(registry().authorize(request({ capability: "report.delete" }), context())))
      .toBe("capability-unregistered");
  });

  it("distinguishes an unknown capability from an unknown version of a known one", () => {
    // Different fixes: one is a typo or a missing registration, the other is a
    // deploy skew. Reporting both as "unregistered" sends people to the wrong
    // place.
    expect(denial(registry().authorize(request({ version: 2 }), context())))
      .toBe("capability-version");
  });
});

describe("identity", () => {
  it("refuses an identity established more weakly than the capability needs", () => {
    expect(
      denial(
        registry().authorize(
          request({ capability: "report.read_restricted" }),
          context({ scopes: ["report.read", "report.restricted"], provenance: "delegated" }),
        ),
      ),
    ).toBe("identity-provenance");
  });

  it("accepts a stronger one", () => {
    const d = registry().authorize(request(), context({ provenance: "service-token" }));
    expect(d.allowed).toBe(true);
  });

  it("takes the scope from the context and nowhere else", () => {
    // R05, as a function that cannot read a payload because it is not given
    // one. The envelope is not a parameter here, by design.
    const ctx = context({ scopes: ["report.read", "analysis.read"] });
    expect(effectiveScope(ctx)).toEqual(["report.read", "analysis.read"]);
  });

  it("ignores a scope claimed in the arguments", () => {
    // The decisive test for "request-body fields cannot self-assign
    // authority": the same call, with an argument saying otherwise, is still
    // refused — and refused for the argument, not for the scope it claimed.
    const d = registry().authorize(
      request({
        capability: "report.read_restricted",
        arguments: { reportId: "rpt-1", scopes: ["report.restricted"] },
      }),
      context(),
    );
    expect(denial(d)).toBe("scope-insufficient");
  });
});

describe("scope", () => {
  it("refuses a caller missing a required scope, and names it", () => {
    const d = registry().authorize(
      request({ capability: "report.read_restricted" }),
      context({ maxClassification: "restricted" }),
    );
    expect(denial(d)).toBe("scope-insufficient");
    expect(d.allowed === false && d.denial.message).toContain("report.restricted");
  });

  it("requires every scope, not any of them", () => {
    const d = registry().authorize(
      request({ capability: "report.read_restricted" }),
      context({ scopes: ["report.restricted"], maxClassification: "restricted" }),
    );
    expect(denial(d)).toBe("scope-insufficient");
  });
});

describe("arguments", () => {
  it("refuses an argument the capability does not declare", () => {
    // An unknown argument is how a caller reaches a parameter the descriptor
    // never promised to bound.
    expect(
      denial(registry().authorize(request({ arguments: { reportId: "r", sql: "SELECT 1" } }), context())),
    ).toBe("arguments-invalid");
  });

  it("refuses a missing required argument", () => {
    expect(denial(registry().authorize(request({ arguments: {} }), context())))
      .toBe("arguments-invalid");
  });

  it("refuses the wrong type", () => {
    expect(denial(registry().authorize(request({ arguments: { reportId: 7 } }), context())))
      .toBe("arguments-invalid");
  });

  it("bounds a string and a list", () => {
    // R24: bound payloads. A cap nobody enforces is a comment.
    expect(
      denial(
        registry().authorize(request({ arguments: { reportId: "x".repeat(65) } }), context()),
      ),
    ).toBe("arguments-invalid");
    expect(
      denial(
        registry().authorize(
          request({ arguments: { reportId: "r", periods: ["a", "b", "c", "d", "e"] } }),
          context(),
        ),
      ),
    ).toBe("arguments-invalid");
  });

  it("refuses a number that is not finite", () => {
    const reg = new CapabilityRegistry([
      { ...readReport, arguments: { limit: { type: "number", required: true } } },
    ]);
    expect(denial(reg.authorize(request({ arguments: { limit: Number.NaN } }), context())))
      .toBe("arguments-invalid");
  });

  it("accepts an optional argument left out", () => {
    expect(registry().authorize(request({ arguments: { reportId: "r" } }), context()).allowed)
      .toBe(true);
  });
});

describe("budget", () => {
  it("refuses a request asking for more than the descriptor allows", () => {
    // R04: a bounded workflow is bounded by the gate that authorises it.
    for (const over of [
      { timeoutMs: 60_000, steps: 2, retries: 1 },
      { timeoutMs: 4_000, steps: 9, retries: 1 },
      { timeoutMs: 4_000, steps: 2, retries: 5 },
    ]) {
      expect(denial(registry().authorize(request({ budget: over }), context())))
        .toBe("budget-exceeded");
    }
  });

  it("refuses a budget of nothing", () => {
    expect(
      denial(registry().authorize(request({ budget: { timeoutMs: 0, steps: 1, retries: 0 } }), context())),
    ).toBe("budget-exceeded");
  });

  it("lets a caller ask for less", () => {
    const d = registry().authorize(
      request({ budget: { timeoutMs: 100, steps: 1, retries: 0 } }),
      context(),
    );
    expect(d.allowed && d.budget.timeoutMs).toBe(100);
  });
});

describe("output classification", () => {
  it("refuses output more sensitive than the caller may receive", () => {
    const d = registry().authorize(
      request({ capability: "report.read_restricted" }),
      context({ scopes: ["report.read", "report.restricted"], maxClassification: "internal" }),
    );
    expect(denial(d)).toBe("classification-refused");
  });

  it("allows it when the caller may", () => {
    const d = registry().authorize(
      request({ capability: "report.read_restricted" }),
      context({ scopes: ["report.read", "report.restricted"], maxClassification: "restricted" }),
    );
    expect(d.allowed).toBe(true);
  });
});

describe("advice", () => {
  it("honours a denial", () => {
    const d = registry().authorize(request(), context(), { deny: { reason: "budget for the day is spent" } });
    expect(denial(d)).toBe("advised-denial");
    expect(d.allowed === false && d.denial.message).toContain("budget for the day is spent");
  });

  it("has no way to grant", () => {
    // R22: a policy agent may advise but cannot grant access. The guarantee is
    // structural — there is no field to put a permission in — so this test
    // asserts the shape rather than a behaviour, by handing in the thing an
    // adviser would try and showing the refusal stands.
    const advice = { allow: true, grant: ["report.restricted"] } as unknown as { deny?: never };
    const d = registry().authorize(
      request({ capability: "report.read_restricted" }),
      context(),
      advice,
    );
    expect(denial(d)).toBe("scope-insufficient");
  });

  it("runs last, so a real failure is never hidden behind a denial", () => {
    // If advice ran first, an unregistered capability would be reported as an
    // advised denial and the missing registration would go unnoticed.
    const d = registry().authorize(
      request({ capability: "report.delete" }),
      context(),
      { deny: { reason: "no" } },
    );
    expect(denial(d)).toBe("capability-unregistered");
  });
});

describe("the order of the checks is part of the contract", () => {
  it("does not validate arguments for a capability that is not registered", () => {
    const d = registry().authorize(
      request({ capability: "nope", arguments: { anything: true } }),
      context(),
    );
    expect(denial(d)).toBe("capability-unregistered");
  });

  it("does not tell a caller who failed scope whether their arguments were good", () => {
    const d = registry().authorize(
      request({ capability: "report.read_restricted", arguments: { reportId: 7 } }),
      context({ maxClassification: "restricted" }),
    );
    expect(denial(d)).toBe("scope-insufficient");
  });
});

describe("tracing a handoff", () => {
  it("reports the run, session, domain and the issuers' own receipt ids", () => {
    const r = validateEnvelope(
      {
        contract: 1,
        kind: "report.definition",
        run: "run-1",
        session: "sess-1",
        domain: "support-operations",
        issuedAt: "2026-09-06T00:00:00Z",
        expiresAt: "2026-09-06T01:00:00Z",
        versions: {
          source: "s", policy: "p", semantic: "sem-2026-09-01", configuration: "c", result: "r",
        },
        receipts: [{ issuer: "talk2data", id: "t2d-1", issuedAt: "2026-09-06T00:00:00Z" }],
        semanticRefs: [],
        payload: {},
      },
      context(),
      { now: new Date("2026-09-06T00:30:00Z") },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(handoffTrace(r.envelope)).toEqual({
      run: "run-1",
      session: "sess-1",
      domain: "support-operations",
      receipts: ["talk2data:t2d-1"],
    });
  });
});
