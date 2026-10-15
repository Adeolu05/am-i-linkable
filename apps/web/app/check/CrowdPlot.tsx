"use client";

// "The crowd": deposits near the entered amount over the last 30 days.
// Hand-written SVG. The highlighted band is the matching zone
// [your amount, your amount + typical fee]; the dashed line is your amount.

import { formatZec, type Crowd, type Risk } from "@ail/core";
import { useId } from "react";

const W = 640;
const H = 220;
const PAD = { l: 8, r: 8, t: 14, b: 26 };
const RISK_FILL: Record<Risk, string> = { high: "var(--color-risk-high)", medium: "var(--color-risk-medium)", low: "var(--color-risk-low)" };

export function verdictFor(inBand: number): { title: string; tone: "alone" | "few" | "crowd" } {
  if (inBand <= 2) return { title: inBand === 0 ? "No matching deposits" : "You stand out", tone: "alone" };
  if (inBand < 10) return { title: "A small crowd", tone: "few" };
  return { title: "You blend in", tone: "crowd" };
}

export function CrowdPlot({ crowd, amountZat, risk }: { crowd: Crowd; amountZat: number; risk: Risk }) {
  const titleId = useId();
  const descId = useId();
  const x = (t: number) => PAD.l + ((t - crowd.from) / (crowd.to - crowd.from)) * (W - PAD.l - PAD.r);
  const y = (a: number) => PAD.t + (1 - (a - crowd.lo) / (crowd.hi - crowd.lo)) * (H - PAD.t - PAD.b);
  const bandTop = y(Math.min(crowd.hi, amountZat + 100_000));
  const bandBottom = y(amountZat);
  const fill = RISK_FILL[risk];
  const v = verdictFor(crowd.inBand);
  const summary = `${crowd.inBand} deposit${crowd.inBand === 1 ? "" : "s"} in the last 30 days fall in your matching zone (${formatZec(amountZat)} ZEC up to 0.001 ZEC more), and ${crowd.nearby} more are nearby. ${
    v.tone === "alone" ? "With so few, a withdrawal of this amount stands out." : v.tone === "few" ? "A handful is still a small crowd." : "That is a large crowd to blend into."
  }`;

  return (
    <figure className="glass animate-rise space-y-3 p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-xl font-semibold">The crowd</h3>
        <p className="text-sm font-semibold" style={{ color: fill }}>
          {v.title}
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={`${titleId} ${descId}`}>
        <title id={titleId}>Deposits near {formatZec(amountZat)} ZEC over the last 30 days</title>
        <desc id={descId}>{summary}</desc>
        {/* grid */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + f * (H - PAD.t - PAD.b)} y2={PAD.t + f * (H - PAD.t - PAD.b)} stroke="rgb(255 255 255 / 0.06)" />
        ))}
        {/* matching zone */}
        <rect x={PAD.l} width={W - PAD.l - PAD.r} y={bandTop} height={Math.max(3, bandBottom - bandTop)} fill={fill} opacity={0.16} rx={4} />
        {/* nearby deposits */}
        {crowd.points
          .filter((p) => !p.inBand)
          .map((p, i) => (
            <circle key={`n${i}`} cx={x(p.time)} cy={y(p.amountZat)} r={2.4} fill="rgb(241 244 253 / 0.32)" />
          ))}
        {/* deposits in the matching zone */}
        {crowd.points
          .filter((p) => p.inBand)
          .map((p, i) => (
            <circle key={`b${i}`} cx={x(p.time)} cy={y(p.amountZat)} r={crowd.inBand <= 2 ? 6 : 4} fill={fill} stroke="rgb(7 11 24 / 0.8)" strokeWidth={1.2} />
          ))}
        {/* your amount */}
        <line x1={PAD.l} x2={W - PAD.r} y1={bandBottom} y2={bandBottom} stroke="var(--color-gold)" strokeWidth={1.6} strokeDasharray="6 5" />
        <text x={W - PAD.r - 4} y={bandBottom - 6} textAnchor="end" fill="var(--color-gold)" fontSize={12} fontWeight={600}>
          your amount
        </text>
        {/* time axis */}
        <text x={PAD.l} y={H - 6} fill="var(--color-ink-faint)" fontSize={12}>
          30 days ago
        </text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" fill="var(--color-ink-faint)" fontSize={12}>
          now
        </text>
      </svg>
      <figcaption className="text-sm leading-relaxed text-ink-muted">{summary}</figcaption>
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: fill }} aria-hidden="true" /> matching deposit
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-white/35" aria-hidden="true" /> other nearby deposit
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0 w-4 border-t-2 border-dashed border-gold" aria-hidden="true" /> your amount
        </span>
      </p>
    </figure>
  );
}
