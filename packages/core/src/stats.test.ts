import { describe, expect, it } from "vitest";
import { computeLinkStats, FAIR_LOOKBACK_DAYS, FEE_BAND_ZAT, HEADLINE_LOOKBACK_DAYS, type TimedAmount } from "./index";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const H = 3_600_000;
const DAY = 24 * H;
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
    expect(s.last24h).toEqual({ deposits: 7, withdrawals: 4, matched: 2, standOut: 1, blendedIn: 1, lookbackDays: HEADLINE_LOOKBACK_DAYS });
    expect(s.deposits30d).toBe(14);
  });

  it("gives every last-24h withdrawal its full 29-day lookback", () => {
    // A deposit 29.5 days before a withdrawal made 23 hours ago: inside its 29-day lookback? No (29.5 > 29).
    // One 28 days before it: yes. Both are inside the 30-day data window.
    const w = at(23, 200_000_000);
    const s = computeLinkStats([{ time: w.time - 28 * DAY, amountZat: 200_000_000 }, { time: w.time - 29.5 * DAY, amountZat: 200_000_000 }], [w], NOW);
    expect(s.last24h).toMatchObject({ withdrawals: 1, matched: 1, standOut: 1 });
    // Every withdrawal of the last 24 h is counted: none lacks history.
    const many = Array.from({ length: 24 }, (_, i) => at(i + 0.5, 1_000_000_000));
    expect(computeLinkStats([], many, NOW).last24h.withdrawals).toBe(24);
  });

  it("removes the bias against withdrawals early in the window (fixed lookback)", () => {
    // A steady stream: a 1 ZEC deposit and a 1 ZEC withdrawal every 6 hours for 30 days.
    // Every withdrawal really has a crowd of ~28 deposits in the 7 days before it.
    const deposits: TimedAmount[] = [];
    const withdrawals: TimedAmount[] = [];
    for (let h = 1; h < 30 * 24; h += 6) {
      deposits.push(at(h + 3, 100_000_000));
      withdrawals.push(at(h, 100_000_000));
    }
    const s = computeLinkStats(deposits, withdrawals, NOW);

    // The old method (compare with whatever history exists) would flag the oldest ones:
    const naiveStandOut = withdrawals.filter((w) => {
      const crowd = deposits.filter((d) => d.time < w.time && d.amountZat === w.amountZat).length;
      return crowd > 0 && crowd <= 2;
    }).length;
    expect(naiveStandOut).toBeGreaterThan(0);

    // The fair view compares each counted withdrawal with exactly the 7 days before it,
    // and counts only withdrawals with those 7 full days in the data: none stands out.
    expect(s.fair.lookbackDays).toBe(FAIR_LOOKBACK_DAYS);
    expect(s.fair.periodDays).toBe(23);
    expect(s.fair.standOut).toBe(0);
    expect(s.fair.blendedIn).toBe(s.fair.withdrawals);
    // Only withdrawals from the last 23 days are counted (4 a day).
    expect(s.fair.withdrawals).toBeGreaterThanOrEqual(23 * 4 - 1);
    expect(s.fair.withdrawals).toBeLessThanOrEqual(23 * 4 + 1);
    expect(withdrawals.length).toBe(120);
  });

  it("does not count deposits older than the 7-day lookback in the fair view", () => {
    // Deposits only 10 days before the withdrawal: a full-history method would match them.
    const w = at(48, 300_000_000);
    const s = computeLinkStats([{ time: w.time - 10 * DAY, amountZat: 300_000_000 }], [w], NOW);
    expect(s.fair).toMatchObject({ withdrawals: 1, matched: 0, standOut: 0 });
  });

  it("handles empty input", () => {
    const s = computeLinkStats([], [], NOW);
    expect(s.last24h).toMatchObject({ deposits: 0, withdrawals: 0, matched: 0, standOut: 0, blendedIn: 0 });
    expect(s.fair).toMatchObject({ withdrawals: 0, standOut: 0, periodDays: 23 });
    expect(s.deposits30d).toBe(0);
  });
});
