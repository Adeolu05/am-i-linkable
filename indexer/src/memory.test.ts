// The incrementally maintained in-memory window must always produce exactly the
// payloads a full rebuild from the database would (PGlite, mocked block source).

import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { runCycle, type BlockSource } from "./cycle";
import type { DbHandle } from "./db/client";
import { type Db } from "./db/store";
import type { SourceBlock } from "./ingest";
import { WindowMemory } from "./memory";

const T1 = "t1WZY9kwRXkj68wGA1m8twRf63DkmqZuQnJ";
const T2 = "t1coinUURxiHT5Qgt2WfGBwv476FXzijnRU";
const START = Date.parse("2026-10-18T00:00:00Z");
const BLOCK_MS = 75_000;
const DAY = 86_400_000;

/** A chain whose blocks each hold one shield and one unshield (plus some dust), with amounts that repeat. */
class Chain implements BlockSource {
  blocks = new Map<number, SourceBlock>();
  constructor(public tip: number, public genesisTime: number) {
    for (let h = tip - 30; h <= tip; h++) this.put(h, "a");
  }
  time(h: number) {
    return new Date(this.genesisTime + h * BLOCK_MS).toISOString();
  }
  put(h: number, v: string) {
    const time = this.time(h);
    const amount = BigInt(((h * 7) % 13) + 1) * 10_000_000n; // repeats, so stats see crowds
    const tx = (k: string) => `${v}${k}${String(h).padStart(8, "0")}`.padEnd(64, "0");
    this.blocks.set(h, {
      height: h,
      hash: `${v}-${h}`,
      time,
      source: "api",
      txs: [
        { txid: tx("s"), blockHeight: h, time, effects: [{ address: T1, effectZat: -(amount + 15_000n) }, { address: "ironwood-pool", effectZat: amount }, { address: "the-void", effectZat: 15_000n }] },
        { txid: tx("u"), blockHeight: h, time, effects: [{ address: "sapling-pool", effectZat: -(amount - 15_000n) }, { address: T2, effectZat: amount - 30_000n }, { address: "the-void", effectZat: 15_000n }] },
        { txid: tx("d"), blockHeight: h, time, effects: [{ address: "ironwood-pool", effectZat: -35_000n }, { address: T2, effectZat: 20_000n }, { address: "the-void", effectZat: 15_000n }] },
      ],
    });
  }
  async tipHeight() {
    return this.tip;
  }
  async block(h: number) {
    const b = this.blocks.get(h);
    if (!b) throw new Error(`no block ${h}`);
    return b;
  }
  async blockHash(h: number) {
    return (await this.block(h)).hash!;
  }
}

let db: Db;
const handle = (): DbHandle => ({ db, close: async () => {} });

beforeEach(async () => {
  const client = new PGlite();
  db = drizzle(client) as unknown as Db;
  await migrate(drizzle(client), { migrationsFolder: path.resolve(import.meta.dirname, "..", "drizzle") });
});

/** What a fresh process would publish: a full reload from the database. */
async function fromDatabase(now: Date, tip: number) {
  const fresh = new WindowMemory();
  await fresh.load(db, now);
  return fresh.payloads(now, tip);
}

const strip = (p: Awaited<ReturnType<typeof fromDatabase>>) => ({ shields: p.shields, stats: p.stats, n: p.shieldCount });

