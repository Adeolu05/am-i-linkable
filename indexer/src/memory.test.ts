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
    await runCycle({ source: chain, openDb: handle, now: () => now, memory, snapshotMinMs: 0 });
    expect(memory.loaded).toBe(true);
    expect(strip(memory.payloads(now, 1001))).toEqual(strip(await fromDatabase(now, 1001)));
  });
});
