// Compact wire format for recent shield events (GET /api/v1/shields) and its decoder.
//
// Rows are arrays rather than objects to keep the payload small:
//   [timeOffsetSeconds, amountZat, poolIndex, txidPrefix]
// where time = baseTime + timeOffsetSeconds. Amounts fit safely in a JS number:
// the 21M ZEC cap is 2.1e15 zatoshis, below 2^53.
//
// Only the first 12 hex characters of each txid are sent: full txids were 85%
// of the payload, and 12 characters (48 bits) are plenty to compare against the
// id shown in your own wallet.

import type { LinkStats } from "./stats";

export type Pool = "sprout" | "sapling" | "orchard" | "ironwood";

export const TXID_PREFIX_LENGTH = 12;

export interface ShieldsPayload {
  v: 1;
  generatedAt: string;
  tipHeight: number | null;
  windowDays: number;
  /** Unix seconds that row time offsets are relative to. */
  baseTime: number;
  pools: Pool[];
  rows: [number, number, number, string][];
  /** Aggregate counts only (no events), added by the collector for the home page. */
  stats?: LinkStats;
}

export interface ShieldEvent {
  /** Unix milliseconds. */
  time: number;
  amountZat: number;
  pool: Pool;
  /** First TXID_PREFIX_LENGTH hex characters of the transaction id. */
  txidPrefix: string;
}

/** A shield event as stored by the indexer, with the full txid. */
export type FullShieldEvent = Omit<ShieldEvent, "txidPrefix"> & { txid: string };

export function decodeShields(p: ShieldsPayload): ShieldEvent[] {
  if (p.v !== 1) throw new Error(`unsupported shields payload version ${String(p.v)}`);
  return p.rows.map(([dt, amountZat, poolIndex, txidPrefix]) => {
    const pool = p.pools[poolIndex];
    if (!pool) throw new Error(`unknown pool index ${poolIndex}`);
    return { time: (p.baseTime + dt) * 1000, amountZat, pool, txidPrefix };
  });
}

export function encodeShields(
  events: FullShieldEvent[],
  meta: { generatedAt: string; tipHeight: number | null; windowDays: number; stats?: LinkStats },
): ShieldsPayload {
  const pools: Pool[] = ["sprout", "sapling", "orchard", "ironwood"];
  // Fully deterministic order, so the same deposits always encode to the same bytes (and ETag).
  const sorted = [...events].sort(
    (a, b) => a.time - b.time || (a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : 0) || a.amountZat - b.amountZat || a.pool.localeCompare(b.pool),
  );
  const baseTime = sorted.length > 0 ? Math.floor(sorted[0]!.time / 1000) : 0;
  return {
    v: 1,
    ...meta,
    baseTime,
    pools,
    rows: sorted.map((e) => [Math.floor(e.time / 1000) - baseTime, e.amountZat, pools.indexOf(e.pool), e.txid.slice(0, TXID_PREFIX_LENGTH)]),
  };
}
