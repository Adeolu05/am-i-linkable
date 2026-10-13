// Cycle logic against a real Postgres engine (PGlite, in-memory) with a mocked block source.

import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { runCycle, type BlockSource } from "./cycle";
import type { DbHandle } from "./db/client";
import { eventAddresses, indexedBlocks, turnstileEvents } from "./db/schema";
import { getMeta, writeBlocks, type Db } from "./db/store";
import { blockToRows, type SourceBlock } from "./ingest";

const T1 = "t1WZY9kwRXkj68wGA1m8twRf63DkmqZuQnJ";
const T2 = "t1coinUURxiHT5Qgt2WfGBwv476FXzijnRU";
const NOW = new Date("2026-10-13T12:00:00Z");
const BLOCK_MS = 75_000;

/** A fake chain: each block holds one unshield to T1 of (height) zat * 1000, from Ironwood. */
class FakeChain implements BlockSource {
  blocks = new Map<number, { hash: string; txs: SourceBlock["txs"]; time: string }>();
  requests = 0;
  constructor(public tip: number) {
    for (let h = tip - 20; h <= tip; h++) this.put(h, "a");
  }
  put(height: number, variant: string, to = T1) {
    const time = new Date(NOW.getTime() - (this.tip - height) * BLOCK_MS).toISOString();
    const txid = `${variant}${String(height).padStart(10, "0")}`.padEnd(64, "0");
    const amount = BigInt(height) * 1000n;
    this.blocks.set(height, {
      hash: `${variant}-hash-${height}`,
      time,
      txs: [
        {
          txid,
          blockHeight: height,
          time,
          effects: [
            { address: "ironwood-pool", effectZat: -(amount + 15_000n) },
            { address: to, effectZat: amount },
            { address: "the-void", effectZat: 15_000n },
          ],
        },
      ],
    });
  }
  async tipHeight() {
    this.requests++;
    return this.tip;
  }
  async block(height: number): Promise<SourceBlock> {
    this.requests++;
    const b = this.blocks.get(height);
    if (!b) throw new Error(`no block ${height}`);
    return { height, hash: b.hash, time: b.time, source: "api", txs: b.txs };
  }
  async blockHash(height: number) {
    this.requests++;
    const b = this.blocks.get(height);
    if (!b) throw new Error(`no block ${height}`);
    return b.hash;
  }
}

let db: Db;
let opened = 0;
let closed = 0;
const handle = (): DbHandle => {
  opened++;
  return {
    db,
    close: async () => {
      closed++;
    },
  };
};

beforeEach(async () => {
  const client = new PGlite();
  db = drizzle(client) as unknown as Db;
  await migrate(drizzle(client), { migrationsFolder: path.resolve(import.meta.dirname, "..", "drizzle") });
  opened = 0;
  closed = 0;
});

const heights = async () => (await db.select({ h: indexedBlocks.height }).from(indexedBlocks)).map((r) => r.h).sort((a, b) => a - b);

