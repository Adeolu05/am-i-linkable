"use client";

// Lists every network request this page has made, as recorded by the browser's
// own Performance API (navigation + resource timing). Nothing here is sent anywhere.

import { useEffect, useState } from "react";

interface Entry {
  url: string;
  host: string;
  path: string;
  kind: string;
  bytes: number | null;
  sameOrigin: boolean;
}

function toEntry(e: PerformanceEntry): Entry {
  const u = new URL(e.name, location.href);
  const timing = e as PerformanceResourceTiming;
  const kind = e.entryType === "navigation" ? "page" : timing.initiatorType || "other";
  return {
    url: u.href,
    host: u.host,
    path: `${u.pathname}${u.search}`,
    kind,
    bytes: typeof timing.transferSize === "number" && timing.transferSize > 0 ? timing.transferSize : null,
    sameOrigin: u.origin === location.origin,
  };
}

function formatBytes(n: number | null) {
  if (n === null) return "cached";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function RequestsPanel({ checksRun, requestsAtLastCheck }: { checksRun: number; requestsAtLastCheck: number | null }) {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    const read = () =>
      setEntries([...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource")].map(toEntry));
    read();
    const observer = new PerformanceObserver(read);
    observer.observe({ type: "resource", buffered: true });
    return () => observer.disconnect();
  }, []);

  const thirdParty = entries.filter((e) => !e.sameOrigin);
  const since = checksRun > 0 && requestsAtLastCheck !== null ? entries.length - requestsAtLastCheck : null;

  return (
    <section aria-labelledby="sent" className="glass space-y-3 p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="sent" className="text-lg font-semibold">
          What this page sent
        </h2>
        <p className="text-sm text-(--ink-muted)">
          {entries.length} request{entries.length === 1 ? "" : "s"},{" "}
          {thirdParty.length === 0 ? "all to this site" : `${thirdParty.length} to other sites`}
        </p>
      </div>
      <p className="leading-relaxed text-(--ink-muted)">
        <strong className="font-semibold text-white">Your amount never left your device.</strong> This list comes from
        your browser&rsquo;s own record of every request this page made. None of them contain your amount.
        {since !== null && (
          <>
            {" "}
            Requests since your last check: <strong className="font-semibold text-white">{since}</strong>.
          </>
        )}
      </p>
      <details className="group">
        <summary className="cursor-pointer select-none text-sm text-amber-300 hover:text-amber-200">Show every request</summary>
        <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1 font-mono text-xs">
          {entries.map((e, i) => (
            <li key={`${e.url}-${i}`} className="flex gap-2 rounded-md bg-white/5 px-2 py-1.5">
              <span className="w-16 shrink-0 text-(--ink-muted)">{e.kind}</span>
              <span className={`min-w-0 flex-1 truncate ${e.sameOrigin ? "" : "text-rose-300"}`} title={e.url}>
                {e.sameOrigin ? e.path : e.url}
              </span>
              <span className="shrink-0 text-(--ink-muted)">{formatBytes(e.bytes)}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** Number of requests recorded so far; used to show that a check adds none. */
export function requestCount(): number {
  return performance.getEntriesByType("navigation").length + performance.getEntriesByType("resource").length;
}
