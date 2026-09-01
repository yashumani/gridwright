/**
 * jsdom implements neither ResizeObserver nor layout, so panels would measure
 * zero and charts would draw nothing. Stubbing the observer and giving elements
 * a plausible box is what lets the interaction tests exercise real geometry.
 */

// The DOM matchers only make sense — and only load — under the jsdom projects.
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
}

class StubResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element) {
    this.cb([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
}

if (typeof Element !== "undefined") {
  for (const [prop, value] of [["clientWidth", 640], ["clientHeight", 320]] as const) {
    if (Object.getOwnPropertyDescriptor(Element.prototype, prop)?.get?.name !== "gwStub") {
      Object.defineProperty(Element.prototype, prop, {
        configurable: true,
        get: function gwStub() { return value; },
      });
    }
  }
}
