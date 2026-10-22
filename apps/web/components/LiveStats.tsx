"use client";

// Live numbers for the home page, from GET /api/v1/stats: aggregate counts only,
// identical for every visitor. Leads with the withdrawals that stood out (only
// 1 or 2 possible deposits), not raw amount matches, which include crowds.
// Every count compares each withdrawal with a fixed lookback that lies fully
// inside the data (see docs/MATCHING.md), so older withdrawals are not
// flagged just because their history is missing.

import { Cmd, Cursor, Ln, Win } from "@/components/Term";
import { freshness } from "@/lib/freshness";
import { useStats } from "@/lib/useStats";

const n = (v: number) => v.toLocaleString("en-US");
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export function StatsWindow() {
  const data = useStats();
  const p = data.status === "ready" ? data.payload : null;
  const s = p?.stats ?? null;
  // Older snapshots (v1) carried a biased 30-day count; show only what is fair.
  const fair = s && "fair" in s ? s.fair : null;

  return (
    <Win title="stats — live" status={p ? freshness(p.generatedAt) : data.status === "error" ? "unavailable" : "loading"} statusClassName={p ? "text-accent" : "text-ink-muted"} aria-label="Live from the chain" aria-busy={data.status === "loading"}>
      <div className="term">
        <Cmd i={0}>stats --last 24h</Cmd>
        {data.status === "loading" && <Ln i={1} className="text-ink-muted">{"  fetching /api/v1/stats …"}</Ln>}
        {data.status === "error" && <Ln i={1} className="text-ink-muted">{"  stats unavailable right now. The check still works."}</Ln>}
        {s && (
          <>
            <Ln i={1}>
              {"  withdrawals      "}
              <span className="text-ink">{n(s.last24h.withdrawals)}</span>
            </Ln>
            <Ln i={2}>
              {"  stood out        "}
              <span className="text-risk-high">{n(s.last24h.standOut)}</span>
              <span className="text-ink-muted">{`  (${pct(s.last24h.standOut, s.last24h.withdrawals)}%)  only 1–2 possible deposits`}</span>
            </Ln>
            <Ln i={3}>
              {"  blended in       "}
              <span className="text-risk-low">{n(s.last24h.blendedIn)}</span>
              <span className="text-ink-muted">{"  crowd of 10+ deposits"}</span>
            </Ln>
            {fair && (
              <>
                <Cmd i={4}>{`stats --since ${fair.periodDays}d --lookback ${fair.lookbackDays}d`}</Cmd>
                <Ln i={5}>
                  {"  stood out        "}
                  <span className="text-risk-high">{n(fair.standOut)}</span>
                  <span className="text-ink-muted">{` of ${n(fair.withdrawals)} compared`}</span>
                </Ln>
              </>
            )}
          </>
        )}
        <Ln i={s ? (fair ? 6 : 4) : 2}>
          <span className="text-accent">$</span> <Cursor />
        </Ln>
      </div>
    </Win>
  );
}

/** value: a number, null while loading, or undefined when this snapshot lacks it (shown as a dash). */
function Cell({ label, value, note, tone = "text-ink" }: { label: string; value: number | null | undefined; note: string; tone?: string }) {
  return (
    <div>
      <span className="up block">{label}</span>
      <b className={`mt-2.5 block text-[32px] font-semibold leading-none tracking-[-0.02em] ${tone}`}>
        {value === null ? <span className="inline-block h-8 w-28 animate-pulse rounded bg-panel align-middle" /> : value === undefined ? <span className="text-ink-muted">–</span> : n(value)}
      </b>
      <small className="mt-2 block text-[11px] text-ink-muted">{note}</small>
    </div>
  );
}

export function StatsStrip() {
  const data = useStats();
  const p = data.status === "ready" ? data.payload : null;
  const s = p?.stats ?? null;
  const fair = s && "fair" in s ? s.fair : null;
  const deposits30d = s && "deposits30d" in s ? s.deposits30d : null;
  /** null while loading; undefined once loaded if this snapshot lacks the value. */
  const v = (x: number | null | undefined) => (p ? (x ?? undefined) : data.status === "error" ? undefined : null);
  const days = fair ? `${fair.periodDays}d` : "23d";
  const back = fair?.lookbackDays ?? 7;

  return (
    <section aria-label="Withdrawals compared with the days before them">
      <div className="cells grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 max-lg:[&>*:nth-child(3)]:border-l-0 max-sm:[&>*]:border-l-0 max-sm:[&>*+*]:border-t max-lg:[&>*:nth-child(n+3)]:border-t [&>*]:border-line">
        <Cell label={`stood out · ${days}`} value={v(fair?.standOut)} note={`only 1–2 possible deposits in the ${back} days before`} tone="text-risk-high" />
        <Cell label="compared" value={v(fair?.withdrawals)} note={`each with ${back} full days of history`} />
        <Cell label="blended in" value={v(fair?.blendedIn)} note="crowd of 10+ deposits" />
        <Cell label="deposits · 30d" value={v(deposits30d)} note="into the shielded pools" />
      </div>
      <p className="mt-3.5 max-w-[80ch] text-[13px] leading-relaxed text-ink-muted">
        A withdrawal &ldquo;stands out&rdquo; when only one or two deposits in its lookback had the same amount, or the
        same plus a typical fee. Every withdrawal counted has its full lookback in our data, so older ones are not
        flagged just because their history is missing. Such withdrawals may be linkable; this is a risk signal, not
        proof.
      </p>
    </section>
  );
}
