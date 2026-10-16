// Serves one pre-built snapshot row (written by the collector) as a public,
// identical-for-everyone JSON response: no parameters, no cookies, no
// per-request logging. Browsers revalidate every time (cheap, via ETag/304);
// shared caches may keep a copy for 5 minutes. The database role used here
// (web_readonly) can read the snapshots table and nothing else.

import "server-only";
import { gunzipSync } from "node:zlib";
import { withReadonlyClient } from "@/lib/db";

export function snapshotHandler(snapshotKey: string): (request: Request) => Promise<Response> {
  /** How often this server asks the database whether a newer snapshot exists. */
  const CHECK_MS = 60_000;
  const CACHE_HEADER = "public, max-age=0, s-maxage=300, stale-while-revalidate=600";

  type Encoding = "br" | "gzip" | "identity";

  interface State {
    etag: string;
    hasBr: boolean;
    checkedAt: number;
    /** Bodies are fetched lazily, one encoding at a time, and kept until the ETag changes. */
    bodies: Partial<Record<Encoding, Buffer>>;
  }

  let state: State | undefined;
  let checking: Promise<State> | undefined;

  /** Tiny query: is there a newer snapshot? Only the ETag crosses the network. */
  function check(): Promise<State> {
    checking ??= withReadonlyClient(async (client) => {
      const r = await client.query<{ etag: string; has_br: boolean }>(
        "select etag, body_br is not null as has_br from snapshots where key = $1",
        [snapshotKey],
      );
      const row = r.rows[0];
      if (!row) throw new Error("no snapshot yet");
      const next: State =
        state && state.etag === row.etag
          ? { ...state, hasBr: row.has_br, checkedAt: Date.now() }
          : { etag: row.etag, hasBr: row.has_br, checkedAt: Date.now(), bodies: {} };
      state = next;
      return next;
    }).finally(() => {
      checking = undefined;
    });
    return checking;
  }

  /**
   * Cold start: one connection, one query for the ETag and the body this client
   * needs (falling back to gzip when no brotli body exists). Saves a round trip
   * and a TLS handshake for the first visitor after a restart.
   */
  function coldLoad(encoding: Encoding): Promise<State> {
    checking ??= withReadonlyClient(async (client) => {
      const r = await client.query<{ etag: string; has_br: boolean; br: Buffer | null; gzip: Buffer | null }>(
        `select etag, body_br is not null as has_br,
                case when $2 then body_br end as br,
                case when not $2 or body_br is null then body_gzip end as gzip
           from snapshots where key = $1`,
        [snapshotKey, encoding === "br"],
      );
      const row = r.rows[0];
      if (!row) throw new Error("no snapshot yet");
      const bodies: State["bodies"] = {};
      if (row.br) bodies.br = row.br;
      if (row.gzip) bodies.gzip = row.gzip;
      state = { etag: row.etag, hasBr: row.has_br, checkedAt: Date.now(), bodies };
      return state;
    }).finally(() => {
      checking = undefined;
    });
    return checking;
  }

  async function current(encoding: Encoding): Promise<State> {
    if (!state) return coldLoad(encoding);
    // Stale: answer from memory now, look for a newer snapshot in the background.
    if (Date.now() - state.checkedAt >= CHECK_MS) check().catch(() => {});
    return state;
  }

  async function bodyFor(s: State, encoding: Encoding): Promise<Buffer> {
    const have = s.bodies[encoding];
    if (have) return have;
    if (encoding === "identity") {
      // Rare (every browser accepts gzip): decompress our own copy rather than store a third body.
      const raw = gunzipSync(await bodyFor(s, "gzip"));
      s.bodies.identity = raw;
      return raw;
    }
    const column = encoding === "br" ? "body_br" : "body_gzip";
    const body = await withReadonlyClient(async (client) => {
      // Pinned to the ETag we advertise, so headers and body always match.
      const r = await client.query<{ body: Buffer | null }>(`select ${column} as body from snapshots where key = $1 and etag = $2`, [
        snapshotKey,
        s.etag,
      ]);
      return r.rows[0]?.body ?? null;
    });
    if (!body) throw new Error("snapshot changed while reading");
    s.bodies[encoding] = body;
    return body;
  }

  const errorJson = (text: string, status: number) =>
    new Response(text, { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

  function accepts(header: string | null, encoding: string): boolean {
    return (header ?? "").split(",").some((p) => {
      const [name, ...params] = p.trim().split(";");
      return name === encoding && !params.some((x) => x.trim() === "q=0");
    });
  }

  async function GET(request: Request) {
    // Identical for everyone: refuse parameters (they would also bypass caches).
    if (new URL(request.url).search !== "") return errorJson(`{"error":"This endpoint takes no parameters."}`, 400);

    const ae = request.headers.get("accept-encoding");
    // What the client accepts; brotli is used only if the snapshot has a brotli body.
    const wanted: Encoding = accepts(ae, "br") ? "br" : accepts(ae, "gzip") ? "gzip" : "identity";

    let s: State;
    try {
      s = await current(wanted);
    } catch {
      return errorJson(`{"error":"Data is temporarily unavailable."}`, 503);
    }

    const common = { "Cache-Control": CACHE_HEADER, Vary: "Accept-Encoding", ETag: s.etag };
    const strip = (t: string) => t.trim().replace(/^W\//, "");
    if (request.headers.get("if-none-match")?.split(",").some((t) => strip(t) === strip(s.etag))) {
      return new Response(null, { status: 304, headers: common });
    }

    let encoding: Encoding = wanted === "br" && !s.hasBr ? (accepts(ae, "gzip") ? "gzip" : "identity") : wanted;
    let body: Buffer;
    try {
      body = await bodyFor(s, encoding);
    } catch {
      // The snapshot was replaced between the ETag check and the read: re-check once.
      try {
        s = await check();
        if (encoding === "br" && !s.hasBr) encoding = "gzip";
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
  }

  return GET;
}
