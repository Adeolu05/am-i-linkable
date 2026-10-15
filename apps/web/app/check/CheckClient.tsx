"use client";

// "Before you move": everything below runs in the browser. The typed amount is
// never sent anywhere; the only download is the public snapshot everyone gets.

import {
  checkWithdrawal,
  crowdAround,
  describeAge,
  formatZec,
  parseZecToZat,
  pickCommonExample,
  pickRiskyExample,
  type CheckResult,
  type Risk,
  type ShieldIndex,
} from "@ail/core";
import { useId, useRef, useState } from "react";
import { CountUp } from "@/components/CountUp";
import { ArrowRightIcon, ClockIcon, CrowdIcon, RiskIcon, SparkIcon, SplitIcon } from "@/components/icons";
import { freshness, useShields } from "@/lib/useShields";
import { CrowdPlot } from "./CrowdPlot";
import { PrivacyReceipt, requestCount } from "./PrivacyReceipt";
import { WaitChart } from "./WaitChart";

type Shown = { result: CheckResult; amount: string; at: number; key: number };

const RISK: Record<Risk, { label: string; text: string; tint: string; ring: string }> = {
  high: { label: "High risk", text: "text-risk-high", tint: "from-risk-high/25", ring: "ring-risk-high/45" },
  medium: { label: "Medium risk", text: "text-risk-medium", tint: "from-risk-medium/22", ring: "ring-risk-medium/45" },
  low: { label: "Low risk", text: "text-risk-low", tint: "from-risk-low/20", ring: "ring-risk-low/45" },
};

const POOL: Record<string, string> = { sprout: "Sprout", sapling: "Sapling", orchard: "Orchard", ironwood: "Ironwood" };

function verdict(r: Extract<CheckResult, { kind: "result" }>): string {
  if (r.anonymitySet === 0) return "No recent deposit matches this amount.";
  if (r.risk === "high") return "This withdrawal may be linkable to a recent deposit.";
  if (r.risk === "medium") return "This withdrawal may be linkable, though the link is weaker.";
  return "This withdrawal blends in with many recent deposits.";
}

export function CheckClient() {
  const data = useShields();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [checksRun, setChecksRun] = useState(0);
  const [baseline, setBaseline] = useState<number | null>(null);
  const [exampleNote, setExampleNote] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();
  const resultRef = useRef<HTMLDivElement>(null);
  const ready = data.status === "ready" ? data : null;

  const run = (raw: string, note: string | null = null) => {
    const parsed = parseZecToZat(raw);
    if (!parsed.ok) {
      setError(parsed.error);
      setShown(null);
      return;
    }
    if (!ready) return;
    setError(null);
    setInput(raw);
    setExampleNote(note);
    const now = Date.now();
    setShown({ result: checkWithdrawal(parsed.zat, now, ready.index), amount: formatZec(parsed.zat), at: now, key: now });
    setChecksRun((n) => n + 1);
    setBaseline(requestCount());
    requestAnimationFrame(() => resultRef.current?.focus({ preventScroll: true }));
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const tryExample = (kind: "risky" | "common") => {
    if (!ready) return;
    const now = Date.now();
    const zat = kind === "risky" ? pickRiskyExample(ready.index, now) : pickCommonExample(ready.index, now);
    if (zat === null) {
      setExampleNote(kind === "risky" ? "No unique recent deposit to use as an example right now." : "No common amount found right now.");
      return;
    }
    run(
      formatZec(zat).replace(/,/g, ""),
      kind === "risky"
        ? "Example: a deposit from the last two days with a unique amount, minus a typical fee. Picked on your device."
        : "Example: one of the most common deposit amounts this month. Picked on your device.",
    );
  };

  const status =
    data.status === "loading"
      ? "Downloading recent deposits…"
      : data.status === "error"
        ? "Recent deposits could not be loaded. Please try again later."
        : `${data.index.size.toLocaleString("en-US")} deposits from the last 30 days loaded (${[
            data.tipHeight ? `up to block ${data.tipHeight.toLocaleString("en-US")}` : null,
            freshness(data.generatedAt),
          ]
            .filter(Boolean)
            .join(", ")}).`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="min-w-0 space-y-6">
        <form
          className="glass space-y-4 p-5 sm:p-6"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            run(input);
          }}
        >
          <label htmlFor={inputId} className="block font-display text-lg font-semibold">
            Amount you plan to withdraw
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <input
                id={inputId}
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. 2.5"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className="min-h-14 w-full rounded-2xl border border-white/20 bg-night/40 pl-4 pr-16 font-mono text-xl text-ink placeholder:text-ink-faint focus:border-gold/70"
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-semibold text-ink-faint">ZEC</span>
            </div>
            <button
              type="submit"
              disabled={!ready}
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gold px-7 text-lg font-semibold text-night shadow-glow-gold transition hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-50"
            >
              Check
              <ArrowRightIcon className="h-5 w-5" />
            </button>
          </div>
          {error && (
            <p id={errorId} className="text-sm text-risk-high">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => tryExample("risky")}
              disabled={!ready}
              className="inline-flex items-center gap-2 rounded-full border border-risk-high/40 bg-risk-high/10 px-3.5 py-2 text-sm font-medium text-ink transition hover:bg-risk-high/20 disabled:opacity-50"
            >
              <SparkIcon className="h-4 w-4 text-risk-high" />
              Try a risky example
            </button>
            <button
              type="button"
              onClick={() => tryExample("common")}
              disabled={!ready}
              className="inline-flex items-center gap-2 rounded-full border border-risk-low/40 bg-risk-low/10 px-3.5 py-2 text-sm font-medium text-ink transition hover:bg-risk-low/20 disabled:opacity-50"
            >
              <CrowdIcon className="h-4 w-4 text-risk-low" />
              Try a common amount
            </button>
          </div>
          <p className="text-sm text-ink-faint" role="status">
            {status}
          </p>
        </form>

        <div ref={resultRef} tabIndex={-1} aria-live="polite" className="scroll-mt-6 outline-none">
          {shown && ready && <Result key={shown.key} shown={shown} index={ready.index} note={exampleNote} onTry={(z) => run(formatZec(z).replace(/,/g, ""))} />}
        </div>
      </div>

      <aside className="space-y-6 lg:sticky lg:top-6">
        <PrivacyReceipt checksRun={checksRun} baseline={baseline} />
      </aside>
    </div>
  );
}

