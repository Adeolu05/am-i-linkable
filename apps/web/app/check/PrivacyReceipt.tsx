"use client";

// Privacy receipt: every network request this page made, from the browser's own
// Performance API, and a live counter showing that checks send nothing.

import { useEffect, useState } from "react";
import { CountUp } from "@/components/CountUp";
import { CheckCircleIcon, LockIcon } from "@/components/icons";

interface Entry {
  url: string;
  path: string;
  kind: string;
  bytes: number | null;
  sameOrigin: boolean;
}

export function requestCount(): number {
  return performance.getEntriesByType("navigation").length + performance.getEntriesByType("resource").length;
}

function read(): Entry[] {
  return [...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource")].map((e) => {
    const u = new URL(e.name, location.href);
    const t = e as PerformanceResourceTiming;
    return {
      url: u.href,
      path: `${u.pathname}${u.search}`,
      kind: e.entryType === "navigation" ? "page" : u.pathname.startsWith("/_next/static/media/") ? "font" : u.pathname.startsWith("/_next/static/") ? "code" : t.initiatorType === "fetch" ? "data" : t.initiatorType || "other",
      bytes: typeof t.transferSize === "number" && t.transferSize > 0 ? t.transferSize : null,
      sameOrigin: u.origin === location.origin,
    };
  });
}

const formatBytes = (n: number | null) => (n === null ? "cached" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(2)} MB`);

export function PrivacyReceipt({ checksRun, baseline }: { checksRun: number; baseline: number | null }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [host, setHost] = useState("this site");

  useEffect(() => {
    setHost(location.host);
    const update = () => setEntries(read());
    update();
    const observer = new PerformanceObserver(update);
    observer.observe({ type: "resource", buffered: true });
    return () => observer.disconnect();
  }, []);

  const others = entries.filter((e) => !e.sameOrigin);
  const since = baseline === null ? 0 : Math.max(0, entries.length - baseline);

  return (
    <section className="glass p-5 sm:p-6" aria-labelledby="receipt">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gold/12 text-gold ring-1 ring-gold/30">
          <LockIcon className="h-5 w-5" />
        </span>
        <h2 id="receipt" className="font-display text-xl font-semibold">
          Privacy receipt
        </h2>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div className="tile p-3.5">
          <dt className="text-xs text-ink-faint">Requests this page made</dt>
          <dd className="mt-1 font-display text-3xl font-bold">
            <CountUp value={entries.length} durationMs={300} />
          </dd>
        </div>
        <div className="tile p-3.5">
          <dt className="text-xs text-ink-faint">Since your last check</dt>
          <dd className="mt-1 font-display text-3xl font-bold text-risk-low" aria-live="polite">
            {checksRun === 0 ? "–" : since}
          </dd>
        </div>
      </dl>

      <p className={`mt-3 flex items-start gap-2 text-sm ${others.length === 0 ? "text-ink" : "text-risk-high"}`}>
        <CheckCircleIcon className={`mt-0.5 h-4 w-4 shrink-0 ${others.length === 0 ? "text-risk-low" : "text-risk-high"}`} />
        {others.length === 0 ? (
          <span className="min-w-0 flex-1">
            All of them went to
            {/* The hostname stays on one line; if the column is too narrow it is cut with an ellipsis. */}
            <span className="block truncate whitespace-nowrap font-semibold" title={host}>
              {host}
            </span>
            None to any other site.
          </span>
        ) : (
          <>{others.length} went to other sites.</>
        )}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        <strong className="font-semibold text-ink">Your amount never left your device.</strong> This list comes from
        your browser&rsquo;s own record of the page&rsquo;s requests, and checking adds none.
      </p>

      <details className="mt-3">
        <summary className="cursor-pointer select-none text-sm font-medium text-gold hover:text-gold-bright">Show every request</summary>
        <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1 font-mono text-xs">
          {entries.map((e, i) => (
            <li key={`${e.url}-${i}`} className="flex gap-2 rounded-md bg-white/5 px-2 py-1.5">
              <span className="w-10 shrink-0 text-ink-faint">{e.kind}</span>
              <span className={`min-w-0 flex-1 truncate ${e.sameOrigin ? "" : "text-risk-high"}`} title={e.url}>
                {e.sameOrigin ? e.path : e.url}
              </span>
              <span className="shrink-0 text-ink-faint">{formatBytes(e.bytes)}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
