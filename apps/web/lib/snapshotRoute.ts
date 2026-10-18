// Serves one pre-built snapshot row (written by the collector) as a public,
// identical-for-everyone JSON response: no parameters, no cookies, no
// per-request logging. Browsers revalidate every time (cheap, via ETag/304);
// shared caches may keep a copy for 5 minutes. The database role used here
// (web_readonly) can read the snapshots table and nothing else.
//
// Database egress is kept to a minimum: each server instance asks for the
// snapshot's ETag at most once every 5 minutes (a few bytes), and downloads a
// body only when the ETag changes, in one encoding. Other encodings are made
// locally from that copy.
//
// Local development: set SNAPSHOT_FIXTURES_DIR to a folder holding
// <key>.json files (see `pnpm --filter indexer export-fixtures`) and the
// database is never contacted.

import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, brotliDecompress, constants, gunzip, gzip } from "node:zlib";
import { withReadonlyClient } from "@/lib/db";

const brotliAsync = promisify(brotliCompress);
const unbrotli = promisify(brotliDecompress);
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** How often each server instance asks the database whether a newer snapshot exists. */
const CHECK_MS = 5 * 60_000;
const CACHE_HEADER = "public, max-age=0, s-maxage=300, stale-while-revalidate=600";

type Encoding = "br" | "gzip" | "identity";

interface State {
  etag: string;
  hasBr: boolean;
  checkedAt: number;
  /** Kept until the ETag changes; filled lazily (one download, the rest made locally). */
  bodies: Partial<Record<Encoding, Buffer>>;
  /** In-flight work per encoding, so concurrent requests share one download. */
  pending: Partial<Record<Encoding, Promise<Buffer>>>;
}

function accepts(header: string | null, encoding: string): boolean {
  return (header ?? "").split(",").some((p) => {
    const [name, ...params] = p.trim().split(";");
    return name === encoding && !params.some((x) => x.trim() === "q=0");
  });
}

