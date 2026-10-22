// The bucket endpoint end to end, in fixture mode (no database).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ail-buckets-"));
writeFileSync(path.join(dir, "stats-v1.json"), JSON.stringify({ v: 2, buckets: { bits: 1, bucketCount: 2 } }));
writeFileSync(path.join(dir, "bucket-v1-1-0.json"), JSON.stringify({ v: 1, bits: 1, bucket: 0, addresses: [["aGFzaA==", []]] }));
// bucket-v1-1-1 deliberately missing
process.env.SNAPSHOT_FIXTURES_DIR = dir;
const { GET } = await import("./route");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const call = (bits: string, prefix: string, query = "", headers: Record<string, string> = {}) =>
  GET(new Request(`http://localhost/api/v1/buckets/${bits}/${prefix}${query}`, { headers }), { params: Promise.resolve({ bits, prefix }) });

describe("GET /api/v1/buckets/[bits]/[prefix]", () => {
  it("serves a bucket of the current plan, compressed, with an ETag and no cookies", async () => {
    const r = await call("1", "0", "", { "accept-encoding": "gzip" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-encoding")).toBe("gzip");
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(r.headers.get("cache-control")).toMatch(/s-maxage=300/);
    expect(JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString())).toMatchObject({ bits: 1, bucket: 0 });
    const again = await call("1", "0", "", { "if-none-match": r.headers.get("etag")! });
    expect(again.status).toBe(304);
  });

  it("rejects malformed paths and parameters with 400", async () => {
    for (const [b, p, q] of [["1", "0", "?x=1"], ["1", "2", ""], ["one", "0", ""], ["1", "00", ""], ["99", "0", ""]] as const) {
      expect((await call(b, p, q)).status, `${b}/${p}${q}`).toBe(400);
    }
  });

  it("tells the client to reload the plan for another bit length, without data", async () => {
    const r = await call("2", "0");
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ reload: true, bits: 1 });
  });

  it("answers a missing bucket of the current plan with the same reload response", async () => {
    const r = await call("1", "1");
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ reload: true });
  });
});
