// Database egress guard for the snapshot endpoints: counts every query and every
// body the route pulls from the (mocked) database.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  etag: 'W/"v1"',
  json: Buffer.from(JSON.stringify({ v: 1, rows: Array.from({ length: 50 }, (_, i) => [i, i * 1000, 3, "abcdef012345"]) })),
  queries: [] as string[],
  bodyDownloads: 0,
};
const row = () => ({ gzip: gzipSync(db.json), br: brotliCompressSync(db.json) });

vi.mock("@/lib/db", () => ({
  withReadonlyClient: async <T>(fn: (c: unknown) => Promise<T>) =>
    fn({
      query: async (sql: string, params: unknown[]) => {
        db.queries.push(sql.replace(/\s+/g, " ").trim());
        const r = row();
        if (sql.includes("case when")) {
          db.bodyDownloads++;
          const wantBr = params[1] === true;
          return { rows: [{ etag: db.etag, has_br: true, br: wantBr ? r.br : null, gzip: wantBr ? null : r.gzip }] };
        }
        if (sql.includes("as body")) {
          db.bodyDownloads++;
          if (params[1] !== db.etag) return { rows: [] };
          return { rows: [{ body: sql.includes("body_br") ? r.br : r.gzip }] };
        }
        return { rows: [{ etag: db.etag, has_br: true }] };
      },
    }),
}));

const { snapshotHandler } = await import("./snapshotRoute");

const req = (headers: Record<string, string> = {}, query = "") => new Request(`http://localhost/api/v1/shields${query}`, { headers });
let now = 1_800_000_000_000;

beforeEach(() => {
  db.etag = 'W/"v1"';
  db.queries = [];
  db.bodyDownloads = 0;
  now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  delete process.env.SNAPSHOT_FIXTURES_DIR;
});
afterEach(() => vi.restoreAllMocks());

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("snapshot endpoint egress", () => {
  it("downloads one body on a cold start and serves every encoding from it", async () => {
    const GET = snapshotHandler("shields-v1");
    const br = await GET(req({ "accept-encoding": "br, gzip" }));
    expect(br.headers.get("content-encoding")).toBe("br");
    expect(JSON.parse(brotliDecompressSync(Buffer.from(await br.arrayBuffer())).toString())).toEqual(JSON.parse(db.json.toString()));
    const gz = await GET(req({ "accept-encoding": "gzip" }));
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    expect(gunzipSync(Buffer.from(await gz.arrayBuffer())).equals(db.json)).toBe(true);
    const plain = await GET(req());
    expect(Buffer.from(await plain.arrayBuffer()).equals(db.json)).toBe(true);
    expect(db.queries).toHaveLength(1);
    expect(db.bodyDownloads).toBe(1);
  });

  it("shares one download between concurrent first requests", async () => {
    const GET = snapshotHandler("shields-v1");
    await Promise.all(Array.from({ length: 5 }, () => GET(req({ "accept-encoding": "br" }))));
    expect(db.bodyDownloads).toBe(1);
  });

  it("answers a matching If-None-Match with 304 and no body", async () => {
    const GET = snapshotHandler("shields-v1");
    await GET(req({ "accept-encoding": "br" }));
    const r = await GET(req({ "if-none-match": 'W/"v1"' }));
    expect(r.status).toBe(304);
    expect(db.bodyDownloads).toBe(1);
  });

  it("checks the ETag at most every 5 minutes and re-downloads only when it changed", async () => {
    const GET = snapshotHandler("shields-v1");
    await GET(req({ "accept-encoding": "br" }));
    now += 4 * 60_000;
    await GET(req({ "accept-encoding": "br" }));
    await settle();
    expect(db.queries).toHaveLength(1); // no check yet

    now += 2 * 60_000; // 6 minutes: one cheap ETag check, unchanged
    await GET(req({ "accept-encoding": "br" }));
    await settle();
    expect(db.queries).toHaveLength(2);
    expect(db.queries[1]).toMatch(/^select etag, body_br is not null as has_br from snapshots/);
    await GET(req({ "accept-encoding": "br" }));
    expect(db.bodyDownloads).toBe(1);

    db.etag = 'W/"v2"';
    now += 6 * 60_000; // check sees a new ETag; the next request downloads once
    await GET(req({ "accept-encoding": "br" }));
    await settle();
    const r = await GET(req({ "accept-encoding": "br" }));
    expect(r.headers.get("etag")).toBe('W/"v2"');
    await GET(req({ "accept-encoding": "gzip" }));
    expect(db.bodyDownloads).toBe(2);
  });

  it("refuses query parameters", async () => {
    const GET = snapshotHandler("shields-v1");
    expect((await GET(req({}, "?x=1"))).status).toBe(400);
    expect(db.queries).toHaveLength(0);
  });

  it("never touches the database in fixture mode", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ail-fixtures-"));
    try {
      writeFileSync(path.join(dir, "stats-v1.json"), '{"v":1}');
      process.env.SNAPSHOT_FIXTURES_DIR = dir;
      const GET = snapshotHandler("stats-v1");
      const r = await GET(req({ "accept-encoding": "gzip" }));
      expect(gunzipSync(Buffer.from(await r.arrayBuffer())).toString()).toBe('{"v":1}');
      expect(db.queries).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
