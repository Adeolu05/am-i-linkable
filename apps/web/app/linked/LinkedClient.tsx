"use client";

// "Have I been linked?": everything below runs in the browser. The address is
// validated and hashed (SHA-256) here; only the bucket of its hash prefix is
// requested, or every bucket in paranoid mode. Matching happens locally.

import {
  addressHash,
  addressVerdict,
  bucketOfHash,
  checkAddress,
  explainEvent,
  findInBucket,
  formatZec,
  type BucketPlanInfo,
  type DecodedEvent,
  type Risk,
} from "@ail/core";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRightIcon, LockIcon, RiskIcon } from "@/components/icons";
import { fetchAllBuckets, fetchBucket, formatMB, loadPlan, PlanChanged } from "@/lib/buckets";
import { PrivacyReceipt, requestCount } from "../check/PrivacyReceipt";

type Outcome =
  | { kind: "explain"; message: string }
  | { kind: "found"; address: string; fromTex?: string; events: DecodedEvent[] }
  | { kind: "absent"; address: string; fromTex?: string };

const RISK: Record<Risk, { label: string; text: string; tint: string; ring: string; dot: string }> = {
  high: { label: "High risk", text: "text-risk-high", tint: "from-risk-high/25", ring: "ring-risk-high/45", dot: "bg-risk-high" },
  medium: { label: "Medium risk", text: "text-risk-medium", tint: "from-risk-medium/22", ring: "ring-risk-medium/45", dot: "bg-risk-medium" },
  low: { label: "Low risk", text: "text-risk-low", tint: "from-risk-low/20", ring: "ring-risk-low/45", dot: "bg-risk-low" },
};

const VERDICT: Record<Risk, string> = {
  high: "Some of this address's recent activity may be linkable.",
  medium: "Some activity may be linkable, though the links are weaker.",
  low: "None of this address's recent activity stands out.",
};

const POOL: Record<string, string> = { sprout: "Sprout", sapling: "Sapling", orchard: "Orchard", ironwood: "Ironwood" };

function eventTitle(e: DecodedEvent): string {
  if (e.direction === "unshield") return e.role === "output" ? "Withdrawal to this address" : "Paid into a withdrawal from this address";
  return e.role === "input" ? "Deposit from this address" : "Change returned to this address in a deposit";
}

function adviceFor(e: DecodedEvent, risk: Risk): string | null {
  if (risk === "low") return null;
  if (e.direction === "unshield") return "Before withdrawing, check the amount on Before you move. Prefer a common amount, and leave more time after a matching deposit.";
  return "Deposit common amounts, and avoid withdrawing the same amount (or the same minus a fee) soon after depositing.";
}

