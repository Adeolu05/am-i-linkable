import { describe, expect, it } from "vitest";
import { checkWithdrawal, crowdAround, FEE_BAND_ZAT, pickCommonExample, pickRiskyExample, ShieldIndex, type ShieldEvent } from "./index";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const H = 3_600_000;
let n = 0;
const ev = (amountZat: number, hoursAgo: number): ShieldEvent => ({ time: NOW - hoursAgo * H, amountZat, pool: "ironwood", txidPrefix: String(++n).padStart(12, "0") });

const crowd = Array.from({ length: 30 }, (_, i) => ev(99_985_000, 2 + i * 5));
const unique = ev(512_345_678, 3);
const index = new ShieldIndex([...crowd, unique, ev(700_000_000, 24 * 20)]);

describe("examples", () => {
  it("picks a risky example that really is high risk", () => {
    const p = pickRiskyExample(index, NOW, () => 0)!;
    expect(p).toBe(512_345_678 - 15_000);
    const r = checkWithdrawal(BigInt(p), NOW, index);
    expect(r.kind === "result" && r.risk).toBe("high");
  });

  it("picks a common example that really is low risk", () => {
    const p = pickCommonExample(index, NOW, () => 0)!;
    expect(p).toBe(99_985_000);
    const r = checkWithdrawal(BigInt(p), NOW, index);
    expect(r.kind === "result" && r.risk).toBe("low");
  });

  it("returns null when nothing qualifies", () => {
    const empty = new ShieldIndex([]);
    expect(pickRiskyExample(empty, NOW)).toBeNull();
    expect(pickCommonExample(empty, NOW)).toBeNull();
  });
});

describe("crowdAround", () => {
  it("splits deposits into the matching zone and nearby ones", () => {
    const c = crowdAround(index, 99_985_000, NOW);
    expect(c.inBand).toBe(30);
    expect(c.lo).toBeLessThan(99_985_000);
    expect(c.hi).toBeGreaterThan(99_985_000 + FEE_BAND_ZAT);
    expect(c.points.filter((p) => p.inBand)).toHaveLength(30);
  });

  it("samples nearby points but keeps every in-band one", () => {
    const many = new ShieldIndex([...Array.from({ length: 2000 }, (_, i) => ev(200_000_000 + (i % 400) * 10_000, 1 + (i % 600))), ev(200_000_000, 1)]);
    const c = crowdAround(many, 200_000_000, NOW, 100);
    expect(c.points.filter((p) => !p.inBand).length).toBeLessThanOrEqual(100);
    expect(c.points.filter((p) => p.inBand)).toHaveLength(c.inBand);
  });
});
