// "Have I been linked?": per-event linkability for transparent addresses, the
// bucket file format, and plain-English explanations.
//
// A bucket file holds, for every address whose SHA-256 starts with the bucket's
// prefix, that address's own shield/unshield events plus AGGREGATE linkability
// numbers. It never names a counterparty: no other address, no other txid, no
// other amount. See docs/PRIVACY.md for why each field is safe to publish.

import { FEE_BAND_ZAT, riskFor, WINDOW_DAYS, type Risk } from "./match";
import type { Pool } from "./shields";
import { toBase64, toHex } from "./sha256";

const DAY = 86_400_000;

export interface LinkEventInput {
  /** Any unique id; used to return results. */
  id: number;
  /** Unix milliseconds. */
  time: number;
  amountZat: number;
  direction: "shield" | "unshield";
}

export interface LinkInfo {
  /**
   * Withdrawal: deposits made before it (within 30 days) whose amount could have
   * funded it. Deposit: later withdrawals (within 30 days after it) its amount
   * could have funded.
   */
  matches: number;
  /**
   * Deposit only: of those later withdrawals, the smallest number of deposits
   * any one of them could have come from (its crowd). 1 means some withdrawal
   * matched this deposit and no other. Null for withdrawals (their crowd is `matches`).
   */
  crowd: number | null;
  /**
   * Withdrawal: time since the newest matching deposit. Deposit: time until the
   * later withdrawal with the smallest crowd. Null when there are no matches.
   */
  gapMs: number | null;
  /** Days of our data the comparison could use (30 = full; less near the window edges). */
  lookDays: number;
}

