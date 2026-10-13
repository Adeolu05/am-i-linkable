// Spike: pull the most recent N mainnet blocks and extract turnstile events.
//
//   pnpm spike                      # last 1000 blocks
//   pnpm spike -- --blocks 200      # fewer blocks
//   pnpm spike -- --tip 3516000     # end at a fixed height (reproducible)
//
// Raw block events are cached under data/cache/ so an interrupted run resumes
// where it stopped. Output goes to data/spike/.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_MIN_BUCKET_SIZE, planBuckets } from "@ail/core";
import { blockToTxs, ThreeXplClient, type BlockEvents } from "./sources/threexpl";
import { classifyTx, POOLS, type PoolMigrationEvent, type TurnstileEvent, type TxClass } from "./turnstile";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const DATA_DIR = path.join(REPO_ROOT, "data");
const CACHE_DIR = path.join(DATA_DIR, "cache", "3xpl-zcash-main");
const OUT_DIR = path.join(DATA_DIR, "spike");

function loadEnv() {
  for (const file of [path.join(REPO_ROOT, "indexer", ".env"), path.join(REPO_ROOT, ".env")]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Missing .env files are fine; every setting is optional.
    }
  }
}

async function cachedBlock(client: ThreeXplClient, height: number): Promise<{ block: BlockEvents; cached: boolean }> {
  const file = path.join(CACHE_DIR, `${height}.json`);
  try {
    return { block: JSON.parse(await readFile(file, "utf8")) as BlockEvents, cached: true };
  } catch {
    const block = await client.blockEvents(height);
    await writeFile(file, JSON.stringify(block));
    return { block, cached: false };
  }
}

const zec = (zat: bigint) => {
  const sign = zat < 0n ? "-" : "";
  const abs = zat < 0n ? -zat : zat;
  return `${sign}${abs / 100_000_000n}.${(abs % 100_000_000n).toString().padStart(8, "0")}`;
};

/**
 * Unshields whose exact amount was shielded earlier in the window. These are only
 * candidates for a round trip.
 */
function exactAmountCandidates(events: TurnstileEvent[]) {
  const firstShield = new Map<string, number>();
  const shieldCount = new Map<string, number>();
  const unshieldCount = new Map<string, number>();
  for (const e of events) {
    const counts = e.direction === "in" ? shieldCount : unshieldCount;
    counts.set(e.amountZat, (counts.get(e.amountZat) ?? 0) + 1);
    if (e.direction !== "in") continue;
    const prev = firstShield.get(e.amountZat);
    if (prev === undefined || e.blockHeight < prev) firstShield.set(e.amountZat, e.blockHeight);
  }
  const matches = events.filter((e) => {
    if (e.direction !== "out") return false;
    const h = firstShield.get(e.amountZat);
    return h !== undefined && h < e.blockHeight;
  });
  // Strongest kind: the amount appears exactly once in each direction.
  const uniqueAmount = matches.filter((e) => shieldCount.get(e.amountZat) === 1 && unshieldCount.get(e.amountZat) === 1);
  return { candidates: matches.length, uniqueAmountCandidates: uniqueAmount.length };
}