describe("WindowMemory", () => {
  it("matches a full database rebuild after several cycles", async () => {
    const chain = new Chain(1000, START - 1000 * BLOCK_MS);
    const memory = new WindowMemory();
    let now = new Date(START);
    await runCycle({ source: chain, openDb: handle, now: () => now, memory, maxBlocksPerCycle: 25, snapshotMinMs: 0 });
    for (let i = 1; i <= 4; i++) {
      for (let h = chain.tip + 1; h <= chain.tip + 3; h++) chain.put(h, "a");
      chain.tip += 3;
      now = new Date(START + i * 3 * BLOCK_MS);
      await runCycle({ source: chain, openDb: handle, now: () => now, memory, snapshotMinMs: 0 });
      expect(strip(memory.payloads(now, chain.tip))).toEqual(strip(await fromDatabase(now, chain.tip)));
    }
    // Dust never reaches the payload.
    expect(memory.payloads(now, chain.tip).shields.rows.every((r) => r[1] > 100_000)).toBe(true);
    expect(memory.payloads(now, chain.tip).stats.stats.last24h.withdrawals).toBeGreaterThan(0);
  });

  it("matches after a reorg rolls back and replaces recent blocks", async () => {
    const chain = new Chain(1000, START - 1000 * BLOCK_MS);
    const memory = new WindowMemory();
    const now = new Date(START);
    await runCycle({ source: chain, openDb: handle, now: () => now, memory, maxBlocksPerCycle: 25, snapshotMinMs: 0 });
    chain.put(999, "b");
    chain.put(1000, "b");
    const r = await runCycle({ source: chain, openDb: handle, now: () => now, memory, snapshotMinMs: 0 });
    expect(r.reorgFrom).toBe(999);
    const mem = strip(memory.payloads(now, chain.tip));
    expect(mem).toEqual(strip(await fromDatabase(now, chain.tip)));
    expect(mem.shields.rows.some((row) => row[3].startsWith("bs"))).toBe(true);
    expect(mem.shields.rows.some((row) => row[3] === "as00000999".padEnd(12, "0"))).toBe(false);
  });

  it("matches after old events fall out of the 30-day window", async () => {
    // Blocks start 29.9 days before `now`; a day later the oldest have expired.
    const now0 = new Date(START);
    const chain = new Chain(1000, now0.getTime() - 29.9 * DAY - 970 * BLOCK_MS);
    const memory = new WindowMemory();
    await runCycle({ source: chain, openDb: handle, now: () => now0, memory, maxBlocksPerCycle: 31, snapshotMinMs: 0 });
    const before = memory.eventCount;
    const later = new Date(now0.getTime() + DAY);
    await runCycle({ source: chain, openDb: handle, now: () => later, memory, snapshotMinMs: 0 });
    expect(memory.eventCount).toBeLessThan(before);
    expect(strip(memory.payloads(later, chain.tip))).toEqual(strip(await fromDatabase(later, chain.tip)));
  });

  it("rebuilds snapshots only when something changed and the interval has passed", async () => {
    const chain = new Chain(1000, START - 1000 * BLOCK_MS);
    const memory = new WindowMemory();
    let now = new Date(START);
    const run = () => runCycle({ source: chain, openDb: handle, now: () => now, memory, maxBlocksPerCycle: 25, snapshotMinMs: 30 * 60_000 });
    expect((await run()).snapshot).not.toBeNull();
    // Nothing new, 10 minutes later: unchanged, no rebuild.
    now = new Date(START + 10 * 60_000);
    expect(await run()).toMatchObject({ snapshot: null, snapshotSkipped: "snapshot unchanged" });
    // New block, but within 30 minutes of the last rebuild: deferred.
    chain.put(1001, "a");
    chain.tip = 1001;
    now = new Date(START + 20 * 60_000);
    expect((await run()).snapshotSkipped).toMatch(/snapshot due in 10 min/);
    // 30 minutes after the last rebuild: written, and it includes the deferred block.
    now = new Date(START + 31 * 60_000);
    const r = await run();
    expect(r.snapshot).not.toBeNull();
    expect(strip(memory.payloads(now, 1001))).toEqual(strip(await fromDatabase(now, 1001)));
  });

  it("falls back to a full reload after an error", async () => {
    const chain = new Chain(1000, START - 1000 * BLOCK_MS);
    const memory = new WindowMemory();
    const now = new Date(START);
    await runCycle({ source: chain, openDb: handle, now: () => now, memory, maxBlocksPerCycle: 25, snapshotMinMs: 0 });
    memory.loaded = false; // what an error in the snapshot step does
    chain.put(1001, "a");
    chain.tip = 1001;
    const r = await runCycle({ source: chain, openDb: handle, now: () => now, memory, snapshotMinMs: 0 });
    expect(r.snapshotError).toBeNull();
    expect(memory.loaded).toBe(true);
    expect(strip(memory.payloads(now, 1001))).toEqual(strip(await fromDatabase(now, 1001)));
  });
});

// ---- Address buckets ----

import { gunzipSync } from "node:zlib";
import { addressHash, toBase64, type BucketPayload } from "@ail/core";
import { like } from "drizzle-orm";
import { snapshots } from "./db/schema";
import { writeSnapshots } from "./snapshot";

async function storedBuckets(): Promise<Map<string, { body: string; payload: BucketPayload }>> {
  const rows = await db.select({ key: snapshots.key, gz: snapshots.bodyGzip }).from(snapshots).where(like(snapshots.key, "bucket-v1-%"));
  return new Map(rows.map((r) => {
    const body = gunzipSync(r.gz).toString("utf8");
    return [r.key, { body, payload: JSON.parse(body) as BucketPayload }];
  }));
}

async function bucketsFromDatabase(now: Date) {
  const fresh = new WindowMemory();
  await fresh.load(db, now);
  return fresh.buckets(now);
}

