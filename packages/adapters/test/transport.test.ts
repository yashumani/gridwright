import { describe, expect, it, vi } from "vitest";
import { AdapterError, bounded, classify, unconfigured, type Transport } from "../src/index.js";

describe("failure kinds stay distinct", () => {
  it.each([
    [200, undefined], [204, undefined],
    [401, "unauthorized"], [403, "forbidden"], [404, "not-found"],
    [408, "timeout"], [504, "timeout"],
    [500, "unavailable"], [503, "unavailable"],
    [418, "malformed"],
  ])("classifies %i", (status, kind) => {
    expect(classify(status, "svc")?.kind).toBe(kind);
  });

  it("never puts the response body in the error", () => {
    // The body of a failing call is untrusted text like any other.
    const e = classify(403, "svc")!;
    expect(e.at).toBe("svc");
    expect(e.message).not.toContain("{");
  });
});

describe("bounded", () => {
  it("abandons a call that does not answer", async () => {
    const slow: Transport = () => new Promise(() => {});
    await expect(bounded(slow, { timeoutMs: 20 })({ method: "GET", path: "/x" }))
      .rejects.toMatchObject({ kind: "timeout" });
  });

  it("refuses an answer larger than the limit", async () => {
    // A service this code does not own can answer with a hundred megabytes.
    const big: Transport = async () => ({ status: 200, body: { blob: "x".repeat(5000) } });
    await expect(bounded(big, { maxBodyChars: 1000 })({ method: "GET", path: "/x" }))
      .rejects.toMatchObject({ kind: "malformed" });
  });

  it("passes an ordinary answer through untouched", async () => {
    const ok: Transport = async () => ({ status: 200, body: { a: 1 } });
    expect(await bounded(ok)({ method: "GET", path: "/x" })).toEqual({ status: 200, body: { a: 1 } });
  });

  it("clears its timer so a fast call does not hold the process open", async () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const ok: Transport = async () => ({ status: 200, body: {} });
    await bounded(ok)({ method: "GET", path: "/x" });
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});

describe("no transport configured", () => {
  it("fails loudly rather than pretending to answer", async () => {
    await expect(unconfigured({ method: "GET", path: "/x" })).rejects.toBeInstanceOf(AdapterError);
  });
});