describe("runCycle", () => {
  it("starts near the tip on an empty database and writes events, addresses and meta", async () => {
    const chain = new FakeChain(1000);
    const r = await runCycle({ source: chain, openDb: handle, now: () => NOW, maxBlocksPerCycle: 5 });
    expect(r).toMatchObject({ blocksAdded: 5, eventsAdded: 5, tipHeight: 1000, indexedHeight: 1000, reorgFrom: null, behind: 0 });
    expect(await heights()).toEqual([996, 997, 998, 999, 1000]);
    const addr = await db.select().from(eventAddresses);
    expect(addr).toHaveLength(5);
    expect(addr[0]!.addressType).toBe("transparent");
    expect(Buffer.from(addr[0]!.addressHash).toString("hex")).toMatch(/^[0-9a-f]{64}$/);
    expect(await getMeta(db, "tip_height")).toBe(1000);
    expect(await getMeta(db, "bucket_plan")).toMatchObject({ bits: 0, totalAddresses: 1, meetsTarget: false });
    expect(await getMeta(db, "stats")).toMatchObject({ windows: { "24h": { unshield: 5, shield: 0 } } });
    // The connection is opened and closed within the cycle.
    expect([opened, closed]).toEqual([1, 1]);
  });

  it("adds only new blocks on the next cycle and is idempotent", async () => {
    const chain = new FakeChain(1000);
    await runCycle({ source: chain, openDb: handle, now: () => NOW, maxBlocksPerCycle: 5 });
    chain.tip = 1002;
    chain.put(1001, "a");
    chain.put(1002, "a");
    const r = await runCycle({ source: chain, openDb: handle, now: () => NOW, maxBlocksPerCycle: 5 });
    expect(r).toMatchObject({ blocksAdded: 2, eventsAdded: 2, indexedHeight: 1002 });
    const again = await runCycle({ source: chain, openDb: handle, now: () => NOW, maxBlocksPerCycle: 5 });
    expect(again).toMatchObject({ blocksAdded: 0, eventsAdded: 0, indexedHeight: 1002, reorgFrom: null });
    expect(await db.select().from(turnstileEvents)).toHaveLength(7);
  });

  it("reports how far behind it is when capped", async () => {
    const chain = new FakeChain(1000);
    await runCycle({ source: chain, openDb: handle, now: () => NOW, maxBlocksPerCycle: 3 });
    chain.tip = 1010;
    for (let h = 1001; h <= 1010; h++) chain.put(h, "a");
    const r = await runCycle({ source: chain, openDb: handle, now: () => NOW, maxBlocksPerCycle: 4 });
    expect(r).toMatchObject({ blocksAdded: 4, indexedHeight: 1004, behind: 6 });
  });

  it("rolls back and re-fetches when a recent stored hash changed (reorg)", async () => {
    const chain = new FakeChain(1000);
    await runCycle({ source: chain, openDb: handle, now: () => NOW, maxBlocksPerCycle: 5 });
    // Blocks 999 and 1000 are replaced; the new 1000 pays T2 instead of T1.
    chain.put(999, "b");
    chain.put(1000, "b", T2);
    const r = await runCycle({ source: chain, openDb: handle, now: () => NOW, maxBlocksPerCycle: 5 });
    expect(r).toMatchObject({ reorgFrom: 999, blocksAdded: 2, indexedHeight: 1000 });
    const rows = await db.select({ h: indexedBlocks.height, hash: indexedBlocks.hash }).from(indexedBlocks);
    expect(rows.find((x) => x.h === 1000)!.hash).toBe("b-hash-1000");
    const txids = (await db.select({ txid: turnstileEvents.txid }).from(turnstileEvents)).map((x) => x.txid);
    expect(txids.filter((t) => t.startsWith("a")).length).toBe(3); // 996..998 survive
    expect(txids.filter((t) => t.startsWith("b")).length).toBe(2);
    const outputs = await db.select({ a: eventAddresses.address }).from(eventAddresses);
    expect(outputs.map((o) => o.a)).toContain(T2);
  });

  it("fills in missing hashes for dump-loaded blocks", async () => {
    const chain = new FakeChain(1000);
    const dumpBlock = await chain.block(1000);
    await writeBlocks(db, [blockToRows({ ...dumpBlock, hash: null, source: "dump" })]);
    const r = await runCycle({ source: chain, openDb: handle, now: () => NOW });
    expect(r.reorgFrom).toBeNull();
    const [row] = await db.select({ hash: indexedBlocks.hash, source: indexedBlocks.source }).from(indexedBlocks);
    expect(row).toEqual({ hash: "a-hash-1000", source: "dump" });
  });

  it("prunes data older than 30 days once a day", async () => {
    const chain = new FakeChain(1000);
    const old = await chain.block(990);
    await writeBlocks(db, [blockToRows({ ...old, time: "2026-09-01T00:00:00.000Z" })]);
    await runCycle({ source: chain, openDb: handle, now: () => NOW, maxBlocksPerCycle: 3 });
    // The cycle continues from the stored height (990), then prunes the stale block itself.
    expect(await heights()).toEqual([991, 992, 993]);
    expect(await db.select().from(turnstileEvents)).toHaveLength(3);

    // Not due again within 24 h: an old block written now survives the next cycle.
    await writeBlocks(db, [blockToRows({ ...old, time: "2026-09-01T00:00:00.000Z" })]);
    const later = new Date(NOW.getTime() + 3_600_000);
    const r = await runCycle({ source: chain, openDb: handle, now: () => later });
    expect(r.pruned).toBe(0);
    expect(await heights()).toContain(990);
  });

  it("closes the connection even when the source fails", async () => {
    const chain = new FakeChain(1000);
    chain.tipHeight = async () => {
      throw new Error("source down");
    };
    await expect(runCycle({ source: chain, openDb: handle, now: () => NOW })).rejects.toThrow("source down");
    expect([opened, closed]).toEqual([1, 1]);
  });
});
