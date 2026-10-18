// Long-running collector.
//
//   pnpm --filter indexer start
//
// Every INTERVAL_MINUTES (default 10) it runs one cycle (see cycle.ts) and
// prints one log line. Between cycles it holds no database connections.
// Public snapshots are rebuilt from memory at most every SNAPSHOT_MIN_MINUTES
// (default 30), and only when something changed.
// SIGTERM/SIGINT finish the current cycle, then exit cleanly.
// `--once` runs a single cycle and exits (useful for checks and cron-style hosting).

import { formatCycle, runCycle } from "./cycle";
import { openDb } from "./db/client";
import { describeError, loadEnv, requireEnv } from "./env";
import { WindowMemory } from "./memory";
import { minIntervalFromEnv, threeXplBlockSource, ThreeXplClient } from "./sources/threexpl";

async function main() {
  loadEnv();
  const databaseUrl = requireEnv("DATABASE_URL", "Set it to the Neon pooled connection string.");
  const intervalMinutes = Number(process.env.INTERVAL_MINUTES ?? 10);
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) throw new Error("INTERVAL_MINUTES must be a positive number");
  const snapshotMinMinutes = Number(process.env.SNAPSHOT_MIN_MINUTES ?? 30);
  if (!Number.isFinite(snapshotMinMinutes) || snapshotMinMinutes < 0) throw new Error("SNAPSHOT_MIN_MINUTES must be zero or more");
  // Loaded from the database once, then kept up to date from each cycle's blocks.
  const memory = new WindowMemory();

  const client = new ThreeXplClient({
    apiKey: process.env.THREEXPL_API_KEY,
    minIntervalMs: minIntervalFromEnv(process.env.THREEXPL_MIN_INTERVAL_MS),
    log: (m) => console.log(`3xpl: ${m}`),
  });
  const source = threeXplBlockSource(client);

  let stopping = false;
  let wake: (() => void) | undefined;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received: finishing the current cycle, then exiting`);
    wake?.();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });

  const once = process.argv.includes("--once");
  console.log(`collector started: ${once ? "single cycle" : `interval ${intervalMinutes} min`}, source ${client.base}`);
  while (!stopping) {
    let behind = 0;
    try {
      const r = await runCycle({ source, openDb: () => openDb(databaseUrl), memory, snapshotMinMs: snapshotMinMinutes * 60_000 });
      console.log(formatCycle(r));
      behind = r.behind;
    } catch (err) {
      console.error(`cycle failed: ${describeError(err)}`);
      if (once) process.exitCode = 1;
    }
    if (stopping || once) break;
    // Catch up immediately while behind; otherwise wait for the next interval.
    if (behind === 0) await sleep(intervalMinutes * 60_000);
  }
  console.log("collector stopped");
}

main().catch((err) => {
  console.error(`collector failed: ${describeError(err)}`);
  process.exit(1);
});
