import { describe, expect, it } from "vitest";
import { computeLinkStats, FEE_BAND_ZAT, type TimedAmount } from "./index";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const H = 3_600_000;
const at = (hoursAgo: number, amountZat: number): TimedAmount => ({ time: NOW - hoursAgo * H, amountZat });

describe("computeLinkStats", () => {
  it("counts matches, stand-outs and crowds, only against earlier deposits", () => {
    const deposits = [
      at(10, 500_015_000), // unique: funds a 5 ZEC withdrawal
      ...Array.from({ length: 12 }, (_, i) => at(20 + i, 100_000_000)), // a crowd at 1 ZEC
      at(1, 300_000_000), // made AFTER the 3 ZEC withdrawal below
    ];
    const withdrawals = [
      at(2, 500_000_000), // stands out (1 earlier match, within the fee band)
      at(3, 100_000_000), // blends in (12)
      at(5, 300_000_000), // its only "match" is later: not matched
      at(4, 777_000_000), // no match at all
      at(30, 100_000_000 - FEE_BAND_ZAT - 1), // outside the band; also older than 24 h
    ];
    const s = computeLinkStats(deposits, withdrawals, NOW);
    // 24 h: the unique deposit, the newest five of the crowd (20–24 h ago) and the late one.
    expect(s.last24h).toEqual({ deposits: 7, withdrawals: 4, matched: 2, standOut: 1, blendedIn: 1 });
    expect(s.last30d).toEqual({ deposits: 14, withdrawals: 5, matched: 2, standOut: 1, blendedIn: 1 });
  });

  it("handles empty input", () => {
    const zero = { deposits: 0, withdrawals: 0, matched: 0, standOut: 0, blendedIn: 0 };
    expect(computeLinkStats([], [], NOW)).toEqual({ last24h: zero, last30d: zero });
  });
});
