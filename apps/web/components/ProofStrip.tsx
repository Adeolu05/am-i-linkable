"use client";

// Live "proof" numbers from the public snapshot: aggregate counts computed by the
// collector. Nothing about the visitor is sent; this is the same file everyone gets.

import { CountUp } from "@/components/CountUp";
import { freshness, useShields } from "@/lib/useShields";

function Tile({ value, label, accent = false }: { value: number | null; label: React.ReactNode; accent?: boolean }) {
  return (
    <div className="tile p-4">
      <p className={`font-display text-4xl font-bold tracking-tight ${accent ? "text-gold" : "text-ink"}`}>
        {value === null ? <span className="inline-block h-9 w-20 animate-pulse rounded-lg bg-white/10" /> : <CountUp value={value} />}
      </p>
      <p className="mt-1 text-sm leading-snug text-ink-muted">{label}</p>
    </div>
  );
}

export function ProofStrip() {
  const data = useShields();
  const ready = data.status === "ready" ? data : null;
  const s = ready?.stats;
  const n = (v: number | undefined) => (ready ? (v ?? null) : null);
  const pct = s && s.last30d.withdrawals > 0 ? Math.round((s.last30d.matched / s.last30d.withdrawals) * 100) : null;

  return (
    <section className="glass p-5 sm:p-6" aria-labelledby="proof" aria-busy={data.status === "loading"}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="proof" className="font-display text-lg font-semibold">
          Live from the chain
        </h2>
        <span className="inline-flex items-center gap-2 text-xs text-ink-faint">
          <span className={`h-2 w-2 rounded-full ${ready ? "bg-risk-low" : "bg-white/30"}`} aria-hidden="true" />
          {ready ? freshness(ready.generatedAt) : data.status === "error" ? "unavailable" : "loading"}
        </span>
      </div>

      {data.status === "error" ? (
        <p className="mt-4 text-ink-muted">Live numbers are unavailable right now. The check still explains how matching works.</p>
      ) : s || !ready ? (
        <>
          <p className="mt-4 text-lg leading-snug">
            In the last 24 hours,{" "}
            <strong className="text-gold">{s ? <CountUp value={s.last24h.matched} /> : "…"}</strong> of{" "}
            <strong>{s ? <CountUp value={s.last24h.withdrawals} /> : "…"}</strong> withdrawals matched a recent
            deposit&rsquo;s amount.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Tile value={n(s?.last24h.standOut)} accent label="stood out in the last 24 h: only 1 or 2 possible deposits" />
            <Tile value={n(s?.last30d.deposits)} label="deposits in the last 30 days to compare against" />
            <Tile value={n(s?.last30d.withdrawals)} label="withdrawals in the last 30 days" />
            <Tile value={pct} label={<>% of those matched an earlier deposit</>} />
          </div>
        </>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Tile value={ready.index.size} label="deposits in the last 30 days to compare against" />
          <Tile value={ready.tipHeight} label="latest block indexed" />
        </div>
      )}
      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        Matching means a deposit made earlier had the same amount, or the same plus a typical fee. Such withdrawals
        may be linkable; this is a risk signal, not proof.
      </p>
    </section>
  );
}
