// In-memory copy of what the public snapshots need: the window's non-dust
// turnstile events (slim), each with the SHA-256 hashes of the transparent
// addresses involved, keyed by block height.
//
// Loaded from the database once at startup; afterwards every collector cycle
// updates it from the blocks it just fetched from 3xpl, so building snapshots
// (deposits, stats, address buckets) never re-reads rows from Neon.

import { createHash } from "node:crypto";
import {
  bucketId,
  bucketOfHash,
  computeLinkInfo,
  computeLinkStats,
  DEFAULT_MIN_BUCKET_SIZE,
  encodeBucket,
  encodeShields,
  planBuckets,
  toHex,
  TXID_PREFIX_LENGTH,
  type AddressEvent,
  type BucketPayload,
  type BucketPlan,
  type LinkStats,
  type Pool,
  type ShieldsPayload,
  type StatsPayload,
} from "@ail/core";
import { and, eq, gte, sql } from "drizzle-orm";
import { eventAddresses, turnstileEvents } from "./db/schema";
import { RETENTION_DAYS, type Db } from "./db/store";
import type { BlockRows } from "./ingest";

const DAY_MS = 86_400_000;

interface MemAddress {
  hash: Uint8Array;
  role: "input" | "output";
}

interface MemEvent {
  time: number;
  amountZat: number;
  direction: "shield" | "unshield";
  pool: Pool;
  txidPrefix: string;
  /** Transparent addresses involved (hashes only; no plaintext is kept). */
  addrs: MemAddress[];
}

const sha256 = (s: string) => new Uint8Array(createHash("sha256").update(s, "utf8").digest());
export const bucketKey = (bits: number, index: number) => `bucket-v1-${bits}-${bucketId(index, bits)}`;

export interface BucketBuild {
  plan: BucketPlan;
  buckets: { key: string; payload: BucketPayload; addresses: number }[];
}

export class WindowMemory {
  private byHeight = new Map<number, MemEvent[]>();
  /** False until loaded (or after an error): the next cycle does a full reload. */
  loaded = false;
  /** True when something changed since the last snapshot was written. */
  dirty = false;
  /** When this process last wrote the snapshots (Unix ms). */
  lastSnapshotAt: number | null = null;
  /** ETag and gzip size of each bucket row this process last wrote, to skip unchanged ones. */
  bucketRows = new Map<string, { etag: string; gzipBytes: number }>();
  /** Smallest acceptable bucket (the published anonymity set); lower only in tests. */
  minBucketSize = DEFAULT_MIN_BUCKET_SIZE;

  /** Full reload from the database: the only place that reads event rows in bulk. */
  async load(db: Db, now: Date): Promise<void> {
    const since = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
    const window = and(eq(turnstileEvents.isDust, false), gte(turnstileEvents.time, since));
    const prefix = sql<string>`left(${turnstileEvents.txid}, ${TXID_PREFIX_LENGTH})`;
    const events = await db
      .select({
        h: turnstileEvents.height,
        t: sql<string>`extract(epoch from ${turnstileEvents.time})::bigint`,
        a: turnstileEvents.amountZat,
        d: turnstileEvents.direction,
        p: turnstileEvents.pool,
        x: prefix,
      })
      .from(turnstileEvents)
      .where(window);
    // Address text (35 characters) is cheaper to send than its hash; hashed here, then dropped.
    const addresses = await db
      .select({ h: turnstileEvents.height, x: prefix, p: turnstileEvents.pool, r: sql<string>`left(${eventAddresses.role}, 1)`, a: eventAddresses.address })
      .from(eventAddresses)
      .innerJoin(turnstileEvents, and(eq(eventAddresses.txid, turnstileEvents.txid), eq(eventAddresses.pool, turnstileEvents.pool)))
      .where(and(window, eq(eventAddresses.addressType, "transparent")));

    this.byHeight.clear();
    const byKey = new Map<string, MemEvent>();
    for (const r of events) {
      const e: MemEvent = { time: Number(r.t) * 1000, amountZat: Number(r.a), direction: r.d, pool: r.p as Pool, txidPrefix: r.x, addrs: [] };
      this.list(r.h).push(e);
      byKey.set(`${r.h}|${r.x}|${r.p}`, e);
    }
    for (const r of addresses) byKey.get(`${r.h}|${r.x}|${r.p}`)?.addrs.push({ hash: sha256(r.a), role: r.r === "i" ? "input" : "output" });
    this.loaded = true;
    this.dirty = true;
    this.bucketRows.clear();
  }

