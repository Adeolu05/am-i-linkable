// Network-wide linkability stats for the home page "proof" strip.
//
// Computed by the collector from public events and shipped as aggregates only
// (counts), inside the shields snapshot. Uses the same rule as checkWithdrawal:
// a withdrawal of P matches a deposit X made *before* it when
// 0 <= X - P <= FEE_BAND_ZAT, looking back over the 30-day window.

import { COMMON_SET_SIZE, FEE_BAND_ZAT, WINDOW_DAYS } from "./match";

export interface TimedAmount {
  /** Unix milliseconds. */
  time: number;
  amountZat: number;
}

export interface WindowLinkStats {
  /** Non-dust deposits (shields) in the window. */
  deposits: number;
  /** Non-dust withdrawals (unshields) in the window. */
  withdrawals: number;
  /** Withdrawals with at least one earlier matching deposit. */
  matched: number;
  /** Withdrawals with only 1 or 2 earlier matching deposits: they stood out. */
  standOut: number;
  /** Withdrawals that blended into a crowd of COMMON_SET_SIZE or more deposits. */
  blendedIn: number;
}

export interface LinkStats {
  last24h: WindowLinkStats;
  last30d: WindowLinkStats;
}

const DAY = 86_400_000;

function lowerBound(sorted: TimedAmount[], amount: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.amountZat < amount) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function computeLinkStats(deposits: TimedAmount[], withdrawals: TimedAmount[], now: number): LinkStats {
  const byAmount = [...deposits].sort((a, b) => a.amountZat - b.amountZat);
  const lookback = WINDOW_DAYS * DAY;
  const empty = (): WindowLinkStats => ({ deposits: 0, withdrawals: 0, matched: 0, standOut: 0, blendedIn: 0 });
  const out: LinkStats = { last24h: empty(), last30d: empty() };

  for (const d of deposits) {
    if (d.time > now) continue;
    if (now - d.time <= lookback) out.last30d.deposits++;
    if (now - d.time <= DAY) out.last24h.deposits++;
  }

  for (const w of withdrawals) {
    if (w.time > now || now - w.time > lookback) continue;
    let crowd = 0;
    for (let i = lowerBound(byAmount, w.amountZat); i < byAmount.length; i++) {
      const d = byAmount[i]!;
      if (d.amountZat - w.amountZat > FEE_BAND_ZAT) break;
      if (d.time < w.time && w.time - d.time <= lookback) crowd++;
    }
    const windows = now - w.time <= DAY ? [out.last24h, out.last30d] : [out.last30d];
    for (const s of windows) {
      s.withdrawals++;
      if (crowd > 0) s.matched++;
      if (crowd > 0 && crowd <= 2) s.standOut++;
      if (crowd >= COMMON_SET_SIZE) s.blendedIn++;
    }
  }
  return out;
}

/** GET /api/v1/stats: the aggregate counts alone, so the home page needs no event data. */
export interface StatsPayload {
  v: 1;
  generatedAt: string;
  tipHeight: number | null;
  windowDays: number;
  stats: LinkStats;
}
