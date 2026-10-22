// One collector cycle: verify recent hashes (reorg check), fetch new blocks,
// and write everything in a single transaction. The public snapshots are
// rebuilt from an in-memory window (memory.ts), not by re-reading the database,
// and at most every snapshotMinMs, to keep database egress tiny.

import type { DbHandle } from "./db/client";
import {
  deleteFromHeight,
  getMeta,
  lastBlocks,
  maxIndexedHeight,
  pruneBefore,
  refreshAggregates,
  RETENTION_DAYS,
  setBlockHash,
  setMeta,
  setRunMeta,
  writeBlocks,
} from "./db/store";
import { describeError } from "./env";
import { blockToRows, type BlockRows, type SourceBlock } from "./ingest";
import { WindowMemory } from "./memory";
import { formatSnapshot, writeSnapshots, type SnapshotInfo } from "./snapshot";

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
  /** Rebuild the public snapshots after writing (default true). */
  snapshot?: boolean;
  /**
   * The collector's in-memory window, kept across cycles. Without one, a
   * temporary window is loaded from the database (a full read) for this cycle.
   */
  memory?: WindowMemory;
  /** Minimum time between snapshot rebuilds (default 30 minutes). */
  snapshotMinMs?: number;
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
  /** The rebuilt public payload, or null when skipped or failed. */
  snapshot: SnapshotInfo | null;
  /** Why no snapshot was written this cycle (unchanged, or not due yet). */
  snapshotSkipped: string | null;
  /** Log-safe reason the snapshot failed; the cycle's blocks are still committed. */
  snapshotError: string | null;
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
      await setRunMeta(t, now(), tip);
      return { written, pruned };
    });

    // Update the in-memory window from what was just committed, then rebuild the
    // public snapshots if something changed and a rebuild is due. A failure here
    // is reported but does not undo the cycle; the previous snapshot stays live.
    let snapshot: SnapshotInfo | null = null;
    let snapshotError: string | null = null;
    let snapshotSkipped: string | null = null;
    if (opts.snapshot !== false) {
      const memory = opts.memory ?? new WindowMemory();
      try {
        if (!memory.loaded) {
          await memory.load(db, now());
        } else {
          if (reorgFrom !== null) memory.dropFrom(reorgFrom);
          memory.applyBlocks(rows);
        }
        memory.prune(now().getTime());
        const minMs = opts.snapshotMinMs ?? 30 * 60_000;
        const due = memory.lastSnapshotAt === null || now().getTime() - memory.lastSnapshotAt >= minMs;
        if (!memory.dirty) snapshotSkipped = "snapshot unchanged";
        else if (!due) snapshotSkipped = `snapshot due in ${Math.ceil((minMs - (now().getTime() - memory.lastSnapshotAt!)) / 60_000)} min`;
        else {
          snapshot = await writeSnapshots(db, memory, now(), tip);
          await refreshAggregates(db, now(), snapshot.buckets.plan);
          memory.dirty = false;
          memory.lastSnapshotAt = now().getTime();
        }
      } catch (err) {
        snapshotError = describeError(err);
        // If in doubt, start again from the database next cycle.
        memory.loaded = false;
      }
    }

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
      snapshot,
      snapshotSkipped,
      snapshotError,
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
  if (r.snapshot) parts.push(formatSnapshot(r.snapshot));
  if (r.snapshotSkipped) parts.push(r.snapshotSkipped);
  if (r.snapshotError) parts.push(`snapshot failed: ${r.snapshotError}`);
  parts.push(`${(r.durationMs / 1000).toFixed(1)}s`);
  return `cycle: ${parts.join(", ")}`;
}
