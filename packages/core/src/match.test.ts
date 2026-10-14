import { describe, expect, it } from "vitest";
import {
  checkWithdrawal,
  COMMON_SET_SIZE,
  decimals,
  decodeShields,
  DUST_MESSAGE,
  encodeShields,
  FEE_BAND_ZAT,
  formatZec,
  parseZecToZat,
  riskFor,
  ShieldIndex,
  type ShieldEvent,
} from "./index";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ZEC = 100_000_000;

let seq = 0;
function shield(amountZat: number, ageMs: number, pool: ShieldEvent["pool"] = "ironwood"): ShieldEvent {
  seq++;
  return { time: NOW - ageMs, amountZat, pool, txidPrefix: seq.toString(16).padStart(12, "0") };
}

/** Background noise: deposits far from the amounts under test. */
const noise = Array.from({ length: 50 }, (_, i) => shield(7 * ZEC + i * 3_333_337, (i + 1) * DAY / 3));

const result = (zat: bigint | number, events: ShieldEvent[]) => {
  const r = checkWithdrawal(BigInt(zat), NOW, events);
  if (r.kind !== "result") throw new Error(`expected a result, got ${r.kind}`);
  return r;
};

describe("parseZecToZat", () => {
  it("converts exactly, without floating point", () => {
    expect(parseZecToZat("1")).toEqual({ ok: true, zat: 100_000_000n });
    expect(parseZecToZat("0.1")).toEqual({ ok: true, zat: 10_000_000n });
    expect(parseZecToZat("0.3")).toEqual({ ok: true, zat: 30_000_000n }); // 0.1 + 0.2 trap
    expect(parseZecToZat("0.00000001")).toEqual({ ok: true, zat: 1n });
    expect(parseZecToZat("1.23456789")).toEqual({ ok: true, zat: 123_456_789n });
    expect(parseZecToZat(".5")).toEqual({ ok: true, zat: 50_000_000n });
    expect(parseZecToZat("2.")).toEqual({ ok: true, zat: 200_000_000n });
    expect(parseZecToZat(" 1,000.5 ")).toEqual({ ok: true, zat: 100_050_000_000n });
    expect(parseZecToZat("21000000")).toEqual({ ok: true, zat: 2_100_000_000_000_000n });
  });

  it("rejects bad input with a readable error", () => {
    for (const bad of ["", " ", ".", "abc", "1.2.3", "-1", "1e5", "1,00", "0x10", "1.123456789", "0", "0.00000000", "21000000.00000001"]) {
      const r = parseZecToZat(bad);
      expect(r.ok, bad).toBe(false);
    }
    expect(parseZecToZat("1.123456789")).toMatchObject({ error: expect.stringMatching(/8 decimal places/) });
  });

  it("round-trips through formatZec", () => {
    expect(formatZec(123_456_789n)).toBe("1.23456789");
    expect(formatZec(100_000_000)).toBe("1.0");
    expect(formatZec(985_000)).toBe("0.00985");
    expect(formatZec(100_050_000_000n)).toBe("1,000.5");
  });
});

describe("riskFor", () => {
  it("follows the documented table", () => {
    expect(riskFor(0, null)).toBe("low");
    expect(riskFor(1, HOUR)).toBe("high");
    expect(riskFor(2, 6 * DAY)).toBe("high");
    expect(riskFor(1, 8 * DAY)).toBe("medium");
    expect(riskFor(5, DAY)).toBe("medium");
    expect(riskFor(5, 8 * DAY)).toBe("low");
    expect(riskFor(COMMON_SET_SIZE, HOUR)).toBe("low");
  });
});