const errorJson = (text: string, status: number) =>
  new Response(text, { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

/** Local fixture: a saved <key>.json served from disk, compressed in memory once. */
async function fixtureState(dir: string, key: string): Promise<State> {
  const json = await readFile(path.resolve(dir, `${key}.json`));
  const etag = `W/"${createHash("sha256").update(json).digest("base64url").slice(0, 22)}"`;
  const [g, b] = await Promise.all([gzipAsync(json, { level: 9 }), brotliAsync(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })]);
  return { etag, hasBr: true, checkedAt: Number.POSITIVE_INFINITY, bodies: { identity: json, gzip: g, br: b }, pending: {} };
}

export function snapshotHandler(snapshotKey: string): (request: Request) => Promise<Response> {
  const fixturesDir = process.env.SNAPSHOT_FIXTURES_DIR?.trim() || null;
  let state: State | undefined;
  let checking: Promise<State> | undefined;

  const fresh = (etag: string, hasBr: boolean): State => ({ etag, hasBr, checkedAt: Date.now(), bodies: {}, pending: {} });

  /** Tiny query: is there a newer snapshot? Only the ETag crosses the network. */
  function check(): Promise<State> {
    checking ??= withReadonlyClient(async (client) => {
      const r = await client.query<{ etag: string; has_br: boolean }>("select etag, body_br is not null as has_br from snapshots where key = $1", [snapshotKey]);
      const row = r.rows[0];
      if (!row) throw new Error("no snapshot yet");
      state = state && state.etag === row.etag ? { ...state, hasBr: row.has_br, checkedAt: Date.now() } : fresh(row.etag, row.has_br);
      return state;
    }).finally(() => {
      checking = undefined;
    });
    return checking;
  }

  /** Cold start: one query for the ETag and the one body this client needs. */
  function coldLoad(want: "br" | "gzip"): Promise<State> {
    checking ??= withReadonlyClient(async (client) => {
      const r = await client.query<{ etag: string; has_br: boolean; br: Buffer | null; gzip: Buffer | null }>(
        `select etag, body_br is not null as has_br,
                case when $2 then body_br end as br,
                case when not $2 or body_br is null then body_gzip end as gzip
           from snapshots where key = $1`,
        [snapshotKey, want === "br"],
      );
      const row = r.rows[0];
      if (!row) throw new Error("no snapshot yet");
      const s = fresh(row.etag, row.has_br);
      if (row.br) s.bodies.br = row.br;
      if (row.gzip) s.bodies.gzip = row.gzip;
      state = s;
      return s;
    }).finally(() => {
      checking = undefined;
    });
    return checking;
  }

  async function current(want: "br" | "gzip"): Promise<State> {
    if (fixturesDir) return (state ??= await fixtureState(fixturesDir, snapshotKey));
    if (!state) return coldLoad(want);
    // Stale: answer from memory now, look for a newer snapshot in the background.
    if (Date.now() - state.checkedAt >= CHECK_MS) check().catch(() => {});
    return state;
  }

  /** The uncompressed JSON, from whichever body is already in memory. */
  async function rawFromCache(s: State): Promise<Buffer | null> {
    if (s.bodies.identity) return s.bodies.identity;
    if (s.bodies.br) return unbrotli(s.bodies.br);
    if (s.bodies.gzip) return gunzipAsync(s.bodies.gzip);
    return null;
  }

  async function produce(s: State, encoding: Encoding): Promise<Buffer> {
    const raw = await rawFromCache(s);
    if (raw) {
      // Made locally from the copy we already have: no second download.
      if (encoding === "identity") return raw;
      if (encoding === "gzip") return gzipAsync(raw, { level: 9 });
      return brotliAsync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } });
    }
    // Nothing cached for this ETag yet: download exactly one body (brotli if it exists).
    const column = s.hasBr && encoding !== "gzip" ? "body_br" : "body_gzip";
    const body = await withReadonlyClient(async (client) => {
      // Pinned to the ETag we advertise, so headers and body always match.
      const r = await client.query<{ body: Buffer | null }>(`select ${column} as body from snapshots where key = $1 and etag = $2`, [snapshotKey, s.etag]);
      return r.rows[0]?.body ?? null;
    });
    if (!body) throw new Error("snapshot changed while reading");
    s.bodies[column === "body_br" ? "br" : "gzip"] = body;
    return produce(s, encoding);
  }

  function bodyFor(s: State, encoding: Encoding): Promise<Buffer> {
    const have = s.bodies[encoding];
    if (have) return Promise.resolve(have);
    s.pending[encoding] ??= produce(s, encoding)
      .then((b) => (s.bodies[encoding] = b))
      .finally(() => {
        delete s.pending[encoding];
      });
    return s.pending[encoding]!;
  }

  /** Prefer an encoding that is already in memory; otherwise the smallest the client accepts. */
  function choose(s: State, ae: string | null): Encoding {
    const br = accepts(ae, "br");
    const gz = accepts(ae, "gzip");
    if (br && s.bodies.br) return "br";
    if (gz && s.bodies.gzip) return "gzip";
    if (br && s.hasBr) return "br";
    if (gz) return "gzip";
    return "identity";
  }

  return async function GET(request: Request) {
    // Identical for everyone: refuse parameters (they would also bypass caches).
    if (new URL(request.url).search !== "") return errorJson(`{"error":"This endpoint takes no parameters."}`, 400);

    const ae = request.headers.get("accept-encoding");
    let s: State;
    try {
      s = await current(accepts(ae, "br") ? "br" : "gzip");
    } catch {
      return errorJson(`{"error":"Data is temporarily unavailable."}`, 503);
    }

    const common = { "Cache-Control": CACHE_HEADER, Vary: "Accept-Encoding", ETag: s.etag };
    const strip = (t: string) => t.trim().replace(/^W\//, "");
    if (request.headers.get("if-none-match")?.split(",").some((t) => strip(t) === strip(s.etag))) {
      return new Response(null, { status: 304, headers: common });
    }

    let encoding = choose(s, ae);
    let body: Buffer;
    try {
      body = await bodyFor(s, encoding);
    } catch {
      // The snapshot was replaced between the ETag check and the read: re-check once.
      try {
        s = await check();
        encoding = choose(s, ae);
        body = await bodyFor(s, encoding);
      } catch {
        return errorJson(`{"error":"Data is temporarily unavailable."}`, 503);
      }
    }
    const headers: Record<string, string> = {
      ...common,
      ETag: s.etag,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(body.length),
    };
    if (encoding !== "identity") headers["Content-Encoding"] = encoding;
    return new Response(new Uint8Array(body), { status: 200, headers });
  };
}
