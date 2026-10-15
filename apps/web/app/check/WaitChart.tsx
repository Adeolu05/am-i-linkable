"use client";

// Risk now vs after 1, 3 and 7 days, from the same rule as the main result (riskFor).

import { riskFor, type Risk } from "@ail/core";
import { RiskIcon } from "@/components/icons";

const DAY = 86_400_000;
const LEVEL: Record<Risk, number> = { high: 3, medium: 2, low: 1 };
const COLOR: Record<Risk, string> = { high: "bg-risk-high", medium: "bg-risk-medium", low: "bg-risk-low" };
const TEXT: Record<Risk, string> = { high: "text-risk-high", medium: "text-risk-medium", low: "text-risk-low" };

export function WaitChart({ anonymitySet, newestAgeMs }: { anonymitySet: number; newestAgeMs: number | null }) {
  const steps = [0, 1, 3, 7].map((d) => ({
    label: d === 0 ? "Now" : `+${d} day${d === 1 ? "" : "s"}`,
    risk: riskFor(anonymitySet, newestAgeMs === null ? null : newestAgeMs + d * DAY),
  }));
  return (
    <section className="glass animate-rise p-5 sm:p-6" aria-labelledby="wait-title">
      <h3 id="wait-title" className="font-display text-xl font-semibold">
        If you wait
      </h3>
      <p className="mt-1 text-sm text-ink-muted">Risk now and after waiting, for the same amount.</p>
      <ol className="mt-4 grid grid-cols-4 items-end gap-2 sm:gap-3">
        {steps.map((s) => (
          <li key={s.label} className="flex flex-col items-center gap-2">
            <div className="flex h-24 w-full items-end rounded-lg bg-white/5">
              <div className={`w-full rounded-lg ${COLOR[s.risk]} opacity-85`} style={{ height: `${(LEVEL[s.risk] / 3) * 100}%` }} />
            </div>
            <span className={`inline-flex items-center gap-1 text-xs font-semibold capitalize ${TEXT[s.risk]}`}>
              <RiskIcon level={s.risk} className="h-3.5 w-3.5" />
              {s.risk}
            </span>
            <span className="text-xs text-ink-faint">{s.label}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        Waiting weakens timing links. Someone who keeps full history can still match a unique amount.
      </p>
    </section>
  );
}
