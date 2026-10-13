// Spike: pull the most recent N mainnet blocks and extract turnstile events.
//
//   pnpm spike                      # last 1000 blocks
//   pnpm spike -- --blocks 200      # fewer blocks
//   pnpm spike -- --tip 3516000     # end at a fixed height (reproducible)
//
// Raw block events are cached under data/cache/ so an interrupted run resumes
// where it stopped. Output goes to data/spike/.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { blockToTxs, ThreeXplClient, type BlockEvents } from "./sources/threexpl";
import { classifyTx, POOLS, type TurnstileEvent, type TxClass } from "./turnstile";

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
    coinbase: 0,
    "shielded-only": 0,
    "transparent-only": 0,
    unknown: 0,
  };
  const unknown = new Set<string>();
  const events: TurnstileEvent[] = [];
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
    }
    if (h === from) firstTime = block.time;
    lastTime = block.time;
    const done = h - from + 1;
    if (done % 25 === 0 || h === tip) {
      const secs = Math.round((Date.now() - started) / 1000);
      console.log(`  ${done}/${count} blocks (${fetched} fetched, ${done - fetched} cached, ${secs}s), ${events.length} events`);
    }
  }

  const perPool = Object.fromEntries(
    POOLS.map((pool) => {
      const pe = events.filter((e) => e.pool === pool);
      const sum = (d: "in" | "out") =>
        pe.filter((e) => e.direction === d).reduce((s, e) => s + BigInt(e.amountZat), 0n);
      return [
        pool,
        {
          shield: pe.filter((e) => e.direction === "in").length,
          unshield: pe.filter((e) => e.direction === "out").length,
          shieldedZec: zec(sum("in")),
          unshieldedZec: zec(sum("out")),
        },
      ];
    }),
  );
  const shield = events.filter((e) => e.direction === "in");
  const unshield = events.filter((e) => e.direction === "out");

  // Teaser for the matching work: unshields whose exact amount was shielded
  // earlier in the same window. Exact-amount round trips are the easiest links.
  const shieldedAmounts = new Map<string, number>();
  for (const e of shield) {
    const prev = shieldedAmounts.get(e.amountZat);
    if (prev === undefined || e.blockHeight < prev) shieldedAmounts.set(e.amountZat, e.blockHeight);
  }
  const exactRoundTrips = unshield.filter((e) => {
    const h = shieldedAmounts.get(e.amountZat);
    return h !== undefined && h < e.blockHeight;
  }).length;

  const addresses = new Set(events.flatMap((e) => [...e.transparentInputs, ...e.transparentOutputs].map((l) => l.address)));

  const summary = {
    generatedAt: new Date().toISOString(),
    source: client.base,
    blocks: { from, to: tip, count, firstTime, lastTime },
    requests: client.requestCount,
    transactions: classCounts,
    events: { total: events.length, shield: shield.length, unshield: unshield.length },
    perPool,
    distinctTransparentAddresses: addresses.size,
    exactAmountRoundTripCandidates: exactRoundTrips,
    unknownPseudoAddresses: [...unknown],
  };
  const examples = [...shield.slice(0, 3), ...unshield.slice(0, 3)];

  await writeFile(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  await writeFile(path.join(OUT_DIR, "turnstile-events.json"), JSON.stringify(events, null, 2));

  console.log("\n=== Turnstile spike summary ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("\nExample events:");
  for (const e of examples) {
    const t = e.direction === "in" ? e.transparentInputs : e.transparentOutputs;
    console.log(
      `  ${e.time}  #${e.blockHeight}  ${e.direction === "in" ? "shield  " : "unshield"}  ${zec(BigInt(e.amountZat)).padStart(18)} ZEC  ${e.pool.padEnd(8)}  ${e.txid.slice(0, 16)}…  ${t.map((l) => l.address).join(", ")}`,
    );
  }
  console.log(`\nWrote ${path.relative(REPO_ROOT, OUT_DIR)}/summary.json and turnstile-events.json`);
  console.log(`Elapsed: ${Math.round((Date.now() - started) / 1000)}s`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
