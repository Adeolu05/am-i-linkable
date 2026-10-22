"use client";

// Every network request this page made, from the browser's own Performance API.
// This is what lets the page prove that a check sends nothing.

import { useEffect, useState } from "react";

export interface RequestEntry {
  url: string;
  path: string;
  kind: string;
  bytes: number | null;
  sameOrigin: boolean;
}

export function requestCount(): number {
  return performance.getEntriesByType("navigation").length + performance.getEntriesByType("resource").length;
}

function read(): RequestEntry[] {
  return [...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource")].map((e) => {
    const u = new URL(e.name, location.href);
    const t = e as PerformanceResourceTiming;
    return {
      url: u.href,
      path: `${u.pathname}${u.search}`,
      kind:
        e.entryType === "navigation"
          ? "page"
          : u.pathname.startsWith("/_next/static/media/")
            ? "font"
            : u.pathname.startsWith("/_next/static/")
              ? "code"
              : t.initiatorType === "fetch"
                ? "data"
                : t.initiatorType || "other",
      bytes: typeof t.transferSize === "number" && t.transferSize > 0 ? t.transferSize : null,
      sameOrigin: u.origin === location.origin,
    };
  });
}

/** The live request list; updates as the browser records new requests. */
export function useRequestLog(): RequestEntry[] {
  const [entries, setEntries] = useState<RequestEntry[]>([]);
  useEffect(() => {
    const update = () => setEntries(read());
    update();
    const observer = new PerformanceObserver(update);
    observer.observe({ type: "resource", buffered: true });
    return () => observer.disconnect();
  }, []);
  return entries;
}

export const formatBytes = (n: number | null) =>
  n === null ? "cached" : n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1_048_576).toFixed(2)} MB`;
