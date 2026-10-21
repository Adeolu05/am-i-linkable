// Network-wide linkability stats for the home page "proof" strip.
//
// Computed by the collector from public events and shipped as aggregates only
// (counts). Uses the same rule as checkWithdrawal: a withdrawal of P matches a
// deposit X made *before* it when 0 <= X - P <= FEE_BAND_ZAT.
//
// Fairness: we only hold the last WINDOW_DAYS (30) of deposits. A withdrawal
// near the start of that window would have almost no earlier deposits to be
// compared with, so it would "stand out" just because its history is missing.
// Every withdrawal is therefore compared with a fixed lookback that lies fully
// inside our data, and withdrawals without that full lookback are not counted.

import { COMMON_SET_SIZE, FEE_BAND_ZAT, WINDOW_DAYS } from "./match";

export interface TimedAmount {
  /** Unix milliseconds. */
  time: number;
  amountZat: number;
}

interface Outcome {
  /** Non-dust withdrawals (unshields) counted. */
  withdrawals: number;
  /** Withdrawals with at least one matching deposit in their lookback. */
  matched: number;
  /** Withdrawals with only 1 or 2 matching deposits in their lookback: they stood out. */
  standOut: number;
  /** Withdrawals with COMMON_SET_SIZE or more matching deposits: they blended in. */
  blendedIn: number;
  /** Each withdrawal was compared with the deposits in the this-many days before it. */
  lookbackDays: number;
}

export interface LinkStats {
  /**
   * Withdrawals in the last 24 hours, each compared with the HEADLINE_LOOKBACK_DAYS
   * days before it (every one of them has that full history in our data).
   */
  last24h: Outcome & { deposits: number };
  /**
   * The fair long view: withdrawals from the last `periodDays` days (the ones with
   * a full FAIR_LOOKBACK_DAYS of data before them), each compared with exactly
   * the FAIR_LOOKBACK_DAYS days before it.
   */
  fair: Outcome & { periodDays: number };
  /** Non-dust deposits in the data window. */
  deposits30d: number;
}

/** 29: the longest lookback every withdrawal of the last 24 hours fully has. */
export const HEADLINE_LOOKBACK_DAYS = WINDOW_DAYS - 1;
/** Fixed lookback for the 30-day view. */
export const FAIR_LOOKBACK_DAYS = 7;

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

/** Matching deposits made in the `lookbackMs` before the withdrawal. */
function crowdFor(byAmount: TimedAmount[], w: TimedAmount, lookbackMs: number): number {
  let crowd = 0;
  for (let i = lowerBound(byAmount, w.amountZat); i < byAmount.length; i++) {
    const d = byAmount[i]!;
    if (d.amountZat - w.amountZat > FEE_BAND_ZAT) break;
    if (d.time < w.time && w.time - d.time <= lookbackMs) crowd++;
  }
  return crowd;
}

function tally(o: Outcome, crowd: number) {
  o.withdrawals++;
  if (crowd > 0) o.matched++;
  if (crowd > 0 && crowd <= 2) o.standOut++;
  if (crowd >= COMMON_SET_SIZE) o.blendedIn++;
}

/**
 * @param dataStart earliest time our deposit data fully covers (default: now - 30 days).
 */
export function computeLinkStats(deposits: TimedAmount[], withdrawals: TimedAmount[], now: number, dataStart = now - WINDOW_DAYS * DAY): LinkStats {
  const byAmount = deposits.filter((d) => d.time >= dataStart && d.time <= now).sort((a, b) => a.amountZat - b.amountZat);
  const headlineMs = HEADLINE_LOOKBACK_DAYS * DAY;
  const fairMs = FAIR_LOOKBACK_DAYS * DAY;
  const empty = (lookbackDays: number): Outcome => ({ withdrawals: 0, matched: 0, standOut: 0, blendedIn: 0, lookbackDays });
  const out: LinkStats = {
    last24h: { ...empty(HEADLINE_LOOKBACK_DAYS), deposits: 0 },
    fair: { ...empty(FAIR_LOOKBACK_DAYS), periodDays: Math.max(0, Math.round((now - dataStart - fairMs) / DAY)) },
    deposits30d: byAmount.length,
  };
  for (const d of byAmount) if (now - d.time <= DAY) out.last24h.deposits++;

  for (const w of withdrawals) {
    if (w.time > now) continue;
    // Only withdrawals whose whole lookback lies inside our data are counted.
    if (now - w.time <= DAY && w.time - headlineMs >= dataStart) tally(out.last24h, crowdFor(byAmount, w, headlineMs));
    if (w.time - fairMs >= dataStart) tally(out.fair, crowdFor(byAmount, w, fairMs));
  }
  return out;
}

/** GET /api/v1/stats: the aggregate counts alone, so the home page needs no event data. */
export interface StatsPayload {
  /** 2: fixed-lookback stats (`fair`); version 1 had a biased `last30d`. */
  v: 2;
  generatedAt: string;
  tipHeight: number | null;
  windowDays: number;
  stats: LinkStats;
  /** The current address-bucket plan for "Have I been linked?" (absent before buckets existed). */
  buckets?: BucketPlanInfo;
}

export interface BucketPlanInfo {
  bits: number;
  bucketCount: number;
  minBucketSize: number;
  maxBucketSize: number;
  totalAddresses: number;
  /** Sum of all bucket files (gzip): the paranoid-mode download size. */
  totalGzipBytes: number;
}