describe("address buckets", () => {
  it("match a full database rebuild after cycles, a reorg and a prune", async () => {
    const chain = new Chain(1000, START - 1000 * BLOCK_MS);
    const memory = new WindowMemory();
    let now = new Date(START);
    await runCycle({ source: chain, openDb: handle, now: () => now, memory, maxBlocksPerCycle: 25, snapshotMinMs: 0 });
    for (let h = 1001; h <= 1004; h++) chain.put(h, "a");
    chain.tip = 1004;
    now = new Date(START + 4 * BLOCK_MS);
    await runCycle({ source: chain, openDb: handle, now: () => now, memory, snapshotMinMs: 0 });
    expect(memory.buckets(now)).toEqual(await bucketsFromDatabase(now));

    chain.put(1003, "b");
    chain.put(1004, "b");
    expect((await runCycle({ source: chain, openDb: handle, now: () => now, memory, snapshotMinMs: 0 })).reorgFrom).toBe(1003);
    expect(memory.buckets(now)).toEqual(await bucketsFromDatabase(now));

    const later = new Date(START + 30 * DAY - 10 * BLOCK_MS); // the oldest blocks fall out of the window
    await runCycle({ source: chain, openDb: handle, now: () => later, memory, snapshotMinMs: 0 });
    expect(memory.buckets(later)).toEqual(await bucketsFromDatabase(later));
    expect(memory.buckets(later).buckets.flatMap((b) => b.payload.addresses).length).toBeGreaterThan(0);
  });

  it("never contain a plaintext address, and never name a counterparty", async () => {
    const chain = new Chain(1000, START - 1000 * BLOCK_MS);
    const memory = new WindowMemory();
    const now = new Date(START);
    const r = await runCycle({ source: chain, openDb: handle, now: () => now, memory, maxBlocksPerCycle: 25, snapshotMinMs: 0 });
    expect(r.snapshotError).toBeNull();
    const stored = await storedBuckets();
    expect(stored.size).toBeGreaterThan(0);
    for (const { body } of stored.values()) {
      expect(body).not.toMatch(/t[13][1-9A-HJ-NP-Za-km-z]{33}/);
      expect(body).not.toMatch(/tex1/);
    }
    // T2 only ever receives withdrawals; each matched a deposit made by T1. Its
    // entry must hold its own transactions only: no T1 hash, no deposit txid.
    const all = [...stored.values()].flatMap((s) => s.payload.addresses);
    const t2 = all.find(([h]) => h === toBase64(addressHash("t1coinUURxiHT5Qgt2WfGBwv476FXzijnRU")))!;
    const t1Hash = toBase64(addressHash("t1WZY9kwRXkj68wGA1m8twRf63DkmqZuQnJ"));
    expect(t2).toBeDefined();
    expect(JSON.stringify(t2[1])).not.toContain(t1Hash);
    for (const row of t2[1]) {
      expect(row[2]).toBe(1); // withdrawal
      expect(row[4]).toMatch(/^[ab][ud]/); // its own unshield/dust txid, never a deposit ("s")
    }
    // Some of its withdrawals did match T1's deposits: counted, never named.
    expect(t2[1].some((row) => row[6] > 0)).toBe(true);
  });

  /** Withdrawals to 16 different (synthetic, well-formed) addresses, so a plan can have several buckets. */
  class ManyChain extends Chain {
    override put(h: number, v: string) {
      super.put(h, v);
      const b = this.blocks.get(h)!;
      const to = `t1${"ABCDEFGHJKLMNPQR"[h % 16]}${"x".repeat(32)}`;
      for (const tx of b.txs) for (const e of tx.effects) if (e.address === T2) e.address = to;
    }
  }

  it("rewrites only changed buckets and removes buckets of an old plan", async () => {
    const chain = new ManyChain(1000, START - 1000 * BLOCK_MS);
    const memory = new WindowMemory();
    memory.minBucketSize = 1; // 17 addresses: a plan of at least 1 bit
    const now = new Date(START);
    const first = await runCycle({ source: chain, openDb: handle, now: () => now, memory, maxBlocksPerCycle: 25, snapshotMinMs: 0 });
    const bits = first.snapshot!.buckets.plan.bits;
    expect(bits).toBeGreaterThanOrEqual(1);
    expect((await storedBuckets()).size).toBe(2 ** bits);
    expect([...(await storedBuckets()).keys()].every((k) => k.startsWith(`bucket-v1-${bits}-`))).toBe(true);

    // Nothing new: no bucket is rewritten.
    memory.dirty = true;
    const again = await runCycle({ source: chain, openDb: handle, now: () => now, memory, snapshotMinMs: 0 });
    expect(again.snapshot?.buckets.written).toBe(0);

    // Plan change (one bucket): the old 1-bit rows disappear.
    memory.minBucketSize = 1000;
    memory.dirty = true;
    const changed = await runCycle({ source: chain, openDb: handle, now: () => now, memory, snapshotMinMs: 0 });
    expect(changed.snapshot?.buckets.plan.bits).toBe(0);
    expect([...(await storedBuckets()).keys()]).toEqual(["bucket-v1-0-0"]);
  });
});
