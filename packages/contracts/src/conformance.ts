import { validateEnvelope, type Problem, type ServiceContext } from "./envelope.js";

/**
 * The suite an adapter runs to show it speaks the contract.
 *
 * T03 asks for conformance fixtures, and the useful form of that is a file
 * plus a runner rather than a set of assertions living in one package's tests.
 * A case is data: an envelope, the receiver context to judge it under, and the
 * problem codes that must come back. An adapter in another repository can load
 * the same file and check itself against it, which is the only way "conformant"
 * means the same thing in two places.
 *
 * A case states its expected codes as a **set** — every code listed must
 * appear, and no code that appears may be unlisted. A validator that reports
 * an extra unrelated failure has not passed; neither has one that reports a
 * subset and calls it agreement.
 */

export interface ConformanceCase {
  name: string;
  /** Why this case exists. Read by a human deciding whether it is fair. */
  because: string;
  context: ServiceContext;
  /** Fixed clock for the case, RFC 3339. */
  now: string;
  envelope: unknown;
  expect: {
    ok: boolean;
    /** Exactly the problem codes expected, in any order. */
    codes: string[];
  };
}

export interface CaseOutcome {
  name: string;
  passed: boolean;
  expected: string[];
  actual: string[];
  /** Present when the case failed, ready to print. */
  detail?: string;
}

const sorted = (xs: readonly string[]) => [...xs].sort();
const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && sorted(a).every((x, i) => x === sorted(b)[i]);

export function runCase(c: ConformanceCase): CaseOutcome {
  const result = validateEnvelope(c.envelope, c.context, { now: new Date(c.now) });
  const actual: string[] = result.ok ? [] : result.problems.map((p: Problem) => p.code);
  const passed = result.ok === c.expect.ok && same(actual, c.expect.codes);
  const outcome: CaseOutcome = {
    name: c.name,
    passed,
    expected: c.expect.codes,
    actual,
  };
  if (!passed) {
    outcome.detail =
      `${c.name}: expected ${c.expect.ok ? "ok" : "refusal"} with [${sorted(c.expect.codes).join(", ")}], ` +
      `got ${result.ok ? "ok" : "refusal"} with [${sorted(actual).join(", ")}]`;
  }
  return outcome;
}

export interface ConformanceReport {
  total: number;
  passed: number;
  outcomes: CaseOutcome[];
  failures: string[];
}

export function runConformance(cases: readonly ConformanceCase[]): ConformanceReport {
  const outcomes = cases.map(runCase);
  return {
    total: outcomes.length,
    passed: outcomes.filter((o) => o.passed).length,
    outcomes,
    failures: outcomes.filter((o) => !o.passed).map((o) => o.detail!),
  };
}