describe("checkWithdrawal", () => {
  it("unique exact match from a few hours ago is high", () => {
    const target = 2 * ZEC + 34_567_891;
    const r = result(target, [...noise, shield(target, 3 * HOUR, "sapling")]);
    expect(r.risk).toBe("high");
    expect(r.exactCount).toBe(1);
    expect(r.anonymitySet).toBe(1);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({ kind: "exact", pool: "sapling", differenceZat: 0 });
    expect(r.reasons.join(" ")).toMatch(/may be linkable/);
    expect(r.reasons.join(" ")).not.toMatch(/is linked/);
    expect(r.reasons.join(" ")).toMatch(/3 hours ago/);
  });

  it("a common amount is low", () => {
    const common = 99_985_000;
    const crowd = Array.from({ length: 40 }, (_, i) => shield(common, (i + 1) * HOUR));
    const r = result(common, [...noise, ...crowd]);
    expect(r.risk).toBe("low");
    expect(r.anonymitySet).toBe(40);
    expect(r.suggestions).toEqual({});
  });

  it("an old unique match is lower than a fresh one", () => {
    const target = 3 * ZEC + 1_234_567;
    const fresh = result(target, [...noise, shield(target, 2 * HOUR)]);
    const old = result(target, [...noise, shield(target, 20 * DAY)]);
    expect(fresh.risk).toBe("high");
    expect(old.risk).toBe("medium");
    expect(old.reasons.join(" ")).toMatch(/20 days ago/);
  });

  it("flags a near match inside the fee band, but not one outside it", () => {
    const deposit = 5 * ZEC + 777_777;
    const inBand = result(deposit - 15_000, [...noise, shield(deposit, 5 * HOUR)]);
    expect(inBand.risk).toBe("high");
    expect(inBand.matches[0]).toMatchObject({ kind: "near", differenceZat: 15_000 });
    expect(inBand.reasons.join(" ")).toMatch(/within a typical fee/);

    const outside = result(deposit - FEE_BAND_ZAT - 1, [...noise, shield(deposit, 5 * HOUR)]);
    expect(outside.anonymitySet).toBe(0);
    expect(outside.risk).toBe("low");

    // A deposit smaller than the withdrawal cannot have funded it.
    const smaller = result(deposit + 1, [...noise, shield(deposit, 5 * HOUR)]);
    expect(smaller.anonymitySet).toBe(0);
  });

  it("returns the dust message at or below 0.001 ZEC", () => {
    expect(checkWithdrawal(100_000n, NOW, noise)).toEqual({ kind: "dust", message: DUST_MESSAGE });
    expect(checkWithdrawal(1n, NOW, noise)).toEqual({ kind: "dust", message: DUST_MESSAGE });
    expect(checkWithdrawal(100_001n, NOW, noise).kind).toBe("result");
  });

  it("handles empty data honestly", () => {
    expect(checkWithdrawal(5n * BigInt(ZEC), NOW, [])).toMatchObject({ kind: "no-data" });
  });

  it("no match at all is low", () => {
    const r = result(123_456_789_012, noise);
    expect(r).toMatchObject({ risk: "low", anonymitySet: 0, matches: [] });
  });

  it("suggests waiting only when it lowers the risk, and shows the projection", () => {
    const target = 4 * ZEC + 4_444_444;
    const r = result(target, [...noise, shield(target, DAY)]);
    expect(r.suggestions.wait?.find((s) => s.afterDays === 7)?.risk).toBe("medium");
    expect(r.suggestions.wait?.[0]).toEqual({ afterDays: 1, risk: "high" });
  });

  it("suggests nearby common amounts below the plan", () => {
    const common = 2 * ZEC - 15_000; // 1.99985
    const crowd = Array.from({ length: 25 }, (_, i) => shield(common, (i + 2) * HOUR));
    const target = 2 * ZEC + 12_345_678; // unique, recent
    const r = result(target, [...noise, ...crowd, shield(target, HOUR)]);
    expect(r.risk).toBe("high");
    const amounts = r.suggestions.commonAmounts?.map((c) => c.amountZat) ?? [];
    // One suggestion covers the crowd: an amount at most one fee band below it (a rounder one is preferred).
    expect(amounts.some((a) => a <= common && common - a <= FEE_BAND_ZAT)).toBe(true);
    for (const c of r.suggestions.commonAmounts ?? []) {
      expect(c.amountZat).toBeLessThanOrEqual(target);
      expect(c.anonymitySet).toBeGreaterThanOrEqual(COMMON_SET_SIZE);
    }
  });

  it("offers distinct, round suggestions rather than near-duplicates", () => {
    // A crowd of slightly different deposits around 0.9996 ZEC.
    const crowd = Array.from({ length: 60 }, (_, i) => shield(99_960_000 + (i % 7) * 1_111, (i + 2) * HOUR));
    const target = 1 * ZEC + 53_804_745; // 1.53804745, unique and recent
    const r = result(target, [...noise, ...crowd, shield(target, HOUR)]);
    const picks = r.suggestions.commonAmounts ?? [];
    expect(picks.length).toBeGreaterThan(0);
    for (let i = 0; i < picks.length; i++)
      for (let j = i + 1; j < picks.length; j++) expect(Math.abs(picks[i]!.amountZat - picks[j]!.amountZat)).toBeGreaterThan(FEE_BAND_ZAT);
    // The roundest amount in the crowd's range is preferred over 0.99961111-style values.
    expect(decimals(picks[0]!.amountZat)).toBeLessThanOrEqual(4);
  });

  it("offers a split only when no single common amount is close", () => {
    const a = 3 * ZEC; // crowd of 30
    const b = 2 * ZEC; // crowd of 30
    const crowds = [...Array.from({ length: 30 }, (_, i) => shield(a, (i + 2) * HOUR)), ...Array.from({ length: 30 }, (_, i) => shield(b, (i + 3) * HOUR))];
    const target = 5 * ZEC; // unique deposit of exactly 5 ZEC an hour ago
    const r = result(target, [...noise, ...crowds, shield(target, HOUR)]);
    expect(r.risk).toBe("high");
    expect(r.suggestions.split?.map((s) => s.amountZat).sort()).toEqual([b, a].sort());

    // If a common amount within 5% exists, no split is offered.
    const near = Array.from({ length: 20 }, (_, i) => shield(target - 10 * 1_000_000, (i + 2) * HOUR)); // 4.9 ZEC
    const r2 = result(target, [...noise, ...crowds, ...near, shield(target, HOUR)]);
    expect(r2.suggestions.split).toBeUndefined();
  });

  it("ignores deposits in the future relative to now", () => {
    const target = 6 * ZEC + 1;
    const r = result(target, [...noise, { ...shield(target, 0), time: NOW + HOUR }]);
    expect(r.anonymitySet).toBe(0);
  });
});

