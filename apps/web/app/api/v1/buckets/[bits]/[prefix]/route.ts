// GET /api/v1/buckets/[bits]/[prefix]
//
// One address bucket for "Have I been linked?": full SHA-256 hashes (never
// plaintext addresses) of every address whose hash starts with this prefix,
// each with its own events and aggregate linkability numbers. The browser asks
// for the bucket its address hashes into and searches it locally, so the server
// learns only the prefix, shared by the whole bucket (see docs/PRIVACY.md).
//
// Strict: the path must be a bucket id under the CURRENT plan (from the stats
// snapshot). A request for another bit length gets 409 "reload the plan" and no
// data, so stale or probing requests never reach the database.

import type { StatsPayload } from "@ail/core";
import { parseBucketRequest } from "@/lib/bucketRequest";
import { snapshotHandler, type SnapshotHandler } from "@/lib/snapshotRoute";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const stats = snapshotHandler("stats-v1");
const handlers = new Map<string, SnapshotHandler>();

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

const reload = (bits: number | null) => json({ error: "The bucket plan has changed. Reload it from /api/v1/stats and try again.", reload: true, bits }, 409);

export async function GET(request: Request, { params }: { params: Promise<{ bits: string; prefix: string }> }) {
  const { bits, prefix } = await params;
  const req = parseBucketRequest(bits, prefix, new URL(request.url).search);
  if (!req.ok) return json({ error: req.error }, 400);

  let planBits: number | null;
  try {
    planBits = (await stats.json<StatsPayload>()).buckets?.bits ?? null;
  } catch {
    return json({ error: "Data is temporarily unavailable." }, 503);
  }
  if (planBits === null) return json({ error: "Address buckets are not available yet." }, 503);
  if (req.bits !== planBits) return reload(planBits);

  // Bounded: only 2^planBits valid keys can reach this point.
  const key = `bucket-v1-${req.bits}-${req.prefix}`;
  let handler = handlers.get(key);
  if (!handler) handlers.set(key, (handler = snapshotHandler(key, { onMissing: () => reload(planBits) })));
  return handler(new Request(request.url.split("?")[0]!, { headers: request.headers }));
}
