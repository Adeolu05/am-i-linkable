// "The crowd" as text, kept pure so it can be tested.
//
// Columns are time (30 days ago on the left, now on the right). Rows are amount
// lanes, top to bottom: three lanes for deposits a bit LARGER than the matching
// zone, three rows for the MATCHING ZONE (your amount up to your amount + a
// typical fee), a row for YOUR AMOUNT, then three lanes for deposits a bit
// SMALLER. Nearby deposits never land in the zone rows; matches always do.
// Outside the zone, distance is on a log scale, as in the old SVG plot.

import { FEE_BAND_ZAT, type Crowd } from "@ail/core";

export type CellKind = "blank" | "near" | "match" | "you" | "edge" | "label" | "tag" | "axis";

export interface Seg {
  text: string;
  kind: CellKind;
}

export interface AsciiCrowd {
  /** Rows of runs; each row is LABEL_W + cols + TAG_W characters wide. */
  rows: Seg[][];
  cols: number;
  /** How many matches got an age tag (at most MAX_TAGS). */
  tagged: number;
}

export const MIN_COLS = 18;
export const MAX_COLS = 64;
export const MAX_TAGS = 3;
/** Characters before the plot ("larger  ") and after it (" 14h"). */
export const LABEL_W = 8;
export const TAG_W = 5;

const LANE_ROWS = 3;
const ZONE_ROWS = 3;
const CHAR: Record<CellKind, string> = { blank: " ", near: "·", match: "●", you: "─", edge: "│", label: "", tag: "", axis: "" };

/** "35m", "14h", "3d". */
export function tinyAge(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Plot columns that fit `chars` characters of width, leaving room for the label and tag. */
export function fitCols(chars: number): number {
  return Math.max(MIN_COLS, Math.min(MAX_COLS, Math.floor(chars) - LABEL_W - TAG_W));
}

export function asciiCrowd(crowd: Crowd, amountZat: number, cols: number, now = crowd.to): AsciiCrowd {
  const W = Math.max(MIN_COLS, Math.min(MAX_COLS, Math.floor(cols)));
  // Row indexes
  const zone0 = LANE_ROWS;
  const youRow = zone0 + ZONE_ROWS;
  const below0 = youRow + 1;
  const nRows = below0 + LANE_ROWS;

  const grid: CellKind[][] = Array.from({ length: nRows }, (_, r) =>
    Array.from({ length: W }, (_, c) => (r === youRow ? "you" : r >= zone0 && r < youRow && (c === 0 || c === W - 1) ? "edge" : "blank")),
  );

  const span = Math.max(1, crowd.to - crowd.from);
  const col = (t: number) => Math.round(Math.min(1, Math.max(0, (t - crowd.from) / span)) * (W - 1));
  const top = amountZat + FEE_BAND_ZAT;
  const maxAbove = Math.max(1, crowd.hi - top);
  const maxBelow = Math.max(1, amountZat - crowd.lo);
  const logPos = (d: number, max: number) => Math.min(1, Math.log1p(d / FEE_BAND_ZAT) / Math.log1p(max / FEE_BAND_ZAT));
  const band = (f: number) => Math.min(LANE_ROWS - 1, Math.floor(f * LANE_ROWS));

  // Nearby first, so a match drawn later always wins its cell.
  for (const p of crowd.points) {
    if (p.inBand) continue;
    const c = col(p.time);
    const r = p.amountZat > top ? LANE_ROWS - 1 - band(logPos(p.amountZat - top, maxAbove)) : below0 + band(logPos(amountZat - p.amountZat, maxBelow));
    if (grid[r]![c] === "blank") grid[r]![c] = "near";
  }

  const matches = crowd.points.filter((p) => p.inBand).sort((a, b) => b.time - a.time); // newest first
  const rowOf = new Map<number, number>(); // newest match per row, for tags
  for (const p of matches) {
    const f = Math.min(1, Math.max(0, (p.amountZat - amountZat) / FEE_BAND_ZAT)); // 0 = exactly your amount
    const r = zone0 + (ZONE_ROWS - 1 - Math.min(ZONE_ROWS - 1, Math.floor(f * ZONE_ROWS)));
    grid[r]![col(p.time)] = "match";
    if (!rowOf.has(r)) rowOf.set(r, p.time);
  }

  // Age tags: the newest match of each zone row, newest rows first, at most MAX_TAGS.
  const tags = new Map<number, string>();
  for (const [r, t] of [...rowOf.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_TAGS)) tags.set(r, tinyAge(now - t));

  const label = (r: number) =>
    r === 0 ? "larger" : r === zone0 ? "match" : r === zone0 + 1 ? "zone" : r === youRow ? "you" : r === below0 + LANE_ROWS - 1 ? "smaller" : "";

  const rows: Seg[][] = grid.map((cells, r) => {
    const segs: Seg[] = [{ text: label(r).padEnd(LABEL_W), kind: "label" }];
    for (const k of cells) {
      const last = segs[segs.length - 1]!;
      if (last.kind === k) last.text += CHAR[k];
      else segs.push({ text: CHAR[k], kind: k });
    }
    const tag = tags.get(r);
    segs.push({ text: tag ? ` ${tag}`.padEnd(TAG_W) : " ".repeat(TAG_W), kind: tag ? "tag" : "blank" });
    return segs;
  });

  const left = "30d ago";
  const right = "now";
  rows.push([{ text: " ".repeat(LABEL_W) + left + " ".repeat(Math.max(1, W - left.length - right.length)) + right + " ".repeat(TAG_W), kind: "axis" }]);

  return { rows, cols: W, tagged: tags.size };
}

/** The plain-language reading of the crowd, used as the plot's visible caption. */
export function crowdSummary(crowd: Crowd, amountText: string): string {
  const n = crowd.inBand;
  const tone = n <= 2 ? "With so few, a withdrawal of this amount stands out." : n < 10 ? "A handful is still a small crowd." : "That is a large crowd to blend into.";
  return `${n} deposit${n === 1 ? "" : "s"} in the last 30 days ${n === 1 ? "falls" : "fall"} in your matching zone (${amountText} ZEC up to 0.001 ZEC more), and ${crowd.nearby} more ${crowd.nearby === 1 ? "is" : "are"} nearby but outside it. ${tone}`;
}
