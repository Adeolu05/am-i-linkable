// Cycle logic against a real Postgres engine (PGlite, in-memory) with a mocked block source.

import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { runCycle, type BlockSource } from "./cycle";
import type { DbHandle } from "./db/client";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import { decodeShields, type ShieldsPayload, type StatsPayload } from "@ail/core";
import { eventAddresses, indexedBlocks, snapshots, turnstileEvents } from "./db/schema";
import { eq } from "drizzle-orm";
import { buildShieldsSnapshot, etagFor, SHIELDS_SNAPSHOT_KEY, STATS_SNAPSHOT_KEY } from "./snapshot";
import { getMeta, writeBlocks, type Db } from "./db/store";
import { blockToRows, type SourceBlock } from "./ingest";

// Synthetic addresses: valid checksums, made from hashes of fixed labels, not anyone's wallet.
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

describe("shields snapshot", () => {
  const T3 = "t1WZY9kwRXkj68wGA1m8twRf63DkmqZuQnJ";
  const shieldBlock = (height: number, txid: string, amount: bigint, time: string): SourceBlock => ({
    height,
    hash: `s-${height}`,
    time,
    source: "api",
    txs: [
      {
        txid,
        blockHeight: height,
        time,
        effects: [
          { address: T3, effectZat: -(amount + 15_000n) },
          { address: "sapling-pool", effectZat: amount },
          { address: "the-void", effectZat: 15_000n },
        ],
      },
    ],
  });
  const readSnapshot = async (key = SHIELDS_SNAPSHOT_KEY) => (await db.select().from(snapshots).where(eq(snapshots.key, key)))[0]!;
  const decode = (gz: Uint8Array) => JSON.parse(gunzipSync(gz).toString("utf8")) as ShieldsPayload;

  it("is rebuilt at the end of a cycle with shields only, dust excluded and txids cut to 12 characters", async () => {
    const full = "c".repeat(64);
    const chain = new FakeChain(1000);
    await runCycle({ source: chain, openDb: handle, now: () => NOW, maxBlocksPerCycle: 2, snapshot: false });
    await writeBlocks(db, [
      blockToRows(shieldBlock(900, full, 250_000_000n, "2026-10-13T10:00:00.000Z")),
      blockToRows(shieldBlock(901, "d".repeat(64), 50_000n, "2026-10-13T11:00:00.000Z")), // dust
      blockToRows(shieldBlock(902, "e".repeat(64), 300_000_000n, "2026-09-01T00:00:00.000Z")), // outside 30 days
    ]);
    // Only re-verify the two fake-chain blocks; the shield blocks above are not on the fake chain.
    const r = await runCycle({ source: chain, openDb: handle, now: () => NOW, reorgDepth: 2 });
    expect(r.snapshotError).toBeNull();
    expect(r.snapshot?.rows).toBe(1);

    const row = await readSnapshot();
    expect(row.key).toBe(SHIELDS_SNAPSHOT_KEY);
    const payload = decode(row.bodyGzip);
    expect(payload.tipHeight).toBe(1000);
    expect(payload.stats).toBeUndefined();
    // Aggregates live in their own tiny row: the fake chain's 2 recent unshields have no earlier matching deposit.
    const statsRow = await readSnapshot(STATS_SNAPSHOT_KEY);
    const stats = JSON.parse(gunzipSync(statsRow.bodyGzip).toString("utf8")) as StatsPayload;
    expect(stats).toMatchObject({ v: 2, tipHeight: 1000, windowDays: 30 });
    expect(stats.stats.last24h).toMatchObject({ deposits: 1, withdrawals: 2, matched: 0, standOut: 0 });
    expect(statsRow.etag).toBe(etagFor(gunzipSync(statsRow.bodyGzip)));
    expect(statsRow.jsonBytes).toBeLessThan(1000);
    // Aggregates only: no lists, no txids, no addresses; every value is a count
    // or setting, apart from the generation time.
    const leaves: [string, unknown][] = [];
    const walk = (v: unknown, at: string): void => {
      expect(Array.isArray(v), `${at} is a list`).toBe(false);
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
      else leaves.push([at, v]);
    };
    walk(stats, "stats");
    for (const [at, v] of leaves) expect(typeof v === "number" || (at === "stats.generatedAt" && typeof v === "string"), at).toBe(true);
    expect(gunzipSync(statsRow.bodyGzip).toString()).not.toMatch(/cccccccccccc|t[13][1-9A-HJ-NP-Za-km-z]{33}/);
    expect(payload.rows).toEqual([[0, 250_000_000, 1, "cccccccccccc"]]);
    const json = gunzipSync(row.bodyGzip);
    expect(json.toString()).not.toContain(full);
    expect(row.etag).toBe(etagFor(json));
    expect(row.jsonBytes).toBe(json.length);
    expect(decodeShields(payload)[0]).toMatchObject({ amountZat: 250_000_000, pool: "sapling", txidPrefix: "cccccccccccc" });
  });

  it("stores brotli when it fits the time budget and skips it otherwise", async () => {
    await writeBlocks(db, [blockToRows(shieldBlock(900, "f".repeat(64), 250_000_000n, "2026-10-13T10:00:00.000Z"))]);
    const withBr = await buildShieldsSnapshot(db, NOW, 30_000);
    expect(withBr.brBytes).not.toBeNull();
    const row = await readSnapshot();
    expect(brotliDecompressSync(row.bodyBr!).equals(gunzipSync(row.bodyGzip))).toBe(true);

    const noBr = await buildShieldsSnapshot(db, NOW, 0);
    expect(noBr.brBytes).toBeNull();
    expect((await readSnapshot()).bodyBr).toBeNull();
  });
});
