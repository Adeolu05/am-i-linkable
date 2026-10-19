"use client";

// "The crowd": deposits near the entered amount over the last 30 days, in three
// lanes: larger amounts, the matching zone (your amount up to + a typical fee),
// and smaller amounts. Matching deposits are drawn large in the risk colour with
// a time tag; everything else is faded and kept out of the zone. Hand-written SVG,
// sized to its container so text stays readable on phones.

import { formatZec, type Crowd, type Risk } from "@ail/core";
import { useEffect, useId, useRef, useState } from "react";
import { crowdLayout } from "./crowdLayout";

const RISK_FILL: Record<Risk, string> = { high: "var(--color-risk-high)", medium: "var(--color-risk-medium)", low: "var(--color-risk-low)" };

export function verdictFor(inBand: number): { title: string; tone: "alone" | "few" | "crowd" } {
  if (inBand <= 2) return { title: inBand === 0 ? "No matching deposits" : "You stand out", tone: "alone" };
  if (inBand < 10) return { title: "A small crowd", tone: "few" };
  return { title: "You blend in", tone: "crowd" };
}

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(260, Math.round(el.getBoundingClientRect().width)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function CrowdPlot({ crowd, amountZat, risk }: { crowd: Crowd; amountZat: number; risk: Risk }) {
  const titleId = useId();
  const descId = useId();
  const [boxRef, width] = useWidth<HTMLDivElement>(640);
  const L = crowdLayout(crowd, amountZat, width);
  const fill = RISK_FILL[risk];
  const v = verdictFor(crowd.inBand);
  const summary = `${crowd.inBand} deposit${crowd.inBand === 1 ? "" : "s"} in the last 30 days ${crowd.inBand === 1 ? "falls" : "fall"} in your matching zone (${formatZec(amountZat)} ZEC up to 0.001 ZEC more), and ${crowd.nearby} more are nearby but outside it. ${
    v.tone === "alone" ? "With so few, a withdrawal of this amount stands out." : v.tone === "few" ? "A handful is still a small crowd." : "That is a large crowd to blend into."
  }`;
  const [zTop, zBottom] = L.lanes.zone;
  const labelX = 8;
  const small = width < 480;

  return (
    <figure className="glass animate-rise space-y-3 p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-xl font-semibold">The crowd</h3>
        <p className="text-sm font-semibold" style={{ color: fill }}>
          {v.title}: {crowd.inBand} matching
        </p>
      </div>
      <div ref={boxRef} className="w-full">
        <svg viewBox={`0 0 ${L.width} ${L.height}`} width="100%" className="block h-auto" role="img" aria-labelledby={`${titleId} ${descId}`}>
          <title id={titleId}>Deposits near {formatZec(amountZat)} ZEC over the last 30 days</title>
          <desc id={descId}>{summary}</desc>

          {/* Outer lanes: faint backgrounds, clearly separate from the zone */}
          {[L.lanes.above, L.lanes.below].map(([a, b], i) => (
            <rect key={i} x={L.plot.left} y={a} width={L.plot.right - L.plot.left} height={b - a} rx={6} fill="rgb(255 255 255 / 0.025)" />
          ))}

          {/* Matching zone */}
          <rect x={L.plot.left} y={zTop} width={L.plot.right - L.plot.left} height={zBottom - zTop} rx={8} fill={fill} fillOpacity={0.13} stroke={fill} strokeOpacity={0.45} />
          {/* Your amount: the bottom edge of the zone */}
          <line x1={L.plot.left} x2={L.plot.right} y1={zBottom} y2={zBottom} stroke="var(--color-gold)" strokeWidth={2} strokeDasharray="6 5" />

          {/* Nearby, non-matching deposits: faded, in their own lanes */}
          {L.dots
            .filter((d) => d.kind === "near")
            .map((d, i) => (
              <circle key={`n${i}`} cx={d.x} cy={d.y} r={d.r} fill="rgb(241 244 253 / 0.3)" />
            ))}

          {/* Time tags with leader lines (drawn under the dots) */}
          {L.tags.map((t, i) => (
            <g key={`t${i}`}>
              <line x1={t.x} y1={t.y + 4} x2={t.dotX} y2={t.dotY} stroke={fill} strokeOpacity={0.55} strokeWidth={1} />
              <text x={t.x} y={t.y} textAnchor="middle" fill="var(--color-ink)" fontSize={small ? 11 : 12} fontWeight={600}>
                {t.text}
              </text>
            </g>
          ))}

          {/* Matching deposits: large, risk colour */}
          {L.dots
            .filter((d) => d.kind === "match")
            .map((d, i) => (
              <circle key={`m${i}`} cx={d.x} cy={d.y} r={d.r} fill={fill} stroke="rgb(7 11 24 / 0.85)" strokeWidth={1.5} />
            ))}

          {/* Lane labels live in the left gutter, where no dots are drawn */}
          <text x={labelX} y={(L.lanes.above[0] + L.lanes.above[1]) / 2 + 4} fill="var(--color-ink-faint)" fontSize={small ? 11 : 12}>
            Larger
          </text>
          <text x={labelX} y={zTop + 18} fill={fill} fontSize={small ? 11.5 : 13} fontWeight={700}>
            Match
          </text>
          <text x={labelX} y={zTop + 33} fill={fill} fontSize={small ? 11.5 : 13} fontWeight={700}>
            zone
          </text>
          <text x={labelX} y={zBottom - 6} fill="var(--color-gold)" fontSize={small ? 10.5 : 12} fontWeight={600}>
            {small ? "your amt" : "your amount"}
          </text>
          <text x={labelX} y={(L.lanes.below[0] + L.lanes.below[1]) / 2 + 4} fill="var(--color-ink-faint)" fontSize={small ? 11 : 12}>
            Smaller
          </text>

          <text x={L.plot.left} y={L.axisY} fill="var(--color-ink-faint)" fontSize={12}>
            30 days ago
          </text>
          <text x={L.plot.right} y={L.axisY} textAnchor="end" fill="var(--color-ink-faint)" fontSize={12}>
            now
          </text>
        </svg>
      </div>
      <figcaption className="text-sm leading-relaxed text-ink-muted">{summary}</figcaption>
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: fill }} aria-hidden="true" /> matching deposit
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-white/30" aria-hidden="true" /> nearby, not matching
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0 w-4 border-t-2 border-dashed border-gold" aria-hidden="true" /> your amount
        </span>
      </p>
    </figure>
  );
}
