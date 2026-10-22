// Saves the current public snapshots as local fixture files, so web design work
// can run without touching the production database:
//
//   pnpm --filter indexer export-fixtures              # both (~0.6 MB read)
//   pnpm --filter indexer export-fixtures -- stats-v1  # only the named keys (stats: < 1 KB)
//   pnpm --filter indexer export-fixtures -- buckets   # every address bucket of the current plan
//   pnpm --filter indexer export-fixtures -- --build   # build all three from a fresh window load (~12 MB read),
//                                                     # exactly as the collector would; writes nothing to the database
//   then start the web app with SNAPSHOT_FIXTURES_DIR=../../data/fixtures
//
// Writes data/fixtures/<key>.json (gitignored). Public data only.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { inArray, like, or } from "drizzle-orm";
import { openDb } from "./db/client";
import { snapshots } from "./db/schema";
import { DATA_DIR, describeError, loadEnv, requireEnv } from "./env";
import { getMeta, type Db } from "./db/store";
import { WindowMemory } from "./memory";
import { SHIELDS_SNAPSHOT_KEY, STATS_SNAPSHOT_KEY } from "./snapshot";

/** Builds the public payloads locally from one window load, without writing to the database. */
async function buildLocally(db: Db, dir: string) {
  const now = new Date();
  const t0 = Date.now();
  const memory = new WindowMemory();
  await memory.load(db, now);
  const tip = await getMeta<number>(db, "tip_height");
  const tipHeight = typeof tip === "number" ? tip : null;
  console.log(`window loaded: ${memory.eventCount} events in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const { shields, stats } = memory.payloads(now, tipHeight);
  const { plan, buckets } = memory.buckets(now);
  const sizes: number[] = [];
  for (const b of buckets) {
    const json = Buffer.from(JSON.stringify(b.payload));
    sizes.push(gzipSync(json, { level: 9 }).length);
    await writeFile(path.join(dir, `${b.key}.json`), json);
  }
  const totalGzipBytes = sizes.reduce((a, b) => a + b, 0);
  const statsWithPlan = { ...stats, buckets: { bits: plan.bits, bucketCount: plan.bucketCount, minBucketSize: plan.minBucketSize, maxBucketSize: plan.maxBucketSize, totalAddresses: plan.totalAddresses, totalGzipBytes } };
  await writeFile(path.join(dir, `${SHIELDS_SNAPSHOT_KEY}.json`), JSON.stringify(shields));
  await writeFile(path.join(dir, `${STATS_SNAPSHOT_KEY}.json`), JSON.stringify(statsWithPlan));
  const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
  const sorted = [...sizes].sort((a, b) => a - b);
  console.log(JSON.stringify({ plan, bucketGzip: { min: kb(sorted[0] ?? 0), median: kb(sorted[sorted.length >> 1] ?? 0), max: kb(sorted.at(-1) ?? 0), total: kb(totalGzipBytes) } }, null, 1));
}

async function main() {
  loadEnv();
  const { db, close } = openDb(requireEnv("DATABASE_URL", "Set it to the Neon pooled connection string."));
  try {
    if (process.argv.includes("--build")) {
      const dir = path.join(DATA_DIR, "fixtures");
      await mkdir(dir, { recursive: true });
      await buildLocally(db, dir);
      return;
    }
    const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
    const wantBuckets = requested.includes("buckets");
    const keys = requested.filter((k) => k !== "buckets");
    if (requested.length === 0) keys.push(SHIELDS_SNAPSHOT_KEY, STATS_SNAPSHOT_KEY);
    // Only the gzip bodies cross the network (the smallest stored form).
    const where = wantBuckets ? or(inArray(snapshots.key, keys.length > 0 ? keys : ["-"]), like(snapshots.key, "bucket-v1-%")) : inArray(snapshots.key, keys);
    const rows = await db.select({ key: snapshots.key, body: snapshots.bodyGzip }).from(snapshots).where(where);
    const dir = path.join(DATA_DIR, "fixtures");
    await mkdir(dir, { recursive: true });
    for (const r of rows) {
      const json = gunzipSync(r.body);
      await writeFile(path.join(dir, `${r.key}.json`), json);
      console.log(`data/fixtures/${r.key}.json: ${Math.round(json.length / 1024)} KB (downloaded ${Math.round(r.body.length / 1024)} KB)`);
    }
    if (wantBuckets) console.log(`buckets: ${rows.filter((r) => r.key.startsWith("bucket-v1-")).length} files, ${Math.round(rows.filter((r) => r.key.startsWith("bucket-v1-")).reduce((n, r) => n + r.body.length, 0) / 1024)} KB gzip in total`);
    const missing = keys.filter((k) => !rows.some((r) => r.key === k));
    if (missing.length > 0) console.log(`not found yet: ${missing.join(", ")}`);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(`export-fixtures failed: ${describeError(err)}`);
  process.exit(1);
});
