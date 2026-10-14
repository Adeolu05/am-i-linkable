// Compact wire format for recent shield events (GET /api/v1/shields) and its decoder.
//
// Rows are arrays rather than objects to keep the payload small:
//   [timeOffsetSeconds, amountZat, poolIndex, txid]
// where time = baseTime + timeOffsetSeconds. Amounts fit safely in a JS number:
// the 21M ZEC cap is 2.1e15 zatoshis, below 2^53.

export type Pool = "sprout" | "sapling" | "orchard" | "ironwood";

export interface ShieldsPayload {
  v: 1;
  generatedAt: string;
  tipHeight: number | null;
  windowDays: number;
  /** Unix seconds that row time offsets are relative to. */
  baseTime: number;
  pools: Pool[];
  rows: [number, number, number, string][];
}

export interface ShieldEvent {
  /** Unix milliseconds. */
  time: number;
  amountZat: number;
  pool: Pool;
  txid: string;
}

export function decodeShields(p: ShieldsPayload): ShieldEvent[] {
  if (p.v !== 1) throw new Error(`unsupported shields payload version ${String(p.v)}`);
  return p.rows.map(([dt, amountZat, poolIndex, txid]) => {
    const pool = p.pools[poolIndex];
    if (!pool) throw new Error(`unknown pool index ${poolIndex}`);
    return { time: (p.baseTime + dt) * 1000, amountZat, pool, txid };
  });
}

export function encodeShields(
  events: ShieldEvent[],
  meta: { generatedAt: string; tipHeight: number | null; windowDays: number },
): ShieldsPayload {
  const pools: Pool[] = ["sprout", "sapling", "orchard", "ironwood"];
  const sorted = [...events].sort((a, b) => a.time - b.time);
  const baseTime = sorted.length > 0 ? Math.floor(sorted[0]!.time / 1000) : 0;
  return {
    v: 1,
    ...meta,
    baseTime,
    pools,
    rows: sorted.map((e) => [Math.floor(e.time / 1000) - baseTime, e.amountZat, pools.indexOf(e.pool), e.txid]),
  };
}
