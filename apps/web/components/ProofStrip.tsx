"use client";

// Live numbers for the home page, from GET /api/v1/stats: aggregate counts only,
// identical for every visitor. Leads with the withdrawals that stood out (only
// 1 or 2 possible deposits), not raw amount matches, which include crowds.
// Every count compares each withdrawal with a fixed lookback that lies fully
// inside the data (see docs/MATCHING.md), so older withdrawals are not
// flagged just because their history is missing.

import { CountUp } from "@/components/CountUp";
import { freshness } from "@/lib/freshness";
import { useStats } from "@/lib/useStats";

/** value: a number, null while loading, or undefined when not available (shown as a dash). */
function Tile({ value, label, accent = false }: { value: number | null | undefined; label: React.ReactNode; accent?: boolean }) {
  return (
    <div className="tile p-4">
      <p className={`font-display text-3xl font-bold tracking-tight ${accent ? "text-gold" : "text-ink"}`}>
        {value === null ? (
          <span className="inline-block h-8 w-20 animate-pulse rounded-lg bg-white/10" />
        ) : value === undefined ? (
          <span className="text-ink-faint">&ndash;</span>
        ) : (
          <CountUp value={value} />
        )}
      </p>
      <p className="mt-1 text-sm leading-snug text-ink-muted">{label}</p>
    </div>
  );
}

export function ProofStrip() {
  const data = useStats();
  const p = data.status === "ready" ? data.payload : null;
  const s = p?.stats ?? null;
  // Older snapshots (v1) carried a biased 30-day count; show only what is fair.
  const fair = s && "fair" in s ? s.fair : null;
  const deposits30d = s && "deposits30d" in s ? s.deposits30d : null;
  /** null while loading; undefined once loaded if this snapshot lacks the value. */
  const tile = (v: number | null | undefined) => (p ? (v ?? undefined) : null);
  const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

  return (
    <section className="glass p-5 sm:p-6" aria-labelledby="proof" aria-busy={data.status === "loading"}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="proof" className="font-display text-lg font-semibold">
          Live from the chain
        </h2>
        <span className="inline-flex items-center gap-2 text-xs text-ink-faint">
          <span className={`h-2 w-2 rounded-full ${p ? "bg-risk-low" : "bg-white/30"}`} aria-hidden="true" />
          {p ? freshness(p.generatedAt) : data.status === "error" ? "unavailable" : "loading"}
        </span>
      </div>

      {data.status === "error" ? (
        <p className="mt-4 text-ink-muted">Live numbers are unavailable right now. The check still explains how matching works.</p>
      ) : (
        <>
          <div className="mt-4 flex items-end gap-4">
            <p className="font-display text-6xl font-bold leading-none tracking-tight text-gold sm:text-7xl">
              {s ? <CountUp value={s.last24h.standOut} /> : <span className="inline-block h-14 w-24 animate-pulse rounded-xl bg-white/10" />}
            </p>
            <p className="pb-1 text-base leading-snug text-ink">
              withdrawals in the last 24 hours <strong className="font-semibold">stood out</strong>: only 1 or 2
              deposits in the {s?.last24h.lookbackDays ?? 29} days before them had a matching amount, so they may be
              linkable.
            </p>
          </div>
          <p className="mt-3 text-sm text-ink-muted">
            {s ? (
              <>
                That is {pctOf(s.last24h.standOut, s.last24h.withdrawals)}% of {s.last24h.withdrawals.toLocaleString("en-US")} withdrawals.{" "}
                {s.last24h.blendedIn * 2 > s.last24h.withdrawals ? "Most blended into a crowd: " : ""}
                {s.last24h.blendedIn.toLocaleString("en-US")} matched 10 or more deposits{s.last24h.blendedIn * 2 > s.last24h.withdrawals ? "" : " and blended into a crowd"}.
              </>
            ) : (
              "Loading the latest counts…"
            )}
          </p>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Last {fair?.periodDays ?? 23} days · each vs the {fair?.lookbackDays ?? 7} days before
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Tile value={tile(fair?.standOut)} accent label={<>stood out vs the {fair?.lookbackDays ?? 7} days before them</>} />
            <Tile value={tile(fair?.withdrawals)} label="withdrawals compared (each with 7 full days of history)" />
            <Tile value={tile(fair?.blendedIn)} label="blended into a crowd of 10+ deposits" />
            <Tile value={tile(deposits30d)} label="deposits in the last 30 days" />
          </div>
        </>
      )}
      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        A withdrawal &ldquo;stands out&rdquo; when only one or two deposits in its lookback had the same amount, or the
        same plus a typical fee. Every withdrawal counted has its full lookback in our data, so older ones are not
        flagged just because their history is missing. Such withdrawals may be linkable; this is a risk signal, not
        proof.
      </p>
    </section>
  );
}
