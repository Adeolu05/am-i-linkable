import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { DumpParseError, emptyDumpStats, parseDumpLine, readDumpFile, rowsToBlocks } from "./dumps";
import type { SourceBlock } from "./ingest";

// Synthetic txids (SHA-256 of fixed labels).
const TX1 = "1cd8f2c66291ea49188fa03cf85fb77ad84e5abb9c27d8c5ab82ecee6d0aaaae";
const TX2 = "14bf8676ec39ee2512dc1a2b04fb027a1b0684f6311e37b3ea94fbfbf2f470f9";
// Synthetic addresses: valid checksums, made from hashes of fixed labels, not anyone's wallet.
const T1 = "t1WZY9kwRXkj68wGA1m8twRf63DkmqZuQnJ";

const line = (height: number, tx: string, sortKey: number, address: string, sign: string, mag: string, currency = "zcash", flag = "1") =>
  ["zcash", "zcash-main", String(height), tx, String(sortKey), "2026-10-12 00:00:43", address, currency, sign, mag, flag, "\\N"].join("\t");

async function collect(gen: AsyncIterable<SourceBlock>) {
  const out: SourceBlock[] = [];
  for await (const b of gen) out.push(b);
  return out;
}

describe("parseDumpLine", () => {
  it("parses a row with sign and magnitude columns", () => {
    const r = parseDumpLine(line(3514606, TX1, 16, "ironwood-pool", "-1", "10000"));
    expect(r).toEqual({
      height: 3514606,
      txid: TX1,
      sortKey: 16,
      time: "2026-10-12T00:00:43.000Z",
      address: "ironwood-pool",
      currency: "zcash",
      effectZat: -10000n,
      flag: "1",
    });
    expect(parseDumpLine(line(3514607, TX2, 5, T1, "1", "24405156")).effectZat).toBe(24405156n);
  });

  it("keeps amounts above 2^53 exact", () => {
    expect(parseDumpLine(line(1, TX1, 0, T1, "1", "9007199254740993")).effectZat).toBe(9007199254740993n);
  });

  it("rejects malformed rows", () => {
    expect(() => parseDumpLine("too\tfew\tcolumns")).toThrow(DumpParseError);
    expect(() => parseDumpLine(line(1, TX1, 0, T1, "0", "5"))).toThrow(/bad sign/);
    expect(() => parseDumpLine(line(1, TX1, 0, T1, "1", "-5"))).toThrow(/bad magnitude/);
    expect(() => parseDumpLine(line(1, "nothex", 0, T1, "1", "5"))).toThrow(/bad txid/);
  });
});

describe("rowsToBlocks", () => {
  it("groups rows into blocks and transactions, in order", async () => {
    const stats = emptyDumpStats();
    const blocks = await collect(
      rowsToBlocks(
        [
          line(10, TX1, 0, "ironwood-pool", "-1", "3135000"),
          line(10, TX1, 1, T1, "1", "3120000"),
          line(10, TX1, 2, "the-void", "1", "15000"),
          line(11, TX2, 0, T1, "-1", "500"),
          line(11, TX2, 1, "sapling-pool", "1", "490"),
          line(11, TX2, 2, "other-token", "1", "1", "notzcash"),
          line(11, TX2, 3, "the-void", "1", "10", "zcash", "7"),
        ],
        stats,
      ),
    );
    expect(blocks.map((b) => [b.height, b.source, b.hash, b.txs.length])).toEqual([
      [10, "dump", null, 1],
      [11, "dump", null, 1],
    ]);
    expect(blocks[0]!.txs[0]!.effects).toEqual([
      { address: "ironwood-pool", effectZat: -3135000n },
      { address: T1, effectZat: 3120000n },
      { address: "the-void", effectZat: 15000n },
    ]);
    expect(stats).toEqual({ rows: 7, blocks: 2, unusualFlags: 1, skippedCurrency: 1 });
  });

  it("fails loudly if rows go backwards", async () => {
    await expect(collect(rowsToBlocks([line(11, TX1, 0, T1, "1", "1"), line(10, TX2, 0, T1, "1", "1")]))).rejects.toThrow(
      /out of order/,
    );
  });
});

describe("readDumpFile", () => {
  let dir: string | undefined;
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("stream-decompresses a zstd TSV file", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ail-dump-"));
    const file = path.join(dir, "sample.tsv.zst");
    const tsv = [line(20, TX1, 0, T1, "-1", "100"), line(20, TX1, 1, "sapling-pool", "1", "90"), line(21, TX2, 0, "the-void", "-1", "5")]
      .join("\n")
      .concat("\n");
    await writeFile(file, zstdCompressSync(Buffer.from(tsv)));
    const blocks = await collect(readDumpFile(file));
    expect(blocks.map((b) => b.height)).toEqual([20, 21]);
  });
});
