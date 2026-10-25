// Saves the site's public snapshots as fixtures, so the web app can run
// locally with no database and no keys (fixture mode).
//
// Every file is a public API response, identical for everyone who asks: the
// stats, the 30-day deposits file and every address bucket (about 4 MB in all,
// downloaded once).
//
// Usage: node apps/web/scripts/save-fixtures.mjs [baseUrl] [outDir]
//   baseUrl defaults to https://am-i-linkable.vercel.app
//   outDir defaults to data/fixtures in the repository (gitignored)

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const base = new URL(process.argv[2] ?? "https://am-i-linkable.vercel.app");
const out = path.resolve(process.argv[3] ?? path.join(import.meta.dirname, "..", "..", "..", "data", "fixtures"));
mkdirSync(out, { recursive: true });

async function save(apiPath, key) {
  const r = await fetch(new URL(apiPath, base));
  if (!r.ok) throw new Error(`${apiPath}: HTTP ${r.status}`);
  const text = await r.text();
  writeFileSync(path.join(out, `${key}.json`), text);
  return text;
}

const stats = JSON.parse(await save("/api/v1/stats", "stats-v1"));
await save("/api/v1/shields", "shields-v1");
const plan = stats.buckets;
if (!plan) throw new Error("the stats payload has no bucket plan yet");
const width = Math.ceil(plan.bits / 4) || 1;
for (let i = 0; i < plan.bucketCount; i++) {
  const id = i.toString(16).padStart(width, "0");
  await save(`/api/v1/buckets/${plan.bits}/${id}`, `bucket-v1-${plan.bits}-${id}`);
}
console.log(`saved stats, deposits and ${plan.bucketCount} buckets to ${out}`);
