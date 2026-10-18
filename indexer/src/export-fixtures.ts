// Saves the current public snapshots as local fixture files, so web design work
// can run without touching the production database:
//
//   pnpm --filter indexer export-fixtures      # one small read (~0.7 MB)
//   then start the web app with SNAPSHOT_FIXTURES_DIR=../../data/fixtures
//
// Writes data/fixtures/<key>.json (gitignored). Public data only.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { inArray } from "drizzle-orm";
import { openDb } from "./db/client";
import { snapshots } from "./db/schema";
import { DATA_DIR, describeError, loadEnv, requireEnv } from "./env";
import { SHIELDS_SNAPSHOT_KEY, STATS_SNAPSHOT_KEY } from "./snapshot";

async function main() {
  loadEnv();
  const { db, close } = openDb(requireEnv("DATABASE_URL", "Set it to the Neon pooled connection string."));
  try {
    const keys = [SHIELDS_SNAPSHOT_KEY, STATS_SNAPSHOT_KEY];
    // Only the gzip bodies cross the network (the smallest stored form).
    const rows = await db.select({ key: snapshots.key, body: snapshots.bodyGzip }).from(snapshots).where(inArray(snapshots.key, keys));
    const dir = path.join(DATA_DIR, "fixtures");
    await mkdir(dir, { recursive: true });
    for (const r of rows) {
      const json = gunzipSync(r.body);
      await writeFile(path.join(dir, `${r.key}.json`), json);
      console.log(`data/fixtures/${r.key}.json: ${Math.round(json.length / 1024)} KB (downloaded ${Math.round(r.body.length / 1024)} KB)`);
    }
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
