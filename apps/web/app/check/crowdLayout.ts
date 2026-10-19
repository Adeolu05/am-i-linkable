// Geometry for "The crowd" chart, kept pure so it can be tested.
//
// Three lanes, top to bottom: deposits a bit LARGER than the matching zone, the
// MATCHING ZONE itself (your amount up to your amount + typical fee), and
// deposits a bit SMALLER than your amount. The zone gets a tall lane of its own,
// so nearby-but-not-matching deposits can never sit on top of it. Outside the
// zone, distance is shown on a log scale: close misses sit near the zone edge,
// far ones further out, but always inside their own lane.

import { FEE_BAND_ZAT, type Crowd } from "@ail/core";

export interface Dot {
  x: number;
  y: number;
  r: number;
  kind: "match" | "near";
}

export interface Tag {
  /** Label anchor (centre) and the dot it points to. */
  x: number;
  y: number;
  dotX: number;
  dotY: number;
  text: string;
}

export interface CrowdLayout {
  width: number;
  height: number;
  gutter: number;
  plot: { left: number; right: number };
  lanes: { above: [number, number]; zone: [number, number]; below: [number, number] };
  axisY: number;
  dots: Dot[];
  tags: Tag[];
}

/** At most this many matches get a time tag; more than that is a crowd, and the table lists them. */
export const MAX_TAGS = 6;
const TAG_W = 66;
const TAG_ROWS = 2;

export function shortAge(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function crowdLayout(crowd: Crowd, amountZat: number, width: number, now = crowd.to): CrowdLayout {
  const narrow = width < 480;
  const gutter = narrow ? 70 : 100;
  const left = gutter;
  const right = width - 10;
  const laneH = narrow ? 50 : 58;
  const gap = 16;
  const tagRowH = 16;
  const zoneH = 112;
  const above: [number, number] = [6, 6 + laneH];
  const zone: [number, number] = [above[1] + gap, above[1] + gap + zoneH];
  const below: [number, number] = [zone[1] + gap, zone[1] + gap + laneH];
  const axisY = below[1] + 18;
  const height = axisY + 6;

  const x = (t: number) => left + Math.min(1, Math.max(0, (t - crowd.from) / (crowd.to - crowd.from))) * (right - left);
  const top = amountZat + FEE_BAND_ZAT;
  const maxAbove = Math.max(1, crowd.hi - top);
  const maxBelow = Math.max(1, amountZat - crowd.lo);
  const logPos = (d: number, max: number) => Math.log1p(d / FEE_BAND_ZAT) / Math.log1p(max / FEE_BAND_ZAT);
  // Matching dots live inside the zone, below the tag rows when there are tags;
  // a crowd (no tags) gets the whole zone.
  const tagged = crowd.inBand > 0 && crowd.inBand <= MAX_TAGS;
  const matchTop = tagged ? zone[0] + TAG_ROWS * tagRowH + 14 : zone[0] + 10;
  const matchBottom = zone[1] - 10;

  const many = crowd.inBand > 30;
  const dots: Dot[] = crowd.points.map((p) => {
    if (p.inBand) {
      const f = (p.amountZat - amountZat) / FEE_BAND_ZAT; // 0 = exactly your amount
      return { x: x(p.time), y: matchBottom - f * (matchBottom - matchTop), r: many ? 3.6 : crowd.inBand <= 2 ? 7 : 5.5, kind: "match" };
    }
    if (p.amountZat > top) {
      const f = logPos(p.amountZat - top, maxAbove);
      return { x: x(p.time), y: above[1] - 3 - f * (laneH - 6), r: 2.2, kind: "near" };
    }
    const f = logPos(amountZat - p.amountZat, maxBelow);
    return { x: x(p.time), y: below[0] + 3 + f * (laneH - 6), r: 2.2, kind: "near" };
  });

  // Time tags for a handful of matches, in rows at the top of the zone, never overlapping.
  const tags: Tag[] = [];
  const matches = dots.map((d, i) => ({ d, p: crowd.points[i]! })).filter(({ d }) => d.kind === "match");
  if (tagged) {
    const lastRight = Array<number>(TAG_ROWS).fill(-Infinity);
    for (const { d, p } of matches.sort((a, b) => a.d.x - b.d.x)) {
      const cx = Math.min(right - TAG_W / 2, Math.max(left + TAG_W / 2, d.x));
      const row = lastRight.findIndex((r) => cx - TAG_W / 2 >= r + 4);
      if (row < 0) continue; // no room: the matches table still lists it
      lastRight[row] = cx + TAG_W / 2;
      tags.push({ x: cx, y: zone[0] + 14 + row * tagRowH, dotX: d.x, dotY: d.y, text: shortAge(now - p.time) });
    }
  }

  return { width, height, gutter, plot: { left, right }, lanes: { above, zone, below }, axisY, dots, tags };
}
