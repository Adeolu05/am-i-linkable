// Reader for 3xpl daily event dumps (zstd-compressed TSV, no header row).
//
// Column layout (observed on zcash-main, module_version 1):
//   0 blockchain   1 module   2 block height   3 txid   4 sort_key
//   5 time (UTC, "YYYY-MM-DD HH:MM:SS")   6 address   7 currency
//   8 sign (-1 or 1)   9 magnitude (zatoshis)   10 flag (always "1" so far)   11 extra (\N)
// Rows are ordered by block height, then sort_key.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createZstdDecompress } from "node:zlib";
import type { SourceBlock } from "./ingest";
import type { BalanceEffect, RawTx } from "./turnstile";

export interface DumpRow {
  height: number;
  txid: string;
  sortKey: number;
  /** ISO 8601. */
  time: string;
  address: string;
  currency: string;
  effectZat: bigint;
  flag: string;
}

export class DumpParseError extends Error {}

export function parseDumpLine(line: string): DumpRow {
  const f = line.split("\t");
  if (f.length < 11) throw new DumpParseError(`expected at least 11 columns, got ${f.length}`);
  const [, , heightS, txid, sortKeyS, timeS, address, currency, signS, magS, flag] = f as [
    string, string, string, string, string, string, string, string, string, string, string,
  ];
  const height = Number(heightS);
  const sortKey = Number(sortKeyS);
  if (!Number.isInteger(height) || height < 0) throw new DumpParseError(`bad height "${heightS}"`);
  if (!Number.isInteger(sortKey)) throw new DumpParseError(`bad sort_key "${sortKeyS}"`);
  if (!/^[0-9a-f]{64}$/.test(txid)) throw new DumpParseError(`bad txid "${txid}"`);
  if (signS !== "1" && signS !== "-1") throw new DumpParseError(`bad sign "${signS}"`);
  if (!/^\d+$/.test(magS)) throw new DumpParseError(`bad magnitude "${magS}"`);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timeS)) throw new DumpParseError(`bad time "${timeS}"`);
  const magnitude = BigInt(magS);
  return {
    height,
    txid,
    sortKey,
    time: `${timeS.replace(" ", "T")}.000Z`,
    address,
    currency,
    effectZat: signS === "-1" ? -magnitude : magnitude,
    flag,
  };
}

export interface DumpStats {
  rows: number;
  blocks: number;
  /** Rows whose flag column was not "1" (meaning undocumented); kept, but counted. */
  unusualFlags: number;
  skippedCurrency: number;
}

/** Groups parsed rows (in file order) into blocks. Each block is yielded once all its rows are seen. */
export async function* rowsToBlocks(lines: AsyncIterable<string> | Iterable<string>, stats?: DumpStats): AsyncGenerator<SourceBlock> {
  let current: { height: number; time: string; txs: Map<string, BalanceEffect[]> } | undefined;
  const flush = (): SourceBlock => {
    const c = current!;
    const txs: RawTx[] = [...c.txs].map(([txid, effects]) => ({ txid, blockHeight: c.height, time: c.time, effects }));
    if (stats) stats.blocks++;
    return { height: c.height, hash: null, time: c.time, source: "dump", txs };
  };
  for await (const line of lines) {
    if (!line) continue;
    const row = parseDumpLine(line);
    if (stats) {
      stats.rows++;
      if (row.flag !== "1") stats.unusualFlags++;
    }
    if (row.currency !== "zcash") {
      if (stats) stats.skippedCurrency++;
      continue;
    }
    if (current && row.height !== current.height) {
      if (row.height < current.height) throw new DumpParseError(`rows out of order at height ${row.height}`);
      yield flush();
      current = undefined;
    }
    current ??= { height: row.height, time: row.time, txs: new Map() };
    let effects = current.txs.get(row.txid);
    if (!effects) current.txs.set(row.txid, (effects = []));
    effects.push({ address: row.address, effectZat: row.effectZat });
  }
  if (current) yield flush();
}

/** Streams a cached .tsv.zst dump file block by block without loading it all into memory. */
export function readDumpFile(file: string, stats?: DumpStats): AsyncGenerator<SourceBlock> {
  const input = createReadStream(file).pipe(createZstdDecompress());
  const lines = createInterface({ input, crlfDelay: Infinity });
  return rowsToBlocks(lines, stats);
}

export const emptyDumpStats = (): DumpStats => ({ rows: 0, blocks: 0, unusualFlags: 0, skippedCurrency: 0 });