async function main() {
  loadEnv();
  const { values } = parseArgs({
    options: {
      blocks: { type: "string", default: "1000" },
      tip: { type: "string" },
    },
  });
  const count = Number(values.blocks);
  if (!Number.isInteger(count) || count < 1) throw new Error("--blocks must be a positive integer");

  const minInterval = Number(process.env.THREEXPL_MIN_INTERVAL_MS);
  const client = new ThreeXplClient({
    apiKey: process.env.THREEXPL_API_KEY,
    dumpsKey: process.env.THREEXPL_DUMPS_KEY,
    minIntervalMs: Number.isFinite(minInterval) && minInterval > 0 ? minInterval : undefined,
    log: (m) => console.log(`  [3xpl] ${m}`),
  });
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  const tip = values.tip ? Number(values.tip) : await client.tipHeight();
  const from = tip - count + 1;
  console.log(`Source: ${client.base} (${client.keyed ? "API key" : "keyless sandbox"})`);
  console.log(`Scanning blocks ${from}..${tip} (${count} blocks)`);

  const started = Date.now();
  const classCounts: Record<TxClass, number> = {
    turnstile: 0,
    "pool-migration": 0,
    "shielded-internal": 0,
    coinbase: 0,
    "transparent-only": 0,
    unknown: 0,
  };
  const unknown = new Set<string>();
  const events: TurnstileEvent[] = [];
  const migrations: PoolMigrationEvent[] = [];
  let firstTime = "";
  let lastTime = "";
  let fetched = 0;

  for (let h = from; h <= tip; h++) {
    const { block, cached } = await cachedBlock(client, h);
    if (!cached) fetched++;
    for (const tx of blockToTxs(block)) {
      const r = classifyTx(tx);
      classCounts[r.class]++;
      r.unknownAddresses.forEach((a) => unknown.add(a));
      events.push(...r.events);
      if (r.migration) migrations.push(r.migration);
    }
    if (h === from) firstTime = block.time;
    lastTime = block.time;
    const done = h - from + 1;
    if (done % 25 === 0 || h === tip) {
      const secs = Math.round((Date.now() - started) / 1000);
      console.log(`  ${done}/${count} blocks (${fetched} fetched, ${done - fetched} cached, ${secs}s), ${events.length} events`);
    }
  }

  const sumZat = (list: { amountZat: string }[]) => list.reduce((s, e) => s + BigInt(e.amountZat), 0n);
  const perPool = Object.fromEntries(
    POOLS.map((pool) => {
      const pe = events.filter((e) => e.pool === pool);
      const dir = (d: "in" | "out") => pe.filter((e) => e.direction === d);
      return [
        pool,
        {
          shield: dir("in").length,
          unshield: dir("out").length,
          shieldedZec: zec(sumZat(dir("in"))),
          unshieldedZec: zec(sumZat(dir("out"))),
        },
      ];
    }),
  );
  const shield = events.filter((e) => e.direction === "in");
  const unshield = events.filter((e) => e.direction === "out");
  // Matching (v1) uses non-dust turnstile events only; migrations are stored but never matched.
  const matchable = events.filter((e) => !e.isDust);

  const migrationRoutes: Record<string, { count: number; zec: string }> = {};
  const routeTotals = new Map<string, { count: number; zat: bigint }>();
  for (const m of migrations) {
    const key = `${m.from.map((l) => l.pool).join("+")}->${m.to.map((l) => l.pool).join("+")}`;
    const t = routeTotals.get(key) ?? { count: 0, zat: 0n };
    t.count++;
    t.zat += sumZat(m.from);
    routeTotals.set(key, t);
  }
  for (const [k, t] of routeTotals) migrationRoutes[k] = { count: t.count, zec: zec(t.zat) };

  // Only real addresses go into the k-anonymity buckets: users cannot look up a nonstandard script.
  const addresses = new Set(
    events.flatMap((e) =>
      [...e.transparentInputs, ...e.transparentOutputs].filter((l) => l.addressType === "transparent").map((l) => l.address),
    ),
  );
  const bucketPlan = planBuckets(
    [...addresses].map((a) => createHash("sha256").update(a, "utf8").digest("hex")),
    DEFAULT_MIN_BUCKET_SIZE,
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    source: client.base,
    blocks: { from, to: tip, count, firstTime, lastTime },
    requests: client.requestCount,
    transactions: classCounts,
    events: {
      total: events.length,
      shield: shield.length,
      unshield: unshield.length,
      dustShield: shield.filter((e) => e.isDust).length,
      dustUnshield: unshield.filter((e) => e.isDust).length,
      matchable: matchable.length,
    },
    perPool,
    poolMigrations: { total: migrations.length, routes: migrationRoutes },
    distinctTransparentAddresses: addresses.size,
    roundTripCandidates: {
      note: "Round-trip candidates only (exact amount shielded earlier in the window). Dust and migrations excluded.",
      ...exactAmountCandidates(matchable),
      includingDust: exactAmountCandidates(events).candidates,
    },
    bucketPlan,
    unknownPseudoAddresses: [...unknown],
  };
  // What the site will read from the API to show the anonymity set.
  const meta = {
    generatedAt: summary.generatedAt,
    blocks: summary.blocks,
    prefixBits: bucketPlan.bits,
    bucketCount: bucketPlan.bucketCount,
    minBucketSize: bucketPlan.minBucketSize,
    targetMinBucketSize: DEFAULT_MIN_BUCKET_SIZE,
    meetsTarget: bucketPlan.meetsTarget,
    totalAddresses: bucketPlan.totalAddresses,
  };
  const examples = [...shield.filter((e) => !e.isDust).slice(0, 3), ...unshield.filter((e) => !e.isDust).slice(0, 3)];

  await writeFile(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  await writeFile(path.join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2));
  await writeFile(path.join(OUT_DIR, "turnstile-events.json"), JSON.stringify(events, null, 2));
  await writeFile(path.join(OUT_DIR, "pool-migrations.json"), JSON.stringify(migrations, null, 2));

  console.log("\n=== Turnstile spike summary ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("\nExample events (non-dust):");
  for (const e of examples) {
    const t = e.direction === "in" ? e.transparentInputs : e.transparentOutputs;
    console.log(
      `  ${e.time}  #${e.blockHeight}  ${e.direction === "in" ? "shield  " : "unshield"}  ${zec(BigInt(e.amountZat)).padStart(18)} ZEC  ${e.pool.padEnd(8)}  ${e.txid.slice(0, 16)}…  ${t.map((l) => l.address).join(", ")}`,
    );
  }
  console.log(`\nWrote ${path.relative(REPO_ROOT, OUT_DIR)}/{summary,meta,turnstile-events,pool-migrations}.json`);
  console.log(`Elapsed: ${Math.round((Date.now() - started) / 1000)}s`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
