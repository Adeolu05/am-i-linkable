// Writes the public payloads (GET /api/v1/shields, /stats, /buckets/...) as
// compressed rows in the `snapshots` table. The website only reads those rows.
// The collector builds them from its in-memory window (memory.ts), so a rebuild
// costs no database reads.

import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import type { BucketPlan } from "@ail/core";
import { and, like, notInArray } from "drizzle-orm";
import { snapshots } from "./db/schema";
import { getMeta, type Db } from "./db/store";
import { WindowMemory } from "./memory";

export const SHIELDS_SNAPSHOT_KEY = "shields-v1";
/** Aggregate counts only, for the home page (GET /api/v1/stats). */
export const STATS_SNAPSHOT_KEY = "stats-v1";
/** Max-quality brotli is ~12% smaller than gzip here; it is skipped if it would hold the cycle up longer than this. */
export const BROTLI_BUDGET_MS = 30_000;

const gz = promisify(gzip);
const brotli = promisify(brotliCompress);

export interface SnapshotInfo {
  rows: number;
  jsonBytes: number;
  gzipBytes: number;
  brBytes: number | null;
  /** Size of the stats-v1 row (gzip), written alongside. */
  statsGzipBytes: number;
  /** Address buckets: how many exist, how many changed and were rewritten, and their total gzip size. */
  buckets: { count: number; written: number; totalGzipBytes: number; plan: BucketPlan };
  ms: number;
}

/** Compresses one public payload and upserts it as a snapshot row. */
async function storeSnapshot(
  db: Db,
  row: { key: string; generatedAt: Date; tipHeight: number | null; rowCount: number },
  json: Buffer,
  brotliBudgetMs: number,
) {
  const [bodyGzip, bodyBr] = await Promise.all([gz(json, { level: 9 }), brotliWithin(json, brotliBudgetMs)]);
  const values = { ...row, etag: etagFor(json), jsonBytes: json.length, bodyGzip, bodyBr };
  await db.insert(snapshots).values(values).onConflictDoUpdate({ target: snapshots.key, set: values });
  return { gzipBytes: bodyGzip.length, brBytes: bodyBr?.length ?? null, etag: values.etag };
}

/** Weak ETag: the same tag covers the raw, gzip and brotli representations. */
export const etagFor = (json: Uint8Array) => `W/"${createHash("sha256").update(json).digest("base64url").slice(0, 22)}"`;

async function brotliWithin(json: Buffer, budgetMs: number): Promise<Buffer | null> {
  if (budgetMs <= 0) return null;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  const work = brotli(json, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: json.length },
  }).catch(() => null);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Writes both public snapshot rows (shields-v1, stats-v1) from the in-memory
 * window. Reads nothing from the database; the upserts send nothing back.
 */
export async function writeSnapshots(db: Db, memory: WindowMemory, now: Date, tipHeight: number | null, brotliBudgetMs = BROTLI_BUDGET_MS): Promise<SnapshotInfo> {
  const started = Date.now();
  const { shields: shieldsPayload, stats: statsPayload, shieldCount } = memory.payloads(now, tipHeight);
  const json = Buffer.from(JSON.stringify(shieldsPayload), "utf8");
  const shields = await storeSnapshot(db, { key: SHIELDS_SNAPSHOT_KEY, generatedAt: now, tipHeight, rowCount: shieldCount }, json, brotliBudgetMs);

  // Address buckets first, so the plan published in stats always has its buckets in place.
  // Gzip only: brotli would add ~25 s per rebuild for little gain on hash-heavy data.
  const { plan, buckets } = memory.buckets(now);
  let written = 0;
  const live = new Map<string, { etag: string; gzipBytes: number }>();
  for (const b of buckets) {
    const body = Buffer.from(JSON.stringify(b.payload), "utf8");
    const etag = etagFor(body);
    const prev = memory.bucketRows.get(b.key);
    if (prev && prev.etag === etag) {
      live.set(b.key, prev);
      continue;
    }
    const r = await storeSnapshot(db, { key: b.key, generatedAt: now, tipHeight, rowCount: b.addresses }, body, 0);
    live.set(b.key, { etag: r.etag, gzipBytes: r.gzipBytes });
    written++;
  }
  const totalGzipBytes = [...live.values()].reduce((s, x) => s + x.gzipBytes, 0);

  const statsJson = Buffer.from(
    JSON.stringify({ ...statsPayload, buckets: { bits: plan.bits, bucketCount: plan.bucketCount, minBucketSize: plan.minBucketSize, maxBucketSize: plan.maxBucketSize, totalAddresses: plan.totalAddresses, totalGzipBytes } }),
    "utf8",
  );
  const statsRow = await storeSnapshot(db, { key: STATS_SNAPSHOT_KEY, generatedAt: now, tipHeight, rowCount: 1 }, statsJson, brotliBudgetMs);

  // Bucket rows from an older plan (different bit length) are removed after the new plan is live.
  const planChanged = [...memory.bucketRows.keys()].some((k) => !live.has(k)) || memory.bucketRows.size === 0;
  if (planChanged) await db.delete(snapshots).where(and(like(snapshots.key, "bucket-v1-%"), notInArray(snapshots.key, [...live.keys()])));
  memory.bucketRows = live;

  return {
    rows: shieldCount,
    jsonBytes: json.length,
    gzipBytes: shields.gzipBytes,
    brBytes: shields.brBytes,
    statsGzipBytes: statsRow.gzipBytes,
    buckets: { count: buckets.length, written, totalGzipBytes, plan },
    ms: Date.now() - started,
  };
}

/** Full rebuild from the database (one bulk read). Used by the backfill and as the reference in tests. */
export async function buildShieldsSnapshot(db: Db, now: Date, brotliBudgetMs = BROTLI_BUDGET_MS): Promise<SnapshotInfo> {
  const memory = new WindowMemory();
  await memory.load(db, now);
  const tip = await getMeta<number>(db, "tip_height");
  return writeSnapshots(db, memory, now, typeof tip === "number" ? tip : null, brotliBudgetMs);
}

export function formatSnapshot(s: SnapshotInfo): string {
  const kb = (n: number) => `${Math.round(n / 1024)} KB`;
  return `snapshot ${s.rows} shields, ${kb(s.gzipBytes)} gzip${s.brBytes === null ? "" : `, ${kb(s.brBytes)} br`}, stats ${s.statsGzipBytes} B, buckets ${s.buckets.written}/${s.buckets.count} written (${kb(s.buckets.totalGzipBytes)} total), in ${(s.ms / 1000).toFixed(1)}s`;
}
