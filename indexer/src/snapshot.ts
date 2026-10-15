// Builds the public shields payload (GET /api/v1/shields) once per collector
// cycle and stores it, compressed, in a single `snapshots` row. The website only
// reads that row, so serving the page never scans events or compresses anything.

import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { computeLinkStats, encodeShields, TXID_PREFIX_LENGTH, type FullShieldEvent, type Pool, type StatsPayload } from "@ail/core";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { snapshots, turnstileEvents } from "./db/schema";
import { getMeta, RETENTION_DAYS, type Db } from "./db/store";

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
  return { gzipBytes: bodyGzip.length, brBytes: bodyBr?.length ?? null };
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

export async function buildShieldsSnapshot(db: Db, now: Date, brotliBudgetMs = BROTLI_BUDGET_MS): Promise<SnapshotInfo> {
  const started = Date.now();
  const since = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const rows = await db
    // Epoch seconds and only the txid prefix: full txids never need to leave the database.
    .select({
      t: sql<string>`extract(epoch from ${turnstileEvents.time})::bigint`,
      amountZat: turnstileEvents.amountZat,
      pool: turnstileEvents.pool,
      txidPrefix: sql<string>`left(${turnstileEvents.txid}, ${TXID_PREFIX_LENGTH})`,
    })
    .from(turnstileEvents)
    .where(and(eq(turnstileEvents.direction, "shield"), eq(turnstileEvents.isDust, false), gte(turnstileEvents.time, since)))
    .orderBy(asc(turnstileEvents.time));
  const events: FullShieldEvent[] = rows.map((r) => ({
    time: Number(r.t) * 1000,
    amountZat: Number(r.amountZat),
    pool: r.pool as Pool,
    txid: r.txidPrefix,
  }));
  // Withdrawals only feed the aggregate counts; no withdrawal event is published.
  const unshields = await db
    .select({ t: sql<string>`extract(epoch from ${turnstileEvents.time})::bigint`, amountZat: turnstileEvents.amountZat })
    .from(turnstileEvents)
    .where(and(eq(turnstileEvents.direction, "unshield"), eq(turnstileEvents.isDust, false), gte(turnstileEvents.time, since)));
  const stats = computeLinkStats(
    events.map((e) => ({ time: e.time, amountZat: e.amountZat })),
    unshields.map((u) => ({ time: Number(u.t) * 1000, amountZat: Number(u.amountZat) })),
    now.getTime(),
  );
  const tip = await getMeta<number>(db, "tip_height");
  const tipHeight = typeof tip === "number" ? tip : null;
  const generatedAt = now.toISOString();

  const json = Buffer.from(JSON.stringify(encodeShields(events, { generatedAt, tipHeight, windowDays: RETENTION_DAYS })), "utf8");
  const shields = await storeSnapshot(db, { key: SHIELDS_SNAPSHOT_KEY, generatedAt: now, tipHeight, rowCount: events.length }, json, brotliBudgetMs);

  const statsPayload: StatsPayload = { v: 1, generatedAt, tipHeight, windowDays: RETENTION_DAYS, stats };
  const statsJson = Buffer.from(JSON.stringify(statsPayload), "utf8");
  const statsRow = await storeSnapshot(db, { key: STATS_SNAPSHOT_KEY, generatedAt: now, tipHeight, rowCount: 1 }, statsJson, brotliBudgetMs);

  return { rows: events.length, jsonBytes: json.length, ...shields, statsGzipBytes: statsRow.gzipBytes, ms: Date.now() - started };
}

export function formatSnapshot(s: SnapshotInfo): string {
  const kb = (n: number) => `${Math.round(n / 1024)} KB`;
  return `snapshot ${s.rows} shields, ${kb(s.gzipBytes)} gzip${s.brBytes === null ? "" : `, ${kb(s.brBytes)} br`}, stats ${s.statsGzipBytes} B, in ${(s.ms / 1000).toFixed(1)}s`;
}
