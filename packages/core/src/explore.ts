// Helpers for the "Before you move" page: example amounts and the crowd plot.
// Pure: they read the already-downloaded deposits and send nothing anywhere.

import { isDust } from "./dust";
import { checkWithdrawal, COMMON_SET_SIZE, FEE_BAND_ZAT, ShieldIndex, WINDOW_DAYS } from "./match";

const DAY = 86_400_000;
const TYPICAL_FEE_ZAT = 15_000;

function pick<T>(items: T[], random: () => number): T | null {
  return items.length === 0 ? null : items[Math.min(items.length - 1, Math.floor(random() * items.length))]!;
}

/**
 * A withdrawal amount that would be high risk right now: a recent deposit with a
 * unique amount, minus a typical fee (what its owner might withdraw).
 */
export function pickRiskyExample(index: ShieldIndex, now: number, random: () => number = Math.random): number | null {
  const recent = index.events.filter((e) => e.time <= now && now - e.time <= 2 * DAY).sort((a, b) => b.time - a.time);
  const found: number[] = [];
  for (const e of recent) {
    const p = e.amountZat - TYPICAL_FEE_ZAT;
    if (isDust(BigInt(p)) || p < 1_000_000) continue; // skip tiny amounts
    const r = checkWithdrawal(BigInt(p), now, index);
    if (r.kind === "result" && r.risk === "high") found.push(p);
    if (found.length >= 5) break;
  }
  return pick(found, random);
}

/** A withdrawal amount that blends into a large crowd of recent deposits. */
export function pickCommonExample(index: ShieldIndex, now: number, random: () => number = Math.random): number | null {
  const counts = new Map<number, number>();
  for (const e of index.events) {
    if (e.time > now || now - e.time > WINDOW_DAYS * DAY || isDust(BigInt(e.amountZat))) continue;
    counts.set(e.amountZat, (counts.get(e.amountZat) ?? 0) + 1);
  }
  const top = [...counts]
    .filter(([, n]) => n >= COMMON_SET_SIZE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([amount]) => amount)
    .filter((a) => {
      const r = checkWithdrawal(BigInt(a), now, index);
      return r.kind === "result" && r.risk === "low";
    });
  return pick(top, random);
}

export interface CrowdPoint {
  time: number;
  amountZat: number;
  /** Inside the matching zone [amount, amount + fee band]. */
  inBand: boolean;
}

export interface Crowd {
  /** Plotted amount range (zatoshis). */
  lo: number;
  hi: number;
  from: number;
  to: number;
  /** Deposits in the matching zone. */
  inBand: number;
  /** Deposits in the plotted range but outside the matching zone. */
  nearby: number;
  /** Points to draw: every in-band deposit plus, at most, `maxNearby` others (evenly sampled). */
  points: CrowdPoint[];
}

/** Deposits around `p` over the last 30 days, for the crowd plot. */
export function crowdAround(index: ShieldIndex, p: number, now: number, maxNearby = 600): Crowd {
  const span = Math.max(p * 0.05, 3 * FEE_BAND_ZAT);
  const lo = Math.max(0, p - span);
  const hi = p + FEE_BAND_ZAT + span;
  const from = now - WINDOW_DAYS * DAY;
  const inBand: CrowdPoint[] = [];
  const nearby: CrowdPoint[] = [];
  for (const e of index.events) {
    if (e.time < from || e.time > now || e.amountZat < lo || e.amountZat > hi) continue;
    const band = e.amountZat >= p && e.amountZat - p <= FEE_BAND_ZAT;
    (band ? inBand : nearby).push({ time: e.time, amountZat: e.amountZat, inBand: band });
  }
  const step = nearby.length > maxNearby ? nearby.length / maxNearby : 1;
  const sampled: CrowdPoint[] = [];
  for (let i = 0; i < nearby.length && sampled.length < maxNearby; i += step) sampled.push(nearby[Math.floor(i)]!);
  return { lo, hi, from, to: now, inBand: inBand.length, nearby: nearby.length, points: [...sampled, ...inBand] };
}
