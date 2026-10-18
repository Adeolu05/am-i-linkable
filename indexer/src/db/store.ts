// Database operations shared by the backfill and the collector. Works with any
// Drizzle Postgres database (node-postgres in production, PGlite in tests).

import { DEFAULT_MIN_BUCKET_SIZE, planBucketsFromCounts, type BucketPlan } from "@ail/core";
import { count, desc, eq, gte, lt, max, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { BlockRows } from "../ingest";
import { eventAddresses, indexedBlocks, meta, poolMigrations, turnstileEvents } from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, any>;

export const RETENTION_DAYS = 30;

/** Rows per INSERT statement; keeps every statement well under Postgres' 65,535-parameter limit. */
const CHUNK = 1000;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface WriteResult {
  blocks: number;
  events: number;
  addresses: number;
  migrations: number;
}

/**
 * Affected-row count without RETURNING, so writes send nothing back over the network
 * (node-postgres reports rowCount; PGlite, used in tests, reports affectedRows).
 */
function affected(r: unknown): number {
  const x = r as { rowCount?: number | null; affectedRows?: number };
  return x.rowCount ?? x.affectedRows ?? 0;
}

/** Idempotent: rows already present are left untouched (a known block's missing hash is filled in). */
export async function writeBlocks(db: Db, batch: BlockRows[]): Promise<WriteResult> {
  const result: WriteResult = { blocks: 0, events: 0, addresses: 0, migrations: 0 };
  if (batch.length === 0) return result;
  for (const part of chunks(batch.map((b) => b.block))) {
    const r = await db
      .insert(indexedBlocks)
      .values(part)
      .onConflictDoUpdate({
        target: indexedBlocks.height,
        set: { hash: sql`coalesce(excluded.hash, ${indexedBlocks.hash})` },
        // Only touch rows that actually gain a hash; otherwise it is a no-op.
        setWhere: sql`${indexedBlocks.hash} is null and excluded.hash is not null`,
      });
    result.blocks += affected(r);
  }
  for (const part of chunks(batch.flatMap((b) => b.events))) {
    result.events += affected(await db.insert(turnstileEvents).values(part).onConflictDoNothing());
  }
  for (const part of chunks(batch.flatMap((b) => b.addresses))) {
    result.addresses += affected(await db.insert(eventAddresses).values(part).onConflictDoNothing());
  }
  for (const part of chunks(batch.flatMap((b) => b.migrations))) {
    result.migrations += affected(await db.insert(poolMigrations).values(part).onConflictDoNothing());
  }
  return result;
}

export async function maxIndexedHeight(db: Db): Promise<number | null> {
  const [r] = await db.select({ h: max(indexedBlocks.height) }).from(indexedBlocks);
  return r?.h ?? null;
}

export async function lastBlocks(db: Db, n: number): Promise<{ height: number; hash: string | null }[]> {
  return db
    .select({ height: indexedBlocks.height, hash: indexedBlocks.hash })
    .from(indexedBlocks)
    .orderBy(desc(indexedBlocks.height))
    .limit(n);
}

/** Removes a block range and, through cascades, every event and migration in it. */
export async function deleteFromHeight(db: Db, height: number): Promise<number> {
  return affected(await db.delete(indexedBlocks).where(gte(indexedBlocks.height, height)));
}

export async function setBlockHash(db: Db, height: number, hash: string): Promise<void> {
  await db.update(indexedBlocks).set({ hash }).where(eq(indexedBlocks.height, height));
}

/** Drops blocks (and their events) older than the retention window. */
export async function pruneBefore(db: Db, cutoff: Date): Promise<number> {
  return affected(await db.delete(indexedBlocks).where(lt(indexedBlocks.time, cutoff)));
}

export async function getMeta<T>(db: Db, key: string): Promise<T | undefined> {
  const [r] = await db.select({ value: meta.value }).from(meta).where(eq(meta.key, key));
  return r?.value as T | undefined;
}

export async function setMeta(db: Db, key: string, value: unknown, now = new Date()): Promise<void> {
  await db
    .insert(meta)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: meta.key, set: { value, updatedAt: now } });
}

export async function tableCounts(db: Db): Promise<Record<string, number>> {
  const one = async (t: typeof indexedBlocks | typeof turnstileEvents | typeof eventAddresses | typeof poolMigrations) =>
    Number((await db.select({ n: count() }).from(t))[0]?.n ?? 0);
  return {
    indexed_blocks: await one(indexedBlocks),
    turnstile_events: await one(turnstileEvents),
    event_addresses: await one(eventAddresses),
    pool_migrations: await one(poolMigrations),
  };
}

export interface WindowStats {
  shield: number;
  unshield: number;
  dustShield: number;
  dustUnshield: number;
  shieldedZat: string;
  unshieldedZat: string;
  byPool: Record<string, { shield: number; unshield: number; shieldedZat: string; unshieldedZat: string }>;
  migrations: number;
  migratedZat: string;
}

export interface Stats {
  generatedAt: string;
  coverage: { fromHeight: number | null; toHeight: number | null; fromTime: string | null; toTime: string | null; blocks: number };
  windows: Record<"24h" | "7d" | "30d", WindowStats>;
  distinctTransparentAddresses: number;
}

const toIso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

