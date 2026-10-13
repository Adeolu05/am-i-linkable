import { describe, expect, it } from "vitest";
import { ThreeXplClient, usableKey } from "./threexpl";

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
