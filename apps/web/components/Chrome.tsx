"use client";

// The shared chrome: links to both tools, the nav's snapshot status and the
// ticker. The status and ticker read the public stats snapshot; neither shows a
// number it does not have.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { STALE_MS, snapshotAge } from "@/lib/freshness";
import { useStats } from "@/lib/useStats";

const TOOLS = [
  ["/check", "check an amount", "amount"],
  ["/linked", "have I been linked?", "address"],
] as const;

export function NavLinks() {
  const path = usePathname();
  return (
    <div className="flex items-center gap-4 text-[13px] sm:gap-6">
      {TOOLS.map(([href, full, short]) => (
        <Link key={href} href={href} prefetch={false} className="lnk" aria-current={path === href ? "page" : undefined}>
          <span className="sm:hidden">{short}</span>
          <span className="hidden sm:inline">{full}</span>
        </Link>
      ))}
    </div>
  );
}

export function NavStatus() {
  const data = useStats();
  if (data.status === "loading") {
    return (
      <span className="st text-dim">
        <i />
        <span className="text-ink-muted">connecting</span>
      </span>
    );
  }
  if (data.status === "error") {
    return (
      <span className="st text-risk-high">
        <i />
        offline
      </span>
    );
  }
  const at = data.payload.generatedAt;
  const fresh = Date.now() - Date.parse(at) < STALE_MS;
  return (
    <span className={`st ${fresh ? "live text-accent" : "text-risk-medium"}`} title={new Date(at).toUTCString()}>
      <i />
      <span className="hidden sm:inline">snapshot&nbsp;</span>
      {snapshotAge(at)}
    </span>
  );
}

export function Ticker() {
  const data = useStats();
  if (data.status !== "ready") return null; // no placeholder numbers
  const { stats, tipHeight } = data.payload;
  const n = (v: number) => v.toLocaleString("en-US");
  const items = [
    <>
      24h <b>{n(stats.last24h.withdrawals)}</b> withdrawals · <em>{n(stats.last24h.standOut)} stood out</em>
    </>,
    <>
      30d <b>{n(stats.deposits30d)}</b> deposits
    </>,
    tipHeight !== null ? (
      <>
        tip <b>{n(tipHeight)}</b>
      </>
    ) : null,
    <>
      an amount check sends <em>0 requests</em>
    </>,
  ].filter(Boolean);
  return (
    <div className="ticker" aria-label="Live from the chain">
      <div className="track">
        {[0, 1].map((copy) =>
          items.map((it, i) => (
            <span key={`${copy}-${i}`} aria-hidden={copy === 1 ? true : undefined}>
              {it}
            </span>
          )),
        )}
      </div>
    </div>
  );
}
