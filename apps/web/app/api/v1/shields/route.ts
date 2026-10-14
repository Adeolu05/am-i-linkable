// GET /api/v1/shields
//
// Every non-dust shield (transparent -> shielded) event from the last 30 days,
// in the compact format defined by packages/core (encodeShields). The response
// is the same for everyone: no parameters, no cookies, no per-request logging.
// It is cached in memory and by any CDN for 5 minutes, so the database is
// rarely touched and Neon can scale to zero.

import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { encodeShields, type Pool, type ShieldEvent } from "@ail/core";
import { withReadonlyClient } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WINDOW_DAYS = 30;
const TTL_MS = 300_000;
// Browsers revalidate every time (max-age=0; the page also fetches with cache: "no-cache"), so a
// visitor never checks against stale deposits. Shared caches (CDNs) keep a copy for 5 minutes.
const CACHE_HEADER = "public, max-age=0, s-maxage=300, stale-while-revalidate=600";

interface Body {
  etag: string;
  json: Buffer;
  gzip: Buffer;
  /** Filled in by a background job: max-quality brotli is ~12% smaller but takes ~10 s for this payload. */
  br?: Buffer;
}

let cached: { body: Body; at: number } | undefined;
let inflight: Promise<Body> | undefined;

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

/** Compressed once per refresh (the payload is several MB of mostly txids), never per request. */
async function compress(text: string): Promise<Body> {
  const json = Buffer.from(text, "utf8");
  // Weak: the same tag covers the raw, gzip and brotli representations.
  const etag = `W/"${createHash("sha256").update(json).digest("base64url").slice(0, 22)}"`;
  const body: Body = { etag, json, gzip: await gz(json, { level: 9 }) };
  // Runs on the libuv thread pool; requests use gzip until it is ready.
  brotli(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: json.length } })
    .then((b) => {
      body.br = b;
    })
    .catch(() => {});
  return body;
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

function refresh(): Promise<Body> {
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

async function body(): Promise<Body> {
  if (!cached) return refresh();
  // Stale copy: serve it now and refresh in the background (stale-while-revalidate).
  if (Date.now() - cached.at >= TTL_MS) refresh().catch(() => {});
  return cached.body;
}

const json = (text: string, status: number, cache: string) =>
  new Response(text, { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache } });

/** Same bytes for everyone who accepts the same encoding. */
function payload(b: Body, request: Request): Response {
  // Unchanged since the browser's copy: a tiny 304 instead of megabytes.
  if (request.headers.get("if-none-match")?.split(",").some((t) => t.trim().replace(/^W\//, "") === b.etag.replace(/^W\//, ""))) {
    return new Response(null, { status: 304, headers: { ETag: b.etag, "Cache-Control": CACHE_HEADER, Vary: "Accept-Encoding" } });
  }
  const acceptEncoding = request.headers.get("accept-encoding");
  const accepts = (enc: string) => (acceptEncoding ?? "").split(",").some((p) => p.trim().split(";")[0] === enc);
  const [data, encoding] = b.br && accepts("br") ? [b.br, "br"] : accepts("gzip") ? [b.gzip, "gzip"] : [b.json, undefined];
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": CACHE_HEADER,
    Vary: "Accept-Encoding",
    "Content-Length": String(data.length),
    ETag: b.etag,
  };
  if (encoding) headers["Content-Encoding"] = encoding;
  return new Response(new Uint8Array(data), { status: 200, headers });
}

export async function GET(request: Request) {
  // Identical for everyone: refuse parameters (they would also bypass caches).
  if (new URL(request.url).search !== "") return json(`{"error":"This endpoint takes no parameters."}`, 400, "no-store");
  try {
    return payload(await body(), request);
  } catch {
    // Serve the last good copy if there is one; never reveal why the database failed.
    if (cached) return payload(cached.body, request);
    return json(`{"error":"Data is temporarily unavailable."}`, 503, "no-store");
  }
}
