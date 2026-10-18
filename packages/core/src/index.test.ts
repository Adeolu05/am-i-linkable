import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bucketId, bucketIndex, DUST_MESSAGE, isDust, planBuckets } from "./index";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("isDust", () => {
  it("treats amounts at or below 0.001 ZEC as dust", () => {
    expect(isDust(100_000n)).toBe(true);
    expect(isDust("20000")).toBe(true);
    expect(isDust(100_001n)).toBe(false);
    expect(DUST_MESSAGE).toMatch(/too small and common to match meaningfully/);
  });
});

describe("bucketIndex / bucketId", () => {
  it("takes the top bits of the hash", () => {
    expect(bucketIndex("f0000000", 4)).toBe(15);
    expect(bucketIndex("80000000", 1)).toBe(1);
    expect(bucketIndex("7fffffff", 1)).toBe(0);
    expect(bucketIndex("abcdef12", 0)).toBe(0);
    expect(bucketIndex("abcdef12", 12)).toBe(0xabc);
    expect(bucketId(5, 7)).toBe("05");
    expect(bucketId(0, 0)).toBe("0");
  });

  it("rejects bad input", () => {
    expect(() => bucketIndex("xyz", 4)).toThrow();
    expect(() => bucketIndex("abcdef12", 25)).toThrow(RangeError);
  });
});

describe("planBuckets", () => {
  const hashes = (n: number) => Array.from({ length: n }, (_, i) => sha256(`addr-${i}`));

  it("uses a single bucket and reports a miss when data is below target", () => {
    const plan = planBuckets(hashes(500), 1000);
    expect(plan).toMatchObject({ bits: 0, bucketCount: 1, minBucketSize: 500, meetsTarget: false });
  });

  it("picks the largest bit length whose smallest bucket meets the target", () => {
    const plan = planBuckets(hashes(20_000), 1000);
    expect(plan.meetsTarget).toBe(true);
    expect(plan.minBucketSize).toBeGreaterThanOrEqual(1000);
    // 20,000 hashes support at most 4 bits (16 buckets of ~1,250); 5 bits would average 625.
    expect(plan.bits).toBe(4);
    expect(plan.totalAddresses).toBe(20_000);
  });

  it("deduplicates hashes", () => {
    const h = hashes(1500);
    expect(planBuckets([...h, ...h], 1000).totalAddresses).toBe(1500);
  });
});

describe("planBucketsFromCounts", () => {
  it("matches planBuckets on the same addresses", async () => {
    const { planBucketsFromCounts } = await import("./index");
    const hashes = Array.from({ length: 20_000 }, (_, i) => sha256(`addr-${i}`));
    const base = 12;
    const counts = new Uint32Array(2 ** base);
    for (const h of hashes) counts[bucketIndex(h, base)]!++;
    expect(planBucketsFromCounts(counts, base, 1000)).toEqual(planBuckets(hashes, 1000));
    expect(planBucketsFromCounts(new Uint32Array(2 ** base), base, 1000)).toMatchObject({ bits: 0, totalAddresses: 0, meetsTarget: false });
  });
});