const fmtDate = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export function LinkedClient() {
  const [plan, setPlan] = useState<BucketPlanInfo | null>(null);
  const [planError, setPlanError] = useState(false);
  const [input, setInput] = useState("");
  const [paranoid, setParanoid] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [summary, setSummary] = useState<React.ReactNode>(null);
  const [checksRun, setChecksRun] = useState(0);
  const [baseline, setBaseline] = useState<number | null>(null);
  const inputId = useId();
  const paranoidId = useId();
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadPlan().then(setPlan, () => setPlanError(true));
  }, []);

  const check = async () => {
    const c = checkAddress(input);
    if (c.kind !== "transparent") {
      // Nothing is sent for anything that is not a transparent address.
      setOutcome({ kind: "explain", message: c.message });
      setSummary("Nothing was sent: this check stopped on your device.");
      return;
    }
    if (!plan) return;
    // Counted before any request, so the receipt shows exactly what this check sent.
    setBaseline(requestCount());
    setChecksRun((n) => n + 1);
    const hash = addressHash(c.address);
    let current = plan;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const index = bucketOfHash(hash, current.bits);
          let events: DecodedEvent[] | null;
          if (paranoid) {
            setBusy(`Downloading all ${current.bucketCount} buckets…`);
            const all = await fetchAllBuckets(current, (d) => setBusy(`Downloading all buckets: ${d} of ${current.bucketCount}…`));
            events = findInBucket(all[index]!, hash);
            setSummary(
              <>
                <strong className="font-semibold">All {current.bucketCount} buckets</strong> were downloaded, the same files everyone can get. The server
                cannot tell which address you checked.
              </>,
            );
          } else {
            setBusy("Downloading your bucket…");
            const bucket = await fetchBucket(current.bits, index);
            events = findInBucket(bucket, hash);
            setSummary(
              <>
                <strong className="font-semibold">1 request:</strong> bucket {index + 1} of {current.bucketCount}, shared with{" "}
                {bucket.addresses.length.toLocaleString("en-US")} addresses. The server sees only that bucket&rsquo;s number, never your address or its hash.
              </>,
            );
          }
          setOutcome(events ? { kind: "found", address: c.address, fromTex: c.fromTex, events } : { kind: "absent", address: c.address, fromTex: c.fromTex });
          break;
        } catch (err) {
          if (err instanceof PlanChanged && attempt === 0) {
            current = await loadPlan();
            setPlan(current);
            continue;
          }
          throw err;
        }
      }
    } catch {
      setOutcome({ kind: "explain", message: "The address data could not be loaded right now. Please try again in a moment." });
    } finally {
      setBusy(null);
      requestAnimationFrame(() => resultRef.current?.focus({ preventScroll: true }));
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="min-w-0 space-y-6">
        <form
          className="glass space-y-4 p-5 sm:p-6"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void check();
          }}
        >
          <label htmlFor={inputId} className="block font-display text-lg font-semibold">
            Your transparent address
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id={inputId}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="t1… or t3…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="min-h-14 min-w-0 flex-1 rounded-2xl border border-white/20 bg-night/40 px-4 font-mono text-base text-ink placeholder:text-ink-faint focus:border-gold/70"
            />
            <button
              type="submit"
              disabled={!plan || busy !== null}
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gold px-7 text-lg font-semibold text-night shadow-glow-gold transition hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-50"
            >
              Check
              <ArrowRightIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="tile flex items-start gap-3 p-3.5">
            <input
              id={paranoidId}
              type="checkbox"
              checked={paranoid}
              onChange={(e) => setParanoid(e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-[#f4b728]"
            />
            <label htmlFor={paranoidId} className="text-sm leading-relaxed">
              <span className="font-semibold">Paranoid mode:</span> download all {plan ? plan.bucketCount : "the"} buckets
              {plan ? ` (${formatMB(plan.totalGzipBytes)})` : ""} instead of one, so the server cannot tell which address you checked.
            </label>
          </div>

          <p className="text-sm text-ink-faint" role="status">
            {busy ??
              (planError
                ? "Address data could not be loaded. Please try again later."
                : plan
                  ? `${plan.totalAddresses.toLocaleString("en-US")} addresses with activity in the last 30 days, in ${plan.bucketCount} buckets of at least ${plan.minBucketSize.toLocaleString("en-US")}.`
                  : "Loading the bucket plan…")}
          </p>
          <p className="text-xs text-ink-faint">Check your own addresses. Looking up someone else&rsquo;s address can expose them.</p>
        </form>

        <div ref={resultRef} tabIndex={-1} aria-live="polite" className="scroll-mt-6 outline-none">
          {outcome && <Report outcome={outcome} />}
        </div>
      </div>

      <aside className="space-y-6 lg:sticky lg:top-6">
        <PrivacyReceipt checksRun={checksRun} baseline={baseline} summary={summary} subject="address" />
      </aside>
    </div>
  );
}

function Report({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === "explain") {
    return (
      <section className="glass animate-rise flex items-start gap-3 p-6" aria-label="Result">
        <LockIcon className="mt-0.5 h-6 w-6 shrink-0 text-gold" />
        <p className="leading-relaxed">{outcome.message}</p>
      </section>
    );
  }
  const texNote = outcome.fromTex ? (
    <p className="text-sm text-ink-muted">
      You entered a TEX address; we checked its transparent form <span className="break-all font-mono text-ink">{outcome.address}</span>, which is how it appears on chain. The conversion happened on your device.
    </p>
  ) : null;

  if (outcome.kind === "absent") {
    return (
      <section className="glass animate-rise space-y-3 p-6" aria-label="Result">
        <h2 className="font-display text-2xl font-bold">No shield or unshield activity for this address in the last 30 days</h2>
        <p className="leading-relaxed text-ink-muted">
          This address did not move ZEC into or out of a shielded pool (above 0.001 ZEC) in our 30-day window. That doesn&rsquo;t prove anything about older
          activity, about smaller movements, or about transparent-to-transparent payments, which this tool doesn&rsquo;t cover.
        </p>
        {texNote}
      </section>
    );
  }

  const verdicts = outcome.events.map((e) => ({ e, v: explainEvent(e) }));
  const overall = addressVerdict(outcome.events);
  const style = RISK[overall];
  const advice = [...new Set(verdicts.map(({ e, v }) => adviceFor(e, v.risk)).filter((a): a is string => a !== null))];
  const counts = { high: 0, medium: 0, low: 0 };
  for (const { v } of verdicts) counts[v.risk]++;

  return (
    <div className="space-y-6" aria-label="Result">
      <section className={`glass animate-rise overflow-hidden ring-1 ${style.ring}`}>
        <div className={`bg-gradient-to-br ${style.tint} to-transparent p-6 sm:p-7`}>
          <div className="flex items-start gap-4">
            <RiskIcon level={overall} className={`h-12 w-12 shrink-0 ${style.text}`} />
            <div className="min-w-0">
              <p className={`font-display text-sm font-bold uppercase tracking-[0.14em] ${style.text}`}>{style.label}</p>
              <h2 className="mt-1 font-display text-2xl font-bold leading-tight sm:text-3xl">{VERDICT[overall]}</h2>
              <p className="mt-2 text-ink-muted">
                {outcome.events.length} shield or unshield event{outcome.events.length === 1 ? "" : "s"} in the last 30 days: {counts.high} high, {counts.medium} medium,{" "}
                {counts.low} low.
              </p>
            </div>
          </div>
        </div>
        {texNote && <div className="border-t border-white/10 px-6 py-4 sm:px-7">{texNote}</div>}
      </section>

      <section className="glass animate-rise p-5 sm:p-6" aria-labelledby="timeline">
        <h3 id="timeline" className="font-display text-xl font-semibold">
          Timeline
        </h3>
        <ol className="mt-4 space-y-4">
          {[...verdicts]
            .sort((a, b) => b.e.time - a.e.time)
            .map(({ e, v }, i) => (
              <li key={`${e.txidPrefix}-${e.role}-${i}`} className="tile flex gap-3 p-4">
                <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${RISK[v.risk].dot}`} aria-hidden="true" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="font-semibold">{eventTitle(e)}</p>
                    <p className={`inline-flex items-center gap-1 text-xs font-semibold ${RISK[v.risk].text}`}>
                      <RiskIcon level={v.risk} className="h-3.5 w-3.5" />
                      {RISK[v.risk].label}
                    </p>
                  </div>
                  <p className="text-sm text-ink-muted">
                    <time dateTime={new Date(e.time).toISOString()}>{fmtDate(e.time)}</time> · <span className="font-mono text-ink">{formatZec(e.amountZat)} ZEC</span> ·{" "}
                    {POOL[e.pool] ?? e.pool} · <span className="font-mono">{e.txidPrefix}…</span>
                  </p>
                  <p className="pt-1 font-medium">{v.headline}</p>
                  <p className="text-sm leading-relaxed text-ink-muted">{v.detail}</p>
                </div>
              </li>
            ))}
        </ol>
        <p className="mt-4 text-xs leading-relaxed text-ink-faint">
          Counts are of other people&rsquo;s deposits and withdrawals, never who made them. Transaction IDs show their first 12 characters; compare them with your
          wallet. We don&rsquo;t link to block explorers, because opening one would tell that site which transaction you&rsquo;re interested in.
        </p>
      </section>

      {advice.length > 0 && (
        <section className="glass animate-rise p-5 sm:p-6" aria-labelledby="next">
          <h3 id="next" className="font-display text-xl font-semibold">
            For next time
          </h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-ink-muted">
            {advice.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs leading-relaxed text-ink-faint">
        This is a risk indicator based on public amounts and timing in our 30-day window, not proof. A low result does not guarantee privacy; a high result
        means a public pattern exists, not that anyone has linked you.
      </p>
    </div>
  );
}
