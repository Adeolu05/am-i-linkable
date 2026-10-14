// Backfill the last 30 days into Postgres.
//
//   pnpm --filter indexer backfill
//
// 1. Downloads the most recent daily zcash-main dumps covering the retention
//    window (checksum-verified, cached in data/3xpl-dumps/), streams and
//    parses them, and writes them in batched transactions.
// 2. Fills the gap from the last dumped block to the current tip via the JSON API.
// 3. Prunes anything older than the window and refreshes meta.
//
// Re-runnable at any point: completed dumps are recorded in meta, and every
// insert is idempotent, so an interrupted run simply continues.

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { openDb } from "./db/client";
import {
  getMeta,
  maxIndexedHeight,
  pruneBefore,
  refreshMeta,
  RETENTION_DAYS,
  setMeta,
  tableCounts,
  writeBlocks,
  type Db,
} from "./db/store";
import { emptyDumpStats, readDumpFile } from "./dumps";
import { DATA_DIR, describeError, loadEnv, requireEnv } from "./env";
import { blockToRows, type BlockRows, type SourceBlock } from "./ingest";
import { minIntervalFromEnv, threeXplBlockSource, ThreeXplClient, type DumpInfo } from "./sources/threexpl";

const DUMP_DIR = path.join(DATA_DIR, "3xpl-dumps");
const DAY_MS = 86_400_000;
const DUMP_BATCH_BLOCKS = 200;
const API_BATCH_BLOCKS = 50;
const BLOCKS_PER_DAY = 1152; // 75 s target spacing

const fmtSecs = (ms: number) => `${(ms / 1000).toFixed(0)}s`;

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function cachedDump(client: ThreeXplClient, dump: DumpInfo): Promise<string> {
  const file = path.join(DUMP_DIR, `zcash-main_${dump.date}.tsv.zst`);
  if (await exists(file)) {
    const sha = createHash("sha256").update(await readFile(file)).digest("hex");
    if (sha === dump.checksum) return file;
    console.log(`  ${dump.date}: cached file fails its checksum, downloading again`);
  }
  await writeFile(file, await client.downloadDump(dump));
  return file;
}

async function writeBatch(db: Db, batch: BlockRows[]) {
  return db.transaction(async (tx) => writeBlocks(tx as unknown as Db, batch));
}

async function main() {
  loadEnv();
  const databaseUrl = requireEnv("DATABASE_URL", "Set it to the Neon pooled connection string.");
  const client = new ThreeXplClient({
    apiKey: process.env.THREEXPL_API_KEY,
    minIntervalMs: minIntervalFromEnv(process.env.THREEXPL_MIN_INTERVAL_MS),
    dumpsKey: process.env.THREEXPL_DUMPS_KEY,
    log: (m) => console.log(`3xpl: ${m}`),
  });
  const source = threeXplBlockSource(client);
  await mkdir(DUMP_DIR, { recursive: true });

  const started = Date.now();
  const now = new Date();
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  const { db, close } = openDb(databaseUrl);
  try {
    const before = await tableCounts(db);
    const done = new Set((await getMeta<string[]>(db, "backfill_dumps_done")) ?? []);

    // 1. Daily dumps inside the window.
    let dumps: DumpInfo[] = [];
    try {
      dumps = (await client.listDumps()).filter((d) => d.date >= cutoff.toISOString().slice(0, 10));
    } catch (err) {
      console.log(`dumps: listing failed (${describeError(err)}); falling back to the JSON API for everything`);
    }
    const canDownload = dumps.length > 0 && client.hasDumpsKey;
    if (dumps.length > 0 && !canDownload) console.log("dumps: dumps key not set; using the JSON API for the whole window");

    if (canDownload) {
      console.log(`dumps: ${dumps.length} in window (${dumps[0]!.date} .. ${dumps.at(-1)!.date}), ${done.size} already loaded`);
      for (const dump of dumps) {
        if (done.has(dump.date)) continue;
        const t0 = Date.now();
        const file = await cachedDump(client, dump);
        const stats = emptyDumpStats();
        let batch: BlockRows[] = [];
        let events = 0;
        const flush = async () => {
          if (batch.length === 0) return;
          events += (await writeBatch(db, batch)).events;
          batch = [];
        };
        for await (const block of readDumpFile(file, stats)) {
          batch.push(blockToRows(block));
          if (batch.length >= DUMP_BATCH_BLOCKS) await flush();
        }
        await flush();
        if (stats.blocks !== dump.blocks) console.log(`  ${dump.date}: warning, parsed ${stats.blocks} blocks but the listing says ${dump.blocks}`);
        if (stats.unusualFlags > 0) console.log(`  ${dump.date}: note, ${stats.unusualFlags} rows had an unusual flag column`);
        done.add(dump.date);
        await setMeta(db, "backfill_dumps_done", [...done].sort());
        console.log(`  ${dump.date}: ${stats.blocks} blocks, ${stats.rows} rows, +${events} events (${fmtSecs(Date.now() - t0)}, total ${fmtSecs(Date.now() - started)})`);
      }
    }

    // 2. Gap from the last stored block (or the window start) to the tip.
    const tip = await source.tipHeight();
    const stored = await maxIndexedHeight(db);
    const from = stored !== null ? stored + 1 : tip - RETENTION_DAYS * BLOCKS_PER_DAY;
    if (from <= tip) {
      console.log(`api: filling ${from}..${tip} (${tip - from + 1} blocks) from ${client.base}`);
      const t0 = Date.now();
      let batch: BlockRows[] = [];
      for (let h = from; h <= tip; h++) {
        const block: SourceBlock = await source.block(h);
        batch.push(blockToRows(block));
        if (batch.length >= API_BATCH_BLOCKS || h === tip) {
          await writeBatch(db, batch);
          batch = [];
          const doneBlocks = h - from + 1;
          console.log(`  api: ${doneBlocks}/${tip - from + 1} blocks (${fmtSecs(Date.now() - t0)})`);
        }
      }
    }

    // 3. Enforce the window and publish meta.
    const pruned = await pruneBefore(db, cutoff);
    await setMeta(db, "last_prune_at", new Date().toISOString());
    const { plan, stats } = await refreshMeta(db, new Date(), tip);
    const after = await tableCounts(db);

    const inserted = Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v - (before[k] ?? 0)]));
    console.log("\n=== Backfill complete ===");
    console.log(
      JSON.stringify(
        {
          durationSeconds: Math.round((Date.now() - started) / 1000),
          rowsNow: after,
          netRowsAdded: inserted,
          prunedBlocks: pruned,
          coverage: stats.coverage,
          bucketPlan: plan,
          last24h: stats.windows["24h"],
          distinctTransparentAddresses: stats.distinctTransparentAddresses,
        },
        null,
        2,
      ),
    );
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(`backfill failed: ${describeError(err)}`);
  process.exit(1);
});
