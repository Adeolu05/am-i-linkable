// One collector cycle: verify recent hashes (reorg check), fetch new blocks,
// and write everything in a single transaction.

import type { DbHandle } from "./db/client";
import {
  deleteFromHeight,
  getMeta,
  lastBlocks,
  maxIndexedHeight,
  pruneBefore,
  refreshMeta,
  RETENTION_DAYS,
  setBlockHash,
  setMeta,
  writeBlocks,
} from "./db/store";
import { blockToRows, type BlockRows, type SourceBlock } from "./ingest";

export interface BlockSource {
  tipHeight(): Promise<number>;
  block(height: number): Promise<SourceBlock>;
  blockHash(height: number): Promise<string>;
}

export interface CycleOptions {
  source: BlockSource;
  openDb: () => DbHandle;
  now?: () => Date;
  /** How many recent stored blocks to re-verify. */
  reorgDepth?: number;
  /** Upper bound on blocks fetched per cycle; the collector loops again immediately if it falls behind. */
  maxBlocksPerCycle?: number;
  pruneEveryMs?: number;
}

export interface CycleResult {
  blocksAdded: number;
  eventsAdded: number;
  migrationsAdded: number;
  tipHeight: number;
  indexedHeight: number | null;
  /** Lowest height rolled back because its stored hash no longer matched, if any. */
  reorgFrom: number | null;
  pruned: number;
  /** Blocks still between the indexed height and the tip after this cycle. */
  behind: number;
  durationMs: number;
}

const DAY_MS = 86_400_000;

export async function runCycle(opts: CycleOptions): Promise<CycleResult> {
  const now = opts.now ?? (() => new Date());
  const reorgDepth = opts.reorgDepth ?? 10;
  const maxBlocks = opts.maxBlocksPerCycle ?? 500;
  const pruneEveryMs = opts.pruneEveryMs ?? DAY_MS;
  const started = Date.now();

  const handle = opts.openDb();
  try {
    const { db } = handle;
    const tip = await opts.source.tipHeight();

    // Reorg check: compare the last N stored hashes with the source.
    const recent = await lastBlocks(db, reorgDepth);
    let reorgFrom: number | null = null;
    const hashFixes: { height: number; hash: string }[] = [];
    for (const b of recent) {
      if (b.height > tip) {
        reorgFrom = Math.min(reorgFrom ?? b.height, b.height);
        continue;
      }
      const actual = await opts.source.blockHash(b.height);
      if (b.hash === null) hashFixes.push({ height: b.height, hash: actual });
      else if (b.hash !== actual) reorgFrom = Math.min(reorgFrom ?? b.height, b.height);
    }

    const stored = await maxIndexedHeight(db);
    let from: number;
    if (reorgFrom !== null) from = reorgFrom;
    else if (stored !== null) from = stored + 1;
    // Empty database: start near the tip (the backfill is what loads history).
    else from = Math.max(0, tip - maxBlocks + 1);
    const to = Math.min(tip, from + maxBlocks - 1);

    const rows: BlockRows[] = [];
    for (let h = from; h <= to; h++) rows.push(blockToRows(await opts.source.block(h)));

    const lastPrune = await getMeta<string>(db, "last_prune_at");
    const pruneDue = !lastPrune || now().getTime() - new Date(lastPrune).getTime() >= pruneEveryMs;

    // Everything below happens in one transaction: readers never see a half-applied cycle.
    const result = await db.transaction(async (tx) => {
      const t = tx as unknown as typeof db;
      if (reorgFrom !== null) await deleteFromHeight(t, reorgFrom);
      for (const f of hashFixes) if (reorgFrom === null || f.height < reorgFrom) await setBlockHash(t, f.height, f.hash);
      const written = await writeBlocks(t, rows);
      let pruned = 0;
      if (pruneDue) {
        pruned = await pruneBefore(t, new Date(now().getTime() - RETENTION_DAYS * DAY_MS));
        await setMeta(t, "last_prune_at", now().toISOString(), now());
      }
      await refreshMeta(t, now(), tip);
      return { written, pruned };
    });

    const indexedHeight = rows.length > 0 ? to : stored;
    return {
      blocksAdded: result.written.blocks,
      eventsAdded: result.written.events,
      migrationsAdded: result.written.migrations,
      tipHeight: tip,
      indexedHeight,
      reorgFrom,
      pruned: result.pruned,
      behind: indexedHeight === null ? tip : Math.max(0, tip - indexedHeight),
      durationMs: Date.now() - started,
    };
  } finally {
    await handle.close();
  }
}

export function formatCycle(r: CycleResult): string {
  const parts = [
    `+${r.blocksAdded} blocks`,
    `+${r.eventsAdded} events`,
    `+${r.migrationsAdded} migrations`,
    `indexed ${r.indexedHeight ?? "-"}`,
    `tip ${r.tipHeight}`,
  ];
  if (r.behind > 0) parts.push(`behind ${r.behind}`);
  if (r.reorgFrom !== null) parts.push(`reorg from ${r.reorgFrom}`);
  if (r.pruned > 0) parts.push(`pruned ${r.pruned} blocks`);
  parts.push(`${(r.durationMs / 1000).toFixed(1)}s`);
  return `cycle: ${parts.join(", ")}`;
}