  private list(height: number): MemEvent[] {
    let l = this.byHeight.get(height);
    if (!l) this.byHeight.set(height, (l = []));
    return l;
  }

  /** Replaces the given heights with the blocks just written (idempotent). */
  applyBlocks(rows: BlockRows[]): void {
    for (const b of rows) {
      const fresh: MemEvent[] = [];
      for (const e of b.events) {
        if (e.isDust) continue;
        const addrs = b.addresses
          .filter((a) => a.txid === e.txid && a.pool === e.pool && a.addressType === "transparent")
          .map((a) => ({ hash: new Uint8Array(a.addressHash), role: a.role }));
        fresh.push({
          time: new Date(e.time).getTime(),
          amountZat: Number(e.amountZat),
          direction: e.direction,
          pool: e.pool as Pool,
          txidPrefix: e.txid.slice(0, TXID_PREFIX_LENGTH),
          addrs,
        });
      }
      this.byHeight.set(b.block.height, fresh);
      // Any new block changes the published tip, even without events.
      this.dirty = true;
    }
  }

  /** Reorg rollback: forget every height at or above `height`. */
  dropFrom(height: number): void {
    for (const h of [...this.byHeight.keys()]) {
      if (h >= height) {
        this.byHeight.delete(h);
        this.dirty = true;
      }
    }
  }

  /** Drops events older than the window. */
  prune(now: number): void {
    const cutoff = now - RETENTION_DAYS * DAY_MS;
    for (const [h, list] of this.byHeight) {
      const kept = list.filter((e) => e.time >= cutoff);
      if (kept.length !== list.length) this.dirty = true;
      if (kept.length === 0) this.byHeight.delete(h);
      else this.byHeight.set(h, kept);
    }
  }

  get eventCount(): number {
    let n = 0;
    for (const l of this.byHeight.values()) n += l.length;
    return n;
  }

  private inWindow(now: Date): MemEvent[] {
    const cutoff = now.getTime() - RETENTION_DAYS * DAY_MS;
    const out: MemEvent[] = [];
    for (const l of this.byHeight.values()) for (const e of l) if (e.time >= cutoff) out.push(e);
    return out;
  }

  /** The deposits and stats payloads, exactly as a full rebuild from the database would produce them. */
  payloads(now: Date, tipHeight: number | null): { shields: ShieldsPayload; stats: StatsPayload; shieldCount: number } {
    const events = this.inWindow(now);
    const shields = events.filter((e) => e.direction === "shield").map((s) => ({ time: s.time, amountZat: s.amountZat, pool: s.pool, txid: s.txidPrefix }));
    const unshields = events.filter((e) => e.direction === "unshield");
    const generatedAt = now.toISOString();
    const stats: LinkStats = computeLinkStats(shields, unshields, now.getTime());
    return {
      shields: encodeShields(shields, { generatedAt, tipHeight, windowDays: RETENTION_DAYS }),
      stats: { v: 2, generatedAt, tipHeight, windowDays: RETENTION_DAYS, stats },
      shieldCount: shields.length,
    };
  }

  /** Address buckets for "Have I been linked?": plan from the current addresses, one payload per bucket. */
  buckets(now: Date): BucketBuild {
    const events = this.inWindow(now);
    const info = computeLinkInfo(
      events.map((e, id) => ({ id, time: e.time, amountZat: e.amountZat, direction: e.direction })),
      now.getTime(),
    );
    const byAddress = new Map<string, { hash: Uint8Array; events: AddressEvent[] }>();
    events.forEach((e, id) => {
      for (const a of e.addrs) {
        const key = toHex(a.hash);
        let entry = byAddress.get(key);
        if (!entry) byAddress.set(key, (entry = { hash: a.hash, events: [] }));
        entry.events.push({ time: e.time, amountZat: e.amountZat, direction: e.direction, pool: e.pool, txidPrefix: e.txidPrefix, role: a.role, info: info.get(id)! });
      }
    });
    const plan = planBuckets(byAddress.keys(), this.minBucketSize);
    const grouped: { hash: Uint8Array; events: AddressEvent[] }[][] = Array.from({ length: plan.bucketCount }, () => []);
    for (const a of byAddress.values()) grouped[bucketOfHash(a.hash, plan.bits)]!.push(a);
    return {
      plan,
      buckets: grouped.map((list, index) => ({
        key: bucketKey(plan.bits, index),
        payload: encodeBucket(list, { bits: plan.bits, bucket: index, windowDays: RETENTION_DAYS }),
        addresses: list.length,
      })),
    };
  }
}
