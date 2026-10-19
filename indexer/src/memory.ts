// In-memory copy of what the public snapshots need: the window's non-dust
// shields (slim) and non-dust unshield amounts/times, keyed by block height.
//
// Loaded from the database once at startup; afterwards every collector cycle
// updates it from the blocks it just fetched from 3xpl, so building a snapshot
// never re-reads tens of thousands of rows from Neon (database egress).

import { computeLinkStats, encodeShields, TXID_PREFIX_LENGTH, type LinkStats, type Pool, type ShieldsPayload, type StatsPayload } from "@ail/core";
import { and, eq, gte, sql } from "drizzle-orm";
import { turnstileEvents } from "./db/schema";
import { RETENTION_DAYS, type Db } from "./db/store";
import type { BlockRows } from "./ingest";

const DAY_MS = 86_400_000;

interface MemShield {
  time: number;
  amountZat: number;
  pool: Pool;
  txidPrefix: string;
}

interface MemUnshield {
  time: number;
  amountZat: number;
}

interface HeightEntry {
  shields: MemShield[];
  unshields: MemUnshield[];
}

export class WindowMemory {
  private byHeight = new Map<number, HeightEntry>();
  /** False until loaded (or after an error): the next cycle does a full reload. */
  loaded = false;
  /** True when something changed since the last snapshot was written. */
  dirty = false;
  /** When this process last wrote the snapshots (Unix ms). */
  lastSnapshotAt: number | null = null;

  /** Full reload from the database: the only place that reads event rows in bulk. */
  async load(db: Db, now: Date): Promise<void> {
    const since = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
    const window = and(eq(turnstileEvents.isDust, false), gte(turnstileEvents.time, since));
    const t = sql<string>`extract(epoch from ${turnstileEvents.time})::bigint`;
    const shields = await db
      .select({ h: turnstileEvents.height, t, a: turnstileEvents.amountZat, p: turnstileEvents.pool, x: sql<string>`left(${turnstileEvents.txid}, ${TXID_PREFIX_LENGTH})` })
      .from(turnstileEvents)
      .where(and(window, eq(turnstileEvents.direction, "shield")));
    const unshields = await db
      .select({ h: turnstileEvents.height, t, a: turnstileEvents.amountZat })
      .from(turnstileEvents)
      .where(and(window, eq(turnstileEvents.direction, "unshield")));
    this.byHeight.clear();
    for (const r of shields) this.entry(r.h).shields.push({ time: Number(r.t) * 1000, amountZat: Number(r.a), pool: r.p as Pool, txidPrefix: r.x });
    for (const r of unshields) this.entry(r.h).unshields.push({ time: Number(r.t) * 1000, amountZat: Number(r.a) });
    this.loaded = true;
    this.dirty = true;
  }

  private entry(height: number): HeightEntry {
    let e = this.byHeight.get(height);
    if (!e) this.byHeight.set(height, (e = { shields: [], unshields: [] }));
    return e;
  }

  /** Replaces the given heights with the blocks just written (idempotent). */
  applyBlocks(rows: BlockRows[]): void {
    for (const b of rows) {
      const height = b.block.height;
      const fresh: HeightEntry = { shields: [], unshields: [] };
      for (const e of b.events) {
        if (e.isDust) continue;
        const time = new Date(e.time).getTime();
        const amountZat = Number(e.amountZat);
        if (e.direction === "shield") fresh.shields.push({ time, amountZat, pool: e.pool as Pool, txidPrefix: e.txid.slice(0, TXID_PREFIX_LENGTH) });
        else fresh.unshields.push({ time, amountZat });
      }
      this.byHeight.set(height, fresh);
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
    for (const [h, e] of this.byHeight) {
      const s = e.shields.filter((x) => x.time >= cutoff);
      const u = e.unshields.filter((x) => x.time >= cutoff);
      if (s.length !== e.shields.length || u.length !== e.unshields.length) this.dirty = true;
      if (s.length === 0 && u.length === 0) this.byHeight.delete(h);
      else this.byHeight.set(h, { shields: s, unshields: u });
    }
  }

  get eventCount(): number {
    let n = 0;
    for (const e of this.byHeight.values()) n += e.shields.length + e.unshields.length;
    return n;
  }

  /** The two public payloads, exactly as a full rebuild from the database would produce them. */
  payloads(now: Date, tipHeight: number | null): { shields: ShieldsPayload; stats: StatsPayload; shieldCount: number } {
    const cutoff = now.getTime() - RETENTION_DAYS * DAY_MS;
    const shields: { time: number; amountZat: number; pool: Pool; txid: string }[] = [];
    const unshields: MemUnshield[] = [];
    for (const e of this.byHeight.values()) {
      for (const s of e.shields) if (s.time >= cutoff) shields.push({ time: s.time, amountZat: s.amountZat, pool: s.pool, txid: s.txidPrefix });
      for (const u of e.unshields) if (u.time >= cutoff) unshields.push(u);
    }
    const generatedAt = now.toISOString();
    const stats: LinkStats = computeLinkStats(shields, unshields, now.getTime());
    return {
      shields: encodeShields(shields, { generatedAt, tipHeight, windowDays: RETENTION_DAYS }),
      stats: { v: 2, generatedAt, tipHeight, windowDays: RETENTION_DAYS, stats },
      shieldCount: shields.length,
    };
  }
}
