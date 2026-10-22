"use client";

// The privacy receipt, as a network log: every request this page made, from the
// browser's own record, and how many came after the last check.
// - On /check (subject "amount") a check should add none; any request after it
//   is shown in coral, not hidden.
// - On /linked (subject "address") a check adds the bucket download; `summary`
//   says exactly what it sent.

import { useEffect, useState } from "react";
import { Win } from "@/components/Term";
import { formatBytes, useRequestLog } from "@/lib/requestLog";

const COLLAPSE_OVER = 6;
const SHOW_WHEN_COLLAPSED = 5;

export function Netlog({
  checksRun,
  baseline,
  summary,
  subject = "amount",
  lastLabel,
}: {
  checksRun: number;
  /** requestCount() taken when the last check ran (null before any check). */
  baseline: number | null;
  /** Exactly what the last check sent, in one line (shown prominently when given). */
  summary?: React.ReactNode;
  /** What the user typed: "amount" on /check, "address" on /linked. */
  subject?: "amount" | "address";
  /** A short name for the last check, e.g. the amount. */
  lastLabel?: string;
}) {
  const entries = useRequestLog();
  const [all, setAll] = useState(false);
  const [host, setHost] = useState("this site");
  useEffect(() => setHost(location.host), []);

  const others = entries.filter((e) => !e.sameOrigin);
  const since = baseline === null ? null : Math.max(0, entries.length - baseline);
  const expectNone = subject === "amount";
  const sinceTone = since === null ? "text-ink-muted" : expectNone ? (since > 0 ? "text-risk-high" : "text-accent") : "text-ink";
  const collapsed = !all && entries.length > COLLAPSE_OVER;
  const rows = collapsed ? entries.slice(0, SHOW_WHEN_COLLAPSED) : entries;

  return (
    <Win title="netlog — privacy receipt" status={since === null ? "no check yet" : `since check: ${since}`} statusClassName={sinceTone} aria-labelledby="receipt">
      <div className="px-3.5 pb-3.5 pt-3 text-[11.5px] leading-[1.75]">
        <h2 id="receipt" className="sr-only">
          Privacy receipt
        </h2>
        {summary && (
          <p className="mb-3 border-l-2 border-accent bg-panel px-3 py-2 text-[12.5px] leading-relaxed text-ink" aria-live="polite">
            {summary}
          </p>
        )}
        <ul aria-label="Every request this page made">
          {rows.map((e, i) => (
            <li key={`${e.url}-${i}`} className={`grid grid-cols-[44px_minmax(0,1fr)_auto] gap-2.5 ${e.sameOrigin ? "text-ink-muted" : "text-risk-high"}`}>
              <span>{e.kind}</span>
              <span className={`truncate ${e.sameOrigin ? "text-ink" : ""}`} title={e.url}>
                {e.sameOrigin ? e.path : e.url}
              </span>
              <span>{formatBytes(e.bytes)}</span>
            </li>
          ))}
        </ul>
        {collapsed && (
          <p className="text-ink-muted">
            … {entries.length - SHOW_WHEN_COLLAPSED} more, {others.length === 0 ? "all same origin" : `${others.length} to other sites`} ·{" "}
            <button type="button" className="lnk text-accent" onClick={() => setAll(true)}>
              show all
            </button>
          </p>
        )}
        <div className="my-2 border-t border-dashed border-line-strong" />
        <p className="flex justify-between gap-3">
          <span className="min-w-0 truncate">
            {entries.length} requests · {others.length === 0 ? `all to ${host}` : `${entries.length - others.length} to ${host}`}
          </span>
          <span className={others.length === 0 ? "text-risk-low" : "text-risk-high"}>{others.length} elsewhere</span>
        </p>
        {checksRun > 0 && since !== null && (
          <p className="mt-1 flex justify-between gap-3">
            <span className="min-w-0 truncate">
              check #{checksRun}
              {lastLabel ? ` · ${lastLabel}` : ""}
            </span>
            <span className={sinceTone}>
              +{since} request{since === 1 ? "" : "s"}
              {expectNone && since === 0 ? " ✓" : ""}
            </span>
          </p>
        )}
        <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
          <strong className="font-semibold text-ink">Your {subject} never left your device.</strong> This list is your
          browser&rsquo;s own record of the page&rsquo;s requests.{" "}
          {expectNone ? "Checking adds none." : "A check adds only the bucket download described above."}
        </p>
      </div>
    </Win>
  );
}
