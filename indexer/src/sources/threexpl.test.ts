import { describe, expect, it } from "vitest";
import { KEYED_MIN_INTERVAL_MS, minIntervalFromEnv, quotaNearlyExhausted, ThreeXplClient, usableKey } from "./threexpl";

describe("quotaNearlyExhausted", () => {
  it("does not pause when the header is absent (keyed API)", () => {
    expect(quotaNearlyExhausted(null)).toBe(false);
    expect(quotaNearlyExhausted("")).toBe(false);
  });
  it("pauses only when the sandbox reports 1 or fewer remaining", () => {
    expect(quotaNearlyExhausted("29")).toBe(false);
    expect(quotaNearlyExhausted("1")).toBe(true);
    expect(quotaNearlyExhausted("0")).toBe(true);
    expect(quotaNearlyExhausted("garbage")).toBe(false);
  });
});

describe("usableKey", () => {
  it("treats empty and placeholder values as unset", () => {
    expect(usableKey(undefined)).toBeUndefined();
    expect(usableKey("")).toBeUndefined();
    expect(usableKey("   ")).toBeUndefined();
    expect(usableKey("your-3xpl-api-key")).toBeUndefined();
    expect(usableKey("YOUR-key")).toBeUndefined();
    expect(usableKey("  real-token-value ")).toBe("real-token-value");
  });
});

describe("ThreeXplClient key handling", () => {
  it("falls back to the keyless sandbox for placeholder keys and logs without values", () => {
    const logs: string[] = [];
    const c = new ThreeXplClient({ apiKey: "your-3xpl-api-key", dumpsKey: "your-3xpl-dumps-key", log: (m) => logs.push(m) });
    expect(c.keyed).toBe(false);
    expect(c.base).toBe("https://sandbox-api.3xpl.com");
    expect(logs.join("\n")).toMatch(/API key not set/);
    expect(logs.join("\n")).toMatch(/dumps key not set/);
    expect(logs.join("\n")).not.toMatch(/your-3xpl/);
  });

  it("uses the keyed API without ever logging the key", () => {
    const logs: string[] = [];
    const fake = "test-value-1";
    const c = new ThreeXplClient({ apiKey: fake, dumpsKey: fake, log: (m) => logs.push(m) });
    expect(c.keyed).toBe(true);
    expect(c.base).toBe("https://api.3xpl.com");
    expect(logs).toEqual([]);
  });

  it("refuses dump downloads without a usable dumps key", async () => {
    const c = new ThreeXplClient({ dumpsKey: "your-3xpl-dumps-key" });
    await expect(
      c.downloadDump({
        date: "2026-10-12",
        blocks: 1,
        events: 1,
        uncompressed_size: 1,
        compressed_size: 1,
        compression_algo: "zstd",
        link: "https://dumps.3xpl.com/zcash/zcash-main/example.tsv.zst",
        checksum: "0".repeat(64),
        checksum_algo: "sha256sum",
      }),
    ).rejects.toThrow(/dumps key not set/);
  });
});

describe("ThreeXplClient dumps-key message", () => {
  it("stays quiet about dumps for callers that never use them", () => {
    const logs: string[] = [];
    new ThreeXplClient({ apiKey: "test-value-1", log: (m) => logs.push(m) });
    expect(logs).toEqual([]);
  });
});

describe("request spacing", () => {
  it("parses THREEXPL_MIN_INTERVAL_MS, falling back to the default when empty or invalid", () => {
    expect(minIntervalFromEnv(undefined)).toBeUndefined();
    expect(minIntervalFromEnv("")).toBeUndefined();
    expect(minIntervalFromEnv("abc")).toBeUndefined();
    expect(minIntervalFromEnv("-5")).toBeUndefined();
    expect(minIntervalFromEnv("1500")).toBe(1500);
    expect(new ThreeXplClient({ apiKey: "test-value-1" })["minIntervalMs"]).toBe(KEYED_MIN_INTERVAL_MS);
    expect(KEYED_MIN_INTERVAL_MS).toBe(1500);
  });

  it("leaves at least the minimum gap between consecutive requests", async () => {
    const calls: number[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls.push(Date.now());
      return new Response(JSON.stringify({ data: { blocks: { "100": { hash: "h", time: "2026-10-14T00:00:00Z" } } } }), {
        status: 200,
      });
    }) as typeof fetch;
    try {
      const c = new ThreeXplClient({ apiKey: "test-value-1", minIntervalMs: 120 });
      for (let i = 0; i < 4; i++) await c.tipHeight();
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toHaveLength(4);
    for (let i = 1; i < calls.length; i++) expect(calls[i]! - calls[i - 1]!).toBeGreaterThanOrEqual(115);
  });
});
