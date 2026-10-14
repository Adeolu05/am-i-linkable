// GET /api/v1/shields
//
// Every non-dust shield (transparent -> shielded) event from the last 30 days,
// in the compact format defined by packages/core (encodeShields). The response
// is the same for everyone: no parameters, no cookies, no per-request logging.
// It is cached in memory and by any CDN for 5 minutes, so the database is
// rarely touched and Neon can scale to zero.

import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { encodeShields, type Pool, type ShieldEvent } from "@ail/core";
import { withReadonlyClient } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WINDOW_DAYS = 30;
const TTL_MS = 300_000;
const CACHE_HEADER = "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";

interface Body {
  json: Buffer;
  gzip: Buffer;
  br: Buffer;
}

let cached: { body: Body; at: number } | undefined;
let inflight: Promise<Body> | undefined;

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

/** Compressed once per refresh (the payload is several MB of mostly txids), not per request. */
async function compress(text: string): Promise<Body> {
  const json = Buffer.from(text, "utf8");
  const [b, g] = await Promise.all([
    // Max quality: runs on the libuv thread pool once per refresh, not on the request path.
    brotli(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: json.length } }),
    gz(json, { level: 9 }),
  ]);
  return { json, gzip: g, br: b };
}

async function load(): Promise<Body> {
  const text = await withReadonlyClient(async (client) => {
    const rows = await client.query<{ t: string; amount_zat: string; pool: Pool; txid: string }>(
      `select extract(epoch from time)::bigint as t, amount_zat, pool, txid
         from turnstile_events
        where direction = 'shield' and not is_dust and time >= now() - make_interval(days => $1)
        order by time`,
      [WINDOW_DAYS],
    );
    const tip = await client.query<{ value: unknown }>(`select value from meta where key = 'tip_height'`);
    const events: ShieldEvent[] = rows.rows.map((r) => ({
      time: Number(r.t) * 1000,
      amountZat: Number(r.amount_zat),
      pool: r.pool,
      txid: r.txid,
    }));
    const tipHeight = typeof tip.rows[0]?.value === "number" ? tip.rows[0].value : null;
    return JSON.stringify(encodeShields(events, { generatedAt: new Date().toISOString(), tipHeight, windowDays: WINDOW_DAYS }));
  });
  return compress(text);
}

async function body(): Promise<Body> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.body;
  // One database round trip at a time, however many requests arrive together.
  inflight ??= load()
    .then((b) => {
      cached = { body: b, at: Date.now() };
      return b;
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}

const json = (text: string, status: number, cache: string) =>
  new Response(text, { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache } });

/** Same bytes for everyone who accepts the same encoding. */
function payload(b: Body, acceptEncoding: string | null): Response {
  const accepts = (enc: string) => (acceptEncoding ?? "").split(",").some((p) => p.trim().split(";")[0] === enc);
  const [data, encoding] = accepts("br") ? [b.br, "br"] : accepts("gzip") ? [b.gzip, "gzip"] : [b.json, undefined];
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": CACHE_HEADER,
    Vary: "Accept-Encoding",
    "Content-Length": String(data.length),
  };
  if (encoding) headers["Content-Encoding"] = encoding;
  return new Response(new Uint8Array(data), { status: 200, headers });
}

export async function GET(request: Request) {
  // Identical for everyone: refuse parameters (they would also bypass caches).
  if (new URL(request.url).search !== "") return json(`{"error":"This endpoint takes no parameters."}`, 400, "no-store");
  try {
    return payload(await body(), request.headers.get("accept-encoding"));
  } catch {
    // Serve the last good copy if there is one; never reveal why the database failed.
    if (cached) return payload(cached.body, request.headers.get("accept-encoding"));
    return json(`{"error":"Data is temporarily unavailable."}`, 503, "no-store");
  }
}
