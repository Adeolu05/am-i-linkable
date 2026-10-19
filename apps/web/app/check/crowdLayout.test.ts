import { crowdAround, FEE_BAND_ZAT, ShieldIndex, type ShieldEvent } from "@ail/core";
import { describe, expect, it } from "vitest";
import { crowdLayout, MAX_TAGS, shortAge } from "./crowdLayout";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const H = 3_600_000;
let n = 0;
const ev = (amountZat: number, hoursAgo: number): ShieldEvent => ({ time: NOW - hoursAgo * H, amountZat, pool: "ironwood", txidPrefix: String(++n).padStart(12, "0") });
const P = 300_000_000; // 3 ZEC

// 220 nearby deposits hugging the amount (within 0.03 ZEC either side), outside the zone.
const nearby = Array.from({ length: 220 }, (_, i) => ev(P + (i % 2 ? 1 : -1) * (FEE_BAND_ZAT + 1_000 + (i % 110) * 25_000), 1 + (i % 700)));

describe("crowdLayout", () => {
  for (const width of [340, 640]) {
    it(`keeps nearby deposits out of the zone and matching ones inside it (width ${width})`, () => {
      const idx = new ShieldIndex([...nearby, ev(P + 15_000, 0.6), ev(P, 30)]);
      const L = crowdLayout(crowdAround(idx, P, NOW), P, width);
      const [zt, zb] = L.lanes.zone;
      const matches = L.dots.filter((d) => d.kind === "match");
      const near = L.dots.filter((d) => d.kind === "near");
      expect(matches).toHaveLength(2);
      expect(near.length).toBeGreaterThan(100);
      for (const d of matches) expect(d.y - d.r >= zt && d.y + d.r <= zb).toBe(true);
      // Visibly separated: every nearby dot is outside the zone with room to spare.
      for (const d of near) expect(d.y + d.r < zt - 4 || d.y - d.r > zb + 4).toBe(true);
      // Nothing is drawn in the label gutter, so "your amount" is never covered.
      for (const d of L.dots) expect(d.x - d.r).toBeGreaterThanOrEqual(L.gutter - 1);
      // Matching dots are drawn larger than nearby ones.
      expect(Math.min(...matches.map((d) => d.r))).toBeGreaterThan(Math.max(...near.map((d) => d.r)));
    });
  }

  it("tags each of a few matches with its age, without overlapping tags", () => {
    // Two matches a minute apart (stacked in two tag rows) and one 12.5 days earlier.
    const idx = new ShieldIndex([...nearby, ev(P + 15_000, 0.6), ev(P + 20_000, 0.62), ev(P, 300)]);
    const L = crowdLayout(crowdAround(idx, P, NOW), P, 640);
    expect(L.tags.map((t) => t.text).sort()).toEqual(["13 days ago", "36 min ago", "37 min ago"].sort());
    for (let i = 0; i < L.tags.length; i++)
      for (let j = i + 1; j < L.tags.length; j++) {
        const a = L.tags[i]!;
        const b = L.tags[j]!;
        expect(a.y !== b.y || Math.abs(a.x - b.x) >= 66).toBe(true);
      }
    for (const t of L.tags) expect(t.x - 33).toBeGreaterThanOrEqual(L.gutter);
  });

  it("fills the zone with many dots for a common amount, and skips tags", () => {
    const crowd = Array.from({ length: 120 }, (_, i) => ev(P + (i % 5) * 10_000, 1 + i * 5));
    const L = crowdLayout(crowdAround(new ShieldIndex([...nearby, ...crowd]), P, NOW), P, 640);
    expect(L.dots.filter((d) => d.kind === "match")).toHaveLength(120);
    expect(L.tags.length).toBe(0);
    expect(120).toBeGreaterThan(MAX_TAGS);
  });

  it("formats short ages", () => {
    expect(shortAge(36 * 60_000)).toBe("36 min ago");
    expect(shortAge(5 * H)).toBe("5 h ago");
    expect(shortAge(72 * H)).toBe("3 days ago");
  });
});

describe("crowdLayout zone use", () => {
  it("spreads a crowd over the whole zone when there are no tags", () => {
    const crowd = Array.from({ length: 60 }, (_, i) => ev(P + (i % 10) * 10_000, 1 + i * 7));
    const L = crowdLayout(crowdAround(new ShieldIndex(crowd), P, NOW), P, 640);
    const ys = L.dots.filter((d) => d.kind === "match").map((d) => d.y);
    const [zt, zb] = L.lanes.zone;
    // The highest dots reach the upper third of the zone.
    expect(Math.min(...ys)).toBeLessThan(zt + (zb - zt) / 3);
  });
});
