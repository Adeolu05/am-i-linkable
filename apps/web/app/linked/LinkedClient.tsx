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
import { Prompt } from "@/components/Prompt";
import { Cmd, Cursor, Ln, Win } from "@/components/Term";
import { fetchAllBuckets, fetchBucket, formatMB, loadPlan, PlanChanged } from "@/lib/buckets";
import { requestCount, useRequestLog } from "@/lib/requestLog";
import { Netlog } from "../check/Netlog";

type Outcome =
  | { kind: "explain"; message: string }
  | { kind: "found"; address: string; fromTex?: string; events: DecodedEvent[] }
  | { kind: "absent"; address: string; fromTex?: string };

const RISK: Record<Risk, { label: string; text: string }> = {
  high: { label: "HIGH RISK", text: "text-risk-high" },
  medium: { label: "MEDIUM RISK", text: "text-risk-medium" },
  low: { label: "LOW RISK", text: "text-risk-low" },
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
  const [ran, setRan] = useState<{ cmd: string; key: number } | null>(null);
  const paranoidId = useId();
  const resultRef = useRef<HTMLDivElement>(null);
  const entries = useRequestLog();
  const since = baseline === null ? null : Math.max(0, entries.length - baseline);

  useEffect(() => {
    loadPlan().then(setPlan, () => setPlanError(true));
  }, []);

  const check = async () => {
    setRan({ cmd: `linked ${input.trim() || "''"}${paranoid ? " --paranoid" : ""}`, key: Date.now() });
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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
      <div className="min-w-0 space-y-6">
        <Prompt
          label="Your transparent address"
          placeholder="t1… or t3…"
          mode="address"
          value={input}
          onChange={setInput}
          onSubmit={() => void check()}
          error={null}
          disabled={!plan || busy !== null}
        >
          <div className="mt-3.5 flex max-w-[600px] items-start gap-3 rounded-md border border-line px-3.5 py-3">
            <input
              id={paranoidId}
              type="checkbox"
              checked={paranoid}
              onChange={(e) => setParanoid(e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-[#7dffb3]"
            />
            <label htmlFor={paranoidId} className="text-[13px] leading-relaxed text-ink-muted">
              <span className="font-semibold text-ink">--paranoid</span> download all {plan ? plan.bucketCount : "the"} buckets
              {plan ? ` (${formatMB(plan.totalGzipBytes)})` : ""} instead of one, so the server cannot tell which address you checked.
            </label>
          </div>
          <p className="mt-3 flex items-center gap-2.5 text-xs text-ink-muted" role="status">
            {(busy || (!plan && !planError)) && (
              <span className="inline-block h-2.5 w-2.5 border border-accent motion-safe:animate-[spin_1.1s_linear_infinite]" aria-hidden="true" />
            )}
            {busy ??
              (planError ? (
                <span className="text-risk-high">Address data could not be loaded. Please try again later.</span>
              ) : plan ? (
                <span>
                  <b className="font-medium text-ink">{plan.totalAddresses.toLocaleString("en-US")}</b> addresses with activity in the last 30 days, in{" "}
                  <b className="font-medium text-ink">{plan.bucketCount}</b> buckets of at least{" "}
                  <b className="font-medium text-ink">{plan.minBucketSize.toLocaleString("en-US")}</b>
                </span>
              ) : (
                "loading the bucket plan …"
              ))}
          </p>
          <p className="mt-1.5 text-xs text-ink-muted">Check your own addresses. Looking up someone else&rsquo;s address can expose them.</p>
        </Prompt>

        <div ref={resultRef} tabIndex={-1} aria-live="polite" className="scroll-mt-6 outline-none">
          {outcome && ran && <Report key={ran.key} cmd={ran.cmd} outcome={outcome} since={since} />}
        </div>
      </div>

      <aside className="min-w-0 lg:sticky lg:top-6">
        <Netlog checksRun={checksRun} baseline={baseline} summary={summary} subject="address" />
      </aside>
    </div>
  );
}

function Report({ cmd, outcome, since }: { cmd: string; outcome: Outcome; since: number | null }) {
  const win = (children: React.ReactNode) => (
    // A check here is expected to download a bucket, so the count is neutral, not a warning.
    <Win title="linked — local" status={`requests since check: ${since ?? 0}`} statusClassName="text-ink" aria-label="Result">
      <div className="term">
        <Cmd i={0}>{cmd}</Cmd>
        {children}
      </div>
    </Win>
  );
  const prompt = (i: number) => (
    <Ln i={i} className="mt-1">
      <span className="text-accent">$</span> <Cursor />
    </Ln>
  );
  const texNote = (i: number) =>
    outcome.kind !== "explain" && outcome.fromTex ? (
      <Ln i={i} className="text-ink-muted">
        {`# you entered a TEX address; we checked its transparent form ${outcome.address}, which is how it appears on chain. the conversion happened on your device.`}
      </Ln>
    ) : null;

  if (outcome.kind === "explain") {
    return win(
      <>
        <Ln i={1} className="text-ink-muted">{`  ${outcome.message}`}</Ln>
        {prompt(2)}
      </>,
    );
  }

  if (outcome.kind === "absent") {
    return win(
      <>
        <Ln i={1}>{"  no shield or unshield activity for this address in the last 30 days"}</Ln>
        <Ln i={2} className="text-ink-muted">
          {"# this address did not move ZEC into or out of a shielded pool (above 0.001 ZEC) in our 30-day window. that doesn't prove anything about older activity, smaller movements, or transparent-to-transparent payments, which this tool doesn't cover."}
        </Ln>
        {texNote(3)}
        {prompt(4)}
      </>,
    );
  }

  const verdicts = outcome.events.map((e) => ({ e, v: explainEvent(e) }));
  const overall = addressVerdict(outcome.events);
  const style = RISK[overall];
  const advice = [...new Set(verdicts.map(({ e, v }) => adviceFor(e, v.risk)).filter((a): a is string => a !== null))];
  const counts = { high: 0, medium: 0, low: 0 };
  for (const { v } of verdicts) counts[v.risk]++;

  return (
    <div className="space-y-6">
      {win(
        <>
          <Ln i={1} className="py-1">
            <span className={`verdict-tag ${style.text}`}>{style.label}</span>
            <span className="text-ink">{`  ${VERDICT[overall]}`}</span>
          </Ln>
          <Ln i={2} className="text-ink-muted">
            {"  events "}
            <span className="text-ink">{outcome.events.length}</span>
            {"   high "}
            <span className="text-risk-high">{counts.high}</span>
            {"   medium "}
            <span className="text-risk-medium">{counts.medium}</span>
            {"   low "}
            <span className="text-risk-low">{counts.low}</span>
          </Ln>
          {texNote(3)}
          {prompt(4)}
        </>,
      )}

      <section aria-labelledby="timeline">
        <div className="sh">
          <span className="n">01</span>
          <h2 id="timeline">ls events</h2>
        </div>
        <ol className="divide-y divide-line border-y border-line">
          {[...verdicts]
            .sort((a, b) => b.e.time - a.e.time)
            .map(({ e, v }, i) => (
              <li key={`${e.txidPrefix}-${e.role}-${i}`} className="space-y-1.5 px-1 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className={`st ${RISK[v.risk].text}`}>
                    <i />
                    <span className="normal-case tracking-normal text-ink">{eventTitle(e)}</span>
                  </p>
                  <span className={`text-xs font-semibold tracking-[0.12em] ${RISK[v.risk].text}`}>{RISK[v.risk].label}</span>
                </div>
                <p className="text-[13px] text-ink-muted">
                  <time dateTime={new Date(e.time).toISOString()}>{fmtDate(e.time)}</time> · <span className="text-ink">{formatZec(e.amountZat)} ZEC</span> ·{" "}
                  {POOL[e.pool] ?? e.pool} · {e.txidPrefix}…
                </p>
                <p className="pt-1 text-sm font-medium text-ink">{v.headline}</p>
                <p className="text-[13px] leading-relaxed text-ink-muted">{v.detail}</p>
              </li>
            ))}
        </ol>
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          Counts are of other people&rsquo;s deposits and withdrawals, never who made them. Transaction IDs show their first 12 characters; compare them with your
          wallet. We don&rsquo;t link to block explorers, because opening one would tell that site which transaction you&rsquo;re interested in.
        </p>
      </section>

      {advice.length > 0 && (
        <section aria-labelledby="next">
          <div className="sh">
            <span className="n">02</span>
            <h2 id="next">For next time</h2>
          </div>
          <ul className="space-y-2 text-sm leading-relaxed text-ink-muted">
            {advice.map((a) => (
              <li key={a}>
                <span className="text-accent"># </span>
                {a}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs leading-relaxed text-ink-muted">
        This is a risk indicator based on public amounts and timing in our 30-day window, not proof. A low result does not guarantee privacy; a high result
        means a public pattern exists, not that anyone has linked you.
      </p>
    </div>
  );
}