/** Linkability of every event, using the same rule as the "Before you move" checker. */
export function computeLinkInfo(events: LinkEventInput[], now: number, dataStart = now - WINDOW_DAYS * DAY): Map<number, LinkInfo> {
  const lookback = WINDOW_DAYS * DAY;
  const deposits = events.filter((e) => e.direction === "shield" && e.time >= dataStart && e.time <= now).sort((a, b) => a.amountZat - b.amountZat);
  const lower = (x: number) => {
    let lo = 0;
    let hi = deposits.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (deposits[mid]!.amountZat < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const out = new Map<number, LinkInfo>();
  const depositBest = new Map<number, { later: number; crowd: number; gap: number }>();

  for (const w of events) {
    // Every withdrawal gets an entry (even one stamped slightly after `now` by clock skew);
    // it can only ever match deposits made before it.
    if (w.direction !== "unshield") continue;
    const matched: LinkEventInput[] = [];
    for (let i = lower(w.amountZat); i < deposits.length; i++) {
      const d = deposits[i]!;
      if (d.amountZat - w.amountZat > FEE_BAND_ZAT) break;
      if (d.time < w.time && w.time - d.time <= lookback) matched.push(d);
    }
    const newest = matched.reduce((t, d) => Math.max(t, d.time), -Infinity);
    out.set(w.id, {
      matches: matched.length,
      crowd: null,
      gapMs: matched.length > 0 ? w.time - newest : null,
      lookDays: Math.max(0, Math.min(WINDOW_DAYS, Math.floor((w.time - dataStart) / DAY))),
    });
    for (const d of matched) {
      const prev = depositBest.get(d.id);
      const gap = w.time - d.time;
      if (!prev) depositBest.set(d.id, { later: 1, crowd: matched.length, gap });
      else {
        prev.later++;
        if (matched.length < prev.crowd || (matched.length === prev.crowd && gap < prev.gap)) {
          prev.crowd = matched.length;
          prev.gap = gap;
        }
      }
    }
  }
  for (const d of events) {
    if (d.direction !== "shield") continue;
    const best = depositBest.get(d.id);
    out.set(d.id, {
      matches: best?.later ?? 0,
      crowd: best?.crowd ?? null,
      gapMs: best?.gap ?? null,
      lookDays: Math.max(0, Math.min(WINDOW_DAYS, Math.floor((now - d.time) / DAY))),
    });
  }
  return out;
}

// ---- Bucket file format ----

/**
 * One event of one address:
 * [timeOffsetSec, amountZat, direction (0 deposit/shield, 1 withdrawal/unshield),
 *  poolIndex, txidPrefix (12 hex), role (0 spent from this address, 1 paid to it),
 *  matches, crowd (-1 = none), gapMinutes (rounded; -1 = none), lookDays]
 */
export type BucketEventRow = [number, number, 0 | 1, number, string, 0 | 1, number, number, number, number];

/**
 * No timestamps of its own: the bytes (and ETag) change only when an address's
 * data changes, so unchanged buckets are neither rewritten nor re-downloaded.
 * Freshness comes from GET /api/v1/stats.
 */
export interface BucketPayload {
  v: 1;
  bits: number;
  bucket: number;
  bucketCount: number;
  windowDays: number;
  /** Unix seconds that event time offsets are relative to. */
  baseTime: number;
  pools: Pool[];
  /** [SHA-256 of the address (base64), its events]. Sorted by hash. Never a plaintext address. */
  addresses: [string, BucketEventRow[]][];
}

export const BUCKET_POOLS: Pool[] = ["sprout", "sapling", "orchard", "ironwood"];

/** Gaps are published coarsely: 5-minute steps under an hour, whole hours after that. */
export function roundGapMinutes(ms: number): number {
  const m = ms / 60_000;
  return m < 60 ? Math.max(5, Math.round(m / 5) * 5) : Math.round(m / 60) * 60;
}

export interface AddressEvent {
  time: number;
  amountZat: number;
  direction: "shield" | "unshield";
  pool: Pool;
  txidPrefix: string;
  role: "input" | "output";
  info: LinkInfo;
}

export function encodeBucket(
  addresses: { hash: Uint8Array; events: AddressEvent[] }[],
  meta: { bits: number; bucket: number; windowDays: number },
): BucketPayload {
  const all = addresses.flatMap((a) => a.events);
  const baseTime = all.length > 0 ? Math.floor(Math.min(...all.map((e) => e.time)) / 1000) : 0;
  const rows: [string, BucketEventRow[]][] = addresses
    .map((a): [string, BucketEventRow[]] => [
      toBase64(a.hash),
      [...a.events]
        .sort((x, y) => x.time - y.time || (x.txidPrefix < y.txidPrefix ? -1 : 1) || x.role.localeCompare(y.role))
        .map((e) => [
          Math.floor(e.time / 1000) - baseTime,
          e.amountZat,
          e.direction === "shield" ? 0 : 1,
          BUCKET_POOLS.indexOf(e.pool),
          e.txidPrefix,
          e.role === "input" ? 0 : 1,
          e.info.matches,
          e.info.crowd ?? -1,
          e.info.gapMs === null ? -1 : roundGapMinutes(e.info.gapMs),
          e.info.lookDays,
        ]),
    ])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { v: 1, ...meta, bucketCount: 2 ** meta.bits, baseTime, pools: BUCKET_POOLS, addresses: rows };
}

export interface DecodedEvent {
  time: number;
  amountZat: number;
  direction: "shield" | "unshield";
  pool: Pool;
  txidPrefix: string;
  role: "input" | "output";
  matches: number;
  crowd: number | null;
  gapMinutes: number | null;
  lookDays: number;
}

/** The events of one address (by its SHA-256), or null if it is not in this bucket. */
export function findInBucket(p: BucketPayload, hash: Uint8Array): DecodedEvent[] | null {
  const want = toBase64(hash);
  const hit = p.addresses.find(([h]) => h === want);
  if (!hit) return null;
  return hit[1].map(([dt, amountZat, dir, pool, txidPrefix, role, matches, crowd, gap, lookDays]) => ({
    time: (p.baseTime + dt) * 1000,
    amountZat,
    direction: dir === 0 ? "shield" : "unshield",
    pool: p.pools[pool] ?? "sapling",
    txidPrefix,
    role: role === 0 ? "input" : "output",
    matches,
    crowd: crowd < 0 ? null : crowd,
    gapMinutes: gap < 0 ? null : gap,
    lookDays,
  }));
}

/** Bucket index of a hash under a plan of `bits` bits (top bits of the hash). */
export function bucketOfHash(hash: Uint8Array, bits: number): number {
  if (bits === 0) return 0;
  return parseInt(toHex(hash.slice(0, 4)), 16) >>> (32 - bits);
}


// ---- Explanations ----

export interface EventVerdict {
  risk: Risk;
  headline: string;
  detail: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function describeGap(minutes: number): string {
  if (minutes < 60) return plural(minutes, "minute");
  const h = Math.round(minutes / 60);
  if (h < 48) return plural(h, "hour");
  return plural(Math.round(h / 24), "day");
}

export function explainEvent(e: DecodedEvent): EventVerdict {
  const partial = e.lookDays < WINDOW_DAYS ? ` (we could only compare it with the ${plural(e.lookDays, "day")} of data we hold ${e.direction === "unshield" ? "before" : "after"} it)` : "";
  if (e.direction === "unshield") {
    const gapMs = e.gapMinutes === null ? null : e.gapMinutes * 60_000;
    const risk = riskFor(e.matches, gapMs);
    if (e.matches === 0) return { risk, headline: "No deposit matched this withdrawal", detail: `No deposit in the 30 days before it had this amount or this amount plus a typical fee${partial}.` };
    const when = e.gapMinutes === null ? "" : ` The closest was made about ${describeGap(e.gapMinutes)} before it.`;
    if (risk === "high") return { risk, headline: `Only ${plural(e.matches, "deposit")} matched this withdrawal: may be linkable`, detail: `Its amount matches so few earlier deposits that it may be linkable to ${e.matches === 1 ? "that deposit" : "one of them"}.${when}${partial}` };
    if (risk === "medium") return { risk, headline: `${plural(e.matches, "deposit")} matched this withdrawal: may be linkable`, detail: `A small crowd or a long gap weakens the link, but it may still be linkable.${when}${partial}` };
    return { risk, headline: `${plural(e.matches, "deposit")} matched: it blends in`, detail: `Many earlier deposits could have funded it, so it blends into a crowd.${when}${partial}` };
  }
  if (e.matches === 0 || e.crowd === null) {
    return { risk: "low", headline: "No later withdrawal matched this deposit (so far)", detail: `No withdrawal since then had a matching amount${partial}. A future withdrawal of a similar amount could still match it.` };
  }
  const gapMs = e.gapMinutes === null ? null : e.gapMinutes * 60_000;
  const risk = riskFor(e.crowd, gapMs);
  const after = e.gapMinutes === null ? "" : ` about ${describeGap(e.gapMinutes)} later`;
  if (risk === "high")
    return {
      risk,
      headline: `A later withdrawal matched this deposit: may be linkable`,
      detail: `A withdrawal${after} had a matching amount, and only ${plural(e.crowd, "deposit")} could have funded it, this one included. ${plural(e.matches, "withdrawal")} in total matched it${partial}.`,
    };
  return {
    risk,
    headline: risk === "medium" ? "A later withdrawal matched this deposit within a small crowd" : `${plural(e.matches, "later withdrawal")} matched, but within a crowd`,
    detail: `The most telling one${after} could have come from ${plural(e.crowd, "deposit")}${partial}.`,
  };
}

const ORDER: Record<Risk, number> = { high: 3, medium: 2, low: 1 };

export function addressVerdict(events: DecodedEvent[]): Risk {
  return events.reduce<Risk>((worst, e) => (ORDER[explainEvent(e).risk] > ORDER[worst] ? explainEvent(e).risk : worst), "low");
}