describe("ShieldIndex and the wire format", () => {
  it("counts amounts in a range", () => {
    const idx = new ShieldIndex([shield(10, 1), shield(10, 2), shield(20, 3), shield(30, 4)]);
    expect(idx.countBetween(10, 20)).toBe(3);
    expect(idx.countBetween(11, 29)).toBe(1);
    expect(idx.distinctAmountsBetween(0, 100)).toEqual([10, 20, 30]);
  });

  it("encodes compactly, sends only a 12-character txid prefix, and decodes back", () => {
    const full = "ab".repeat(32);
    const events = [shield(985_000, 2 * HOUR, "sapling"), shield(99_975_000, HOUR, "ironwood")].map(({ txidPrefix: _, ...e }) => ({ ...e, txid: full }));
    const payload = encodeShields(events, { generatedAt: "2026-10-14T12:00:00.000Z", tipHeight: 3_517_499, windowDays: 30 });
    expect(payload.rows[0]).toEqual([0, 985_000, 1, "abababababab"]);
    expect(JSON.stringify(payload)).not.toContain(full);
    const back = decodeShields(JSON.parse(JSON.stringify(payload)));
    expect(back[0]!.txidPrefix).toBe("abababababab");
    expect(back.map((e) => [Math.floor(e.time / 1000), e.amountZat, e.pool])).toEqual(
      events.map((e) => [Math.floor(e.time / 1000), e.amountZat, e.pool]),
    );
  });
});
