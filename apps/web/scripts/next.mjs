// Runs Next.js with telemetry off. `build` builds twice for the CSP:
//
//   1. a first build, read only to collect the SHA-256 of every inline script
//      in the prerendered pages;
//   2. the real build, with those hashes in the Content-Security-Policy header
//      (next.config.ts), then a check that its pages contain no other inline
//      script. If they do, the build fails, so a deploy can never ship a page
//      its own CSP would block.
//
// Both builds share one build id, so their pages are byte-identical.
//
// Usage: node scripts/next.mjs build | dev [args] | start [args]

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const [command = "build", ...rest] = process.argv.slice(2);
const baseEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };

function next(args, env) {
  const r = spawnSync(process.execPath, [nextBin, ...args], { stdio: "inherit", env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** sha256-… of every inline script in the prerendered HTML, by page. */
function inlineScriptHashes(dir) {
  const out = new Map();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    const file = path.join(entry.parentPath, entry.name);
    const html = readFileSync(file, "utf8");
    for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/i.test(attrs)) continue;
      out.set(`sha256-${createHash("sha256").update(body, "utf8").digest("base64")}`, path.relative(dir, file));
    }
  }
  return out;
}

if (command !== "build") {
  next([command, ...rest], baseEnv);
} else {
  const env = { ...baseEnv, AIL_BUILD_ID: randomBytes(9).toString("base64url") };
  const pages = path.join(".next", "server", "app");

  console.log("\n[csp] build 1 of 2: collecting inline script hashes");
  next(["build", ...rest], { ...env, AIL_CSP_PASS: "collect" });
  const first = inlineScriptHashes(pages);
  if (first.size === 0) throw new Error("[csp] no prerendered pages found");

  console.log(`\n[csp] build 2 of 2: serving ${first.size} script hashes in the CSP`);
  next(["build", ...rest], { ...env, AIL_CSP_SCRIPT_HASHES: [...first.keys()].join(" ") });
  const unknown = [...inlineScriptHashes(pages)].filter(([h]) => !first.has(h));
  if (unknown.length > 0) {
    for (const [h, page] of unknown) console.error(`[csp] ${page}: inline script ${h} is not in the CSP`);
    process.exit(1);
  }
  console.log(`[csp] ok: every inline script is allowed by its hash`);
}
