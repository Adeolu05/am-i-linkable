import { FEE_BAND_ZAT, type Crowd, type CrowdPoint } from "@ail/core";
import { describe, expect, it } from "vitest";
import { LABEL_W, MAX_TAGS, TAG_W, asciiCrowd, crowdSummary, fitCols, tinyAge } from "./asciiCrowd";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 21);
const AMOUNT = 14_774_714_597; // 147.74714597 ZEC

function crowd(points: CrowdPoint[]): Crowd {
  const span = Math.max(AMOUNT * 0.05, 3 * FEE_BAND_ZAT);
  return {
    lo: AMOUNT - span,
    hi: AMOUNT + FEE_BAND_ZAT + span,
    from: NOW - 30 * DAY,
    to: NOW,
    inBand: points.filter((p) => p.inBand).length,
    nearby: points.filter((p) => !p.inBand).length,
    points,
  };
}

const match = (ageMs: number, extraZat = 0): CrowdPoint => ({ time: NOW - ageMs, amountZat: AMOUNT + extraZat, inBand: true });
const near = (ageMs: number, deltaZat: number): CrowdPoint => ({ time: NOW - ageMs, amountZat: AMOUNT + deltaZat, inBand: false });

const text = (row: { text: string }[]) => row.map((s) => s.text).join("");
const count = (rows: { text: string; kind: string }[][], kind: string) =>
  rows.flat().filter((s) => s.kind === kind).reduce((n, s) => n + s.text.length, 0);

// Rows: 0-2 larger, 3-5 zone, 6 your amount, 7-9 smaller, 10 axis.
const ZONE = [3, 4, 5];

describe("asciiCrowd", () => {
  it("draws an empty zone, the your-amount row and no tags when nothing matches", () => {
    const a = asciiCrowd(crowd([near(2 * DAY, 2_000_000), near(9 * DAY, -3_000_000)]), AMOUNT, 40);
    expect(count(a.rows, "match")).toBe(0);
    expect(count(a.rows, "near")).toBe(2);
    expect(a.tagged).toBe(0);
    expect(text(a.rows[6]!)).toContain("─".repeat(40));
  });

  it("keeps one match at the right edge visible at the minimum width", () => {
    const a = asciiCrowd(crowd([match(14 * 3_600_000, 15_000)]), AMOUNT, 18);
    expect(a.cols).toBe(18);
    expect(count(a.rows, "match")).toBe(1);
    // the match is the last plot column, drawn over the zone's right edge
    const row = a.rows.find((r) => r.some((s) => s.kind === "match"))!;
    expect(text(row).slice(LABEL_W).indexOf("●")).toBe(17);
    expect(text(row)).toContain("14h");
  });

  it("tags at most three matches, newest rows first", () => {
    const points = Array.from({ length: 12 }, (_, i) => match((i + 1) * DAY, (i % 3) * 40_000));
    const a = asciiCrowd(crowd(points), AMOUNT, 64);
    expect(a.tagged).toBeLessThanOrEqual(MAX_TAGS);
    expect(a.tagged).toBe(3);
    expect(count(a.rows, "match")).toBeGreaterThan(0);
  });

  it("puts matches only in zone rows and nearby deposits never in them", () => {
    const points = [match(DAY, 0), match(2 * DAY, FEE_BAND_ZAT), near(3 * DAY, FEE_BAND_ZAT + 1), near(4 * DAY, -1)];
    const a = asciiCrowd(crowd(points), AMOUNT, 32);
    a.rows.forEach((row, r) => {
      const kinds = new Set(row.map((s) => s.kind));
      if (kinds.has("match")) expect(ZONE).toContain(r);
      if (kinds.has("near")) expect(ZONE).not.toContain(r);
    });
    // exactly your amount sits on the bottom zone row; your amount + the fee band on the top one
    expect(a.rows[5]!.some((s) => s.kind === "match")).toBe(true);
    expect(a.rows[3]!.some((s) => s.kind === "match")).toBe(true);
  });

  it("keeps every row the same width at 18 and 64 columns", () => {
    for (const cols of [18, 64]) {
      const a = asciiCrowd(crowd([match(DAY), near(5 * DAY, 500_000), near(20 * DAY, -500_000)]), AMOUNT, cols);
      for (const row of a.rows) expect(text(row).length).toBe(LABEL_W + cols + TAG_W);
    }
  });

  it("clamps the column count to its limits", () => {
    expect(asciiCrowd(crowd([]), AMOUNT, 5).cols).toBe(18);
    expect(asciiCrowd(crowd([]), AMOUNT, 500).cols).toBe(64);
    expect(fitCols(40)).toBe(40 - LABEL_W - TAG_W);
    expect(fitCols(10)).toBe(18);
  });
});

describe("tinyAge", () => {
  it("formats minutes, hours and days", () => {
    expect(tinyAge(30_000)).toBe("1m");
    expect(tinyAge(35 * 60_000)).toBe("35m");
    expect(tinyAge(14 * 3_600_000)).toBe("14h");
    expect(tinyAge(3 * DAY)).toBe("3d");
  });
});

describe("crowdSummary", () => {
  it("reads one match as standing out", () => {
    const s = crowdSummary(crowd([match(DAY), near(DAY, 900_000)]), "147.74714597");
    expect(s).toContain("1 deposit in the last 30 days falls in your matching zone");
    expect(s).toContain("1 more is nearby");
    expect(s).toContain("stands out");
  });
  it("reads ten or more as a crowd", () => {
    const s = crowdSummary(crowd(Array.from({ length: 10 }, (_, i) => match((i + 1) * DAY))), "1.0");
    expect(s).toContain("10 deposits in the last 30 days fall");
    expect(s).toContain("large crowd");
  });
});
