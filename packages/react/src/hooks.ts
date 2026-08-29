import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FilterStore, Selections } from "./filter-store.js";

/**
 * Measures an element's content box. Charts draw at real pixels rather than
 * scaling a fixed viewBox, which would stretch every label.
 *
 * Falls back to a one-shot layout read where ResizeObserver is absent (older
 * browsers, and jsdom under test), so a panel still renders at a sane size
 * instead of collapsing to zero.
 */
export interface Size {
  width: number;
  height: number;
}

export function useMeasure<T extends HTMLElement>(): [
  (node: T | null) => void,
  Size,
] {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;

    const read = () => {
      const w = node.clientWidth || node.getBoundingClientRect().width;
      const h = node.clientHeight || node.getBoundingClientRect().height;
      setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };

    if (typeof ResizeObserver === "undefined") {
      read();
      return;
    }
    const ro = new ResizeObserver(read);
    ro.observe(node);
    observer.current = ro;
    read();
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [ref, size];
}

/** Subscribes to the filter store with the concurrent-safe external-store API. */
export function useSelections(store: FilterStore): Selections {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export type AsyncState<T> =
  | { status: "loading"; data?: T; error?: undefined }
  | { status: "ready"; data: T; error?: undefined }
  | { status: "error"; data?: T; error: Error };

/**
 * Runs an async producer, keeping the previous data visible while the next
 * result loads — a dashboard that blanks every panel on each click is unusable.
 * Out-of-order responses are dropped by generation, not by unmount.
 */
export function useAsync<T>(produce: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    setState((prev) => ({ status: "loading", ...(prev.data !== undefined ? { data: prev.data } : {}) }));
    produce().then(
      (data) => {
        if (generation.current === mine) setState({ status: "ready", data });
      },
      (err: unknown) => {
        if (generation.current !== mine) return;
        setState({ status: "error", error: err instanceof Error ? err : new Error(String(err)) });
      },
    );
    // The producer is recreated each render; deps are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