async function windowStats(db: Db, since: Date): Promise<WindowStats> {
  const rows = await db
    .select({
      pool: turnstileEvents.pool,
      direction: turnstileEvents.direction,
      n: count(),
      dust: sql<number>`count(*) filter (where ${turnstileEvents.isDust})`.mapWith(Number),
      zat: sql<string>`coalesce(sum(${turnstileEvents.amountZat}), 0)::text`,
    })
    .from(turnstileEvents)
    .where(gte(turnstileEvents.time, since))
    .groupBy(turnstileEvents.pool, turnstileEvents.direction);
  const [mig] = await db
    .select({
      n: count(),
      // Value that left the source pools; jsonb amounts are decimal strings.
      zat: sql<string>`coalesce(sum((select sum((l->>'amountZat')::numeric) from jsonb_array_elements(${poolMigrations.fromPools}) l)), 0)::text`,
    })
    .from(poolMigrations)
    .where(gte(poolMigrations.time, since));

  const w: WindowStats = {
    shield: 0,
    unshield: 0,
    dustShield: 0,
    dustUnshield: 0,
    shieldedZat: "0",
    unshieldedZat: "0",
    byPool: {},
    migrations: Number(mig?.n ?? 0),
    migratedZat: mig?.zat ?? "0",
  };
  let shielded = 0n;
  let unshielded = 0n;
  for (const r of rows) {
    const p = (w.byPool[r.pool] ??= { shield: 0, unshield: 0, shieldedZat: "0", unshieldedZat: "0" });
    const n = Number(r.n);
    if (r.direction === "shield") {
      w.shield += n;
      w.dustShield += r.dust;
      shielded += BigInt(r.zat);
      p.shield = n;
      p.shieldedZat = r.zat;
    } else {
      w.unshield += n;
      w.dustUnshield += r.dust;
      unshielded += BigInt(r.zat);
      p.unshield = n;
      p.unshieldedZat = r.zat;
    }
  }
  w.shieldedZat = shielded.toString();
  w.unshieldedZat = unshielded.toString();
  return w;
}

export async function computeStats(db: Db, now: Date): Promise<Stats> {
  const day = 86_400_000;
  const [cov] = await db
    .select({
      fromHeight: sql<number | null>`min(${indexedBlocks.height})`,
      toHeight: sql<number | null>`max(${indexedBlocks.height})`,
      fromTime: sql<string | null>`min(${indexedBlocks.time})`,
      toTime: sql<string | null>`max(${indexedBlocks.time})`,
      blocks: count(),
    })
    .from(indexedBlocks);
  const [addr] = await db
    .select({ n: sql<number>`count(distinct ${eventAddresses.addressHash})`.mapWith(Number) })
    .from(eventAddresses)
    .where(eq(eventAddresses.addressType, "transparent"));
  return {
    generatedAt: now.toISOString(),
    coverage: {
      fromHeight: cov?.fromHeight == null ? null : Number(cov.fromHeight),
      toHeight: cov?.toHeight == null ? null : Number(cov.toHeight),
      fromTime: toIso(cov?.fromTime),
      toTime: toIso(cov?.toTime),
      blocks: Number(cov?.blocks ?? 0),
    },
    windows: {
      "24h": await windowStats(db, new Date(now.getTime() - day)),
      "7d": await windowStats(db, new Date(now.getTime() - 7 * day)),
      "30d": await windowStats(db, new Date(now.getTime() - RETENTION_DAYS * day)),
    },
    distinctTransparentAddresses: addr?.n ?? 0,
  };
}

/** Prefix length of the per-bucket counts the database sends (4,096 rows at most). */
const BUCKET_COUNT_BITS = 12;

/**
 * Bucket plan over every distinct transparent address currently stored. The
 * database counts addresses per 12-bit hash prefix and sends only those counts
 * (a few KB), not the hashes themselves (~4 MB).
 */
export async function computeBucketPlan(db: Db): Promise<BucketPlan> {
  const prefix = sql<number>`(get_byte(${eventAddresses.addressHash}, 0) << 4) | (get_byte(${eventAddresses.addressHash}, 1) >> 4)`;
  const rows = await db
    .select({ p: prefix.mapWith(Number), n: sql<number>`count(distinct ${eventAddresses.addressHash})`.mapWith(Number) })
    .from(eventAddresses)
    .where(eq(eventAddresses.addressType, "transparent"))
    .groupBy(prefix);
  const counts = new Uint32Array(2 ** BUCKET_COUNT_BITS);
  for (const r of rows) counts[r.p] = r.n;
  return planBucketsFromCounts(counts, BUCKET_COUNT_BITS, DEFAULT_MIN_BUCKET_SIZE);
}

/** Cheap per-cycle bookkeeping (writes only). */
export async function setRunMeta(db: Db, now: Date, tipHeight: number | null): Promise<void> {
  if (tipHeight != null) await setMeta(db, "tip_height", tipHeight, now);
  await setMeta(db, "last_run_at", now.toISOString(), now);
}

/**
 * Recomputes the bucket plan and window stats (aggregates computed in the
 * database; only a few KB come back). Run when snapshots are rebuilt, not every cycle.
 */
export async function refreshAggregates(db: Db, now: Date): Promise<{ plan: BucketPlan; stats: Stats }> {
  const plan = await computeBucketPlan(db);
  const stats = await computeStats(db, now);
  await setMeta(db, "bucket_plan", { ...plan, targetMinBucketSize: DEFAULT_MIN_BUCKET_SIZE }, now);
  await setMeta(db, "stats", stats, now);
  return { plan, stats };
}

/** Both of the above, for one-off jobs such as the backfill. */
export async function refreshMeta(db: Db, now: Date, tipHeight: number | null): Promise<{ plan: BucketPlan; stats: Stats }> {
  await setRunMeta(db, now, tipHeight);
  return refreshAggregates(db, now);
}