function Result({
  shown,
  index,
  note,
  onTry,
}: {
  shown: Shown;
  index: ShieldIndex;
  note: string | null;
  onTry: (zat: number) => void;
}) {
  const { result, amount } = shown;
  if (result.kind !== "result") {
    return (
      <section className="glass animate-rise p-6" aria-label="Result">
        <h2 className="font-display text-2xl font-semibold">{amount} ZEC</h2>
        <p className="mt-2 text-ink-muted">{result.message}</p>
      </section>
    );
  }
  const style = RISK[result.risk];
  const newestAge = result.matches[0]?.ageMs ?? null;
  const crowd = crowdAround(index, result.amountZat, shown.at);
  const { wait, commonAmounts, split } = result.suggestions;
  const firstBetter = wait?.find((w) => w.risk !== result.risk);

  return (
    <div className="space-y-6" aria-label="Result">
      {note && <p className="animate-fade text-sm text-ink-muted">{note}</p>}

      <section className={`glass animate-rise overflow-hidden ring-1 ${style.ring}`}>
        <div className={`bg-gradient-to-br ${style.tint} to-transparent p-6 sm:p-7`}>
          <div className="flex items-start gap-4">
            <RiskIcon level={result.risk} className={`h-12 w-12 shrink-0 ${style.text}`} />
            <div className="min-w-0">
              <p className={`font-display text-sm font-bold uppercase tracking-[0.14em] ${style.text}`}>{style.label}</p>
              <h2 className="mt-1 font-display text-2xl font-bold leading-tight sm:text-3xl">{verdict(result)}</h2>
              <p className="mt-2 text-ink-muted">
                Withdrawing <span className="font-mono font-semibold text-ink">{amount} ZEC</span>
              </p>
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-3 gap-3">
            <div className="tile p-3">
              <dt className="text-xs text-ink-faint">Matching deposits</dt>
              <dd className="mt-1 font-display text-2xl font-bold">
                <CountUp value={result.anonymitySet} />
              </dd>
            </div>
            <div className="tile p-3">
              <dt className="text-xs text-ink-faint">Exact amount</dt>
              <dd className="mt-1 font-display text-2xl font-bold">
                <CountUp value={result.exactCount} />
              </dd>
            </div>
            <div className="tile p-3">
              <dt className="text-xs text-ink-faint">Newest match</dt>
              <dd className="mt-1 font-display text-lg font-bold leading-8">{newestAge === null ? "none" : `${describeAge(newestAge)} ago`}</dd>
            </div>
          </dl>
        </div>
        <ul className="space-y-1.5 border-t border-white/10 px-6 py-5 leading-relaxed sm:px-7">
          {result.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      <CrowdPlot crowd={crowd} amountZat={result.amountZat} risk={result.risk} />

      {result.risk !== "low" && (
        <div className="grid gap-6 md:grid-cols-2">
          <WaitChart anonymitySet={result.anonymitySet} newestAgeMs={newestAge} />
          <section className="glass animate-rise space-y-3 p-5 sm:p-6" aria-labelledby="todo">
            <h3 id="todo" className="font-display text-xl font-semibold">
              What you could do
            </h3>
            {firstBetter && (
              <div className="tile flex items-start gap-3 p-4">
                <ClockIcon className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                <div>
                  <p className="font-semibold">
                    Wait {firstBetter.afterDays} day{firstBetter.afterDays === 1 ? "" : "s"}
                  </p>
                  <p className="text-sm text-ink-muted">Risk drops to {firstBetter.risk} for this amount.</p>
                </div>
              </div>
            )}
            {commonAmounts?.slice(0, 2).map((c) => (
              <button
                key={c.amountZat}
                type="button"
                onClick={() => onTry(c.amountZat)}
                className="tile flex w-full items-start gap-3 p-4 text-left transition hover:border-gold/50 hover:bg-white/10"
              >
                <CrowdIcon className="mt-0.5 h-5 w-5 shrink-0 text-risk-low" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    Use <span className="font-mono">{formatZec(c.amountZat)}</span> ZEC instead
                  </span>
                  <span className="block text-sm text-ink-muted">
                    {c.anonymitySet.toLocaleString("en-US")} others did. Leave the rest shielded.
                  </span>
                </span>
                <ArrowRightIcon className="mt-0.5 h-5 w-5 shrink-0 text-ink-faint" />
              </button>
            ))}
            {split && (
              <div className="tile flex items-start gap-3 p-4">
                <SplitIcon className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                <div>
                  <p className="font-semibold">
                    Split into {split.map((s) => formatZec(s.amountZat)).join(" + ")} ZEC
                  </p>
                  <p className="text-sm text-ink-muted">Send the parts hours or days apart, to different addresses.</p>
                </div>
              </div>
            )}
            {!firstBetter && !commonAmounts && !split && <p className="text-sm text-ink-muted">No simple alternative found in the data.</p>}
          </section>
        </div>
      )}

      {result.matches.length > 0 && result.risk !== "low" && (
        <section className="glass animate-rise p-5 sm:p-6" aria-labelledby="matches">
          <h3 id="matches" className="font-display text-xl font-semibold">
            Matching deposits
          </h3>
          <ul className="mt-4 divide-y divide-white/10">
            {result.matches.map((m, i) => (
              <li key={`${m.txidPrefix}-${i}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-1 py-3 text-sm sm:grid-cols-[1fr_1.4fr_0.8fr_1.2fr] sm:items-center">
                <span className="text-ink-muted">
                  <time dateTime={new Date(m.time).toISOString()} title={new Date(m.time).toUTCString()}>
                    {describeAge(m.ageMs)} ago
                  </time>
                </span>
                <span className="min-w-0 text-right font-mono sm:text-left">
                  {formatZec(m.amountZat)}
                  {m.kind === "near" && <span className="block text-xs text-ink-faint sm:ml-1 sm:inline">(+{formatZec(m.differenceZat)})</span>}
                </span>
                <span>{POOL[m.pool] ?? m.pool}</span>
                <span className="min-w-0 break-all text-right font-mono text-xs text-ink-muted sm:text-left">{m.txidPrefix}…</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            Transaction IDs show their first 12 characters. We don&rsquo;t link to block explorers: opening one would
            tell that site which transaction you&rsquo;re interested in. Compare this ID with the one in your wallet.
          </p>
        </section>
      )}

      <p className="text-xs leading-relaxed text-ink-faint">{result.caveat}</p>
    </div>
  );
}
