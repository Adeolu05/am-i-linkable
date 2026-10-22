"use client";

// "Before you move": everything below runs in the browser. The typed amount is
// never sent anywhere; the only download is the public snapshot everyone gets.
// An amount can arrive in the URL fragment (/check#2.5), which browsers never
// send; it is read once, run, and cleared from the address bar.

import {
  FEE_BAND_ZAT,
  checkWithdrawal,
  crowdAround,
  describeAge,
  formatZec,
  parseZecToZat,
  pickCommonExample,
  pickRiskyExample,
  riskFor,
  type CheckResult,
  type Risk,
  type ShieldIndex,
} from "@ail/core";
import { useEffect, useRef, useState } from "react";
import { Prompt } from "@/components/Prompt";
import { Cmd, Cursor, Ln, Win } from "@/components/Term";
import { clearHash, readAmountHash, type HashIntent } from "@/lib/amountHash";
import { requestCount, useRequestLog } from "@/lib/requestLog";
import { freshness, useShields } from "@/lib/useShields";
import { AsciiCrowdView } from "./AsciiCrowdView";
import { crowdSummary } from "./asciiCrowd";
import { Netlog } from "./Netlog";

type Shown = { result: CheckResult; amount: string; at: number; key: number };

const RISK: Record<Risk, { label: string; text: string }> = {
  high: { label: "HIGH RISK", text: "text-risk-high" },
  medium: { label: "MEDIUM RISK", text: "text-risk-medium" },
  low: { label: "LOW RISK", text: "text-risk-low" },
};
const BARS: Record<Risk, string> = { high: "███", medium: "██░", low: "█░░" };

const POOL: Record<string, string> = { sprout: "Sprout", sapling: "Sapling", orchard: "Orchard", ironwood: "Ironwood" };

function verdict(r: Extract<CheckResult, { kind: "result" }>): string {
  if (r.anonymitySet === 0) return "No recent deposit matches this amount.";
  if (r.risk === "high") return "This withdrawal may be linkable to a recent deposit.";
  if (r.risk === "medium") return "This withdrawal may be linkable, though the link is weaker.";
  return "This withdrawal blends in with many recent deposits.";
}

const plain = (z: number) => formatZec(z).replace(/,/g, "");
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function CheckClient() {
  const data = useShields();
  const entries = useRequestLog();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [checksRun, setChecksRun] = useState(0);
  const [lastAmount, setLastAmount] = useState<string | undefined>(undefined);
  const [baseline, setBaseline] = useState<number | null>(null);
  const [exampleNote, setExampleNote] = useState<string | null>(null);
  const [intent, setIntent] = useState<HashIntent>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const ready = data.status === "ready" ? data : null;
  const since = baseline === null ? null : Math.max(0, entries.length - baseline);

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
    const amount = formatZec(parsed.zat);
    setShown({ result: checkWithdrawal(parsed.zat, now, ready.index), amount, at: now, key: now });
    setChecksRun((n) => n + 1);
    setLastAmount(amount);
    setBaseline(requestCount());
    requestAnimationFrame(() => {
      resultRef.current?.focus({ preventScroll: true });
      resultRef.current?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
    });
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
      plain(zat),
      kind === "risky"
        ? "Example: a deposit from the last two days with a unique amount, minus a typical fee. Picked on your device."
        : "Example: one of the most common deposit amounts this month. Picked on your device.",
    );
  };

  // An amount or example handed over in the fragment: read once (and on later hash changes).
  useEffect(() => {
    const read = () => {
      const i = readAmountHash(window.location.hash);
      if (!i) return;
      clearHash();
      if (i.kind === "amount") setInput(i.raw);
      setIntent(i);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  // ...and run it once the deposits are loaded.
  useEffect(() => {
    if (!intent || !ready) return;
    setIntent(null);
    if (intent.kind === "amount") run(intent.raw);
    else tryExample(intent.which);
    // run and tryExample come from this same render, so they see the loaded data.
  }, [intent, ready]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
      <div className="min-w-0 space-y-6">
        <div className="space-y-3.5">
          <Prompt label="Amount you plan to withdraw" placeholder="2.5" unit="ZEC" value={input} onChange={setInput} onSubmit={() => run(input)} error={error} disabled={!ready} />
          <div className="flex flex-wrap gap-2 text-xs">
            {(["risky", "common"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => tryExample(k)}
                disabled={!ready}
                className="rounded border border-line px-2.5 py-1.5 text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-40"
              >
                try: <b className="font-medium text-ink">{k === "risky" ? "risky example" : "common amount"}</b>
              </button>
            ))}
          </div>
          <p className="flex items-center gap-2.5 text-xs text-ink-muted" role="status">
            {data.status === "loading" && (
              <>
                <span className="inline-block h-2.5 w-2.5 border border-accent motion-safe:animate-[spin_1.1s_linear_infinite]" aria-hidden="true" />
                downloading 30 days of deposits …
              </>
            )}
            {data.status === "error" && <span className="text-risk-high">deposits could not be loaded. try again later.</span>}
            {ready && (
              <span>
                <b className="font-medium text-ink">{ready.index.size.toLocaleString("en-US")}</b> deposits loaded
                {ready.tipHeight ? (
                  <>
                    {" "}
                    · block <b className="font-medium text-ink">{ready.tipHeight.toLocaleString("en-US")}</b>
                  </>
                ) : null}{" "}
                · {freshness(ready.generatedAt)}
              </span>
            )}
          </p>
        </div>

        <div ref={resultRef} tabIndex={-1} aria-live="polite" className="scroll-mt-6 outline-none">
          {shown && ready && (
            <Result
              key={shown.key}
              shown={shown}
              index={ready.index}
              loaded={ready.index.size}
              note={exampleNote}
              since={since}
              onTry={(z) => run(plain(z))}
            />
          )}
        </div>
      </div>
      <aside className="min-w-0 lg:sticky lg:top-6">
        <Netlog checksRun={checksRun} baseline={baseline} lastLabel={lastAmount} />
      </aside>
    </div>
  );
}

function Result({
  shown,
  index,
  loaded,
  note,
  since,
  onTry,
}: {
  shown: Shown;
  index: ShieldIndex;
  loaded: number;
  note: string | null;
  since: number | null;
  onTry: (zat: number) => void;
}) {
  const { result, amount } = shown;
  const sinceBad = since !== null && since > 0;
  const win = (children: React.ReactNode) => (
    <Win title="check — local" status={`requests since check: ${since ?? 0}`} statusClassName={sinceBad ? "text-risk-high" : "text-accent"} aria-label="Result">
      <div className="term">{children}</div>
    </Win>
  );

  if (result.kind !== "result") {
    return win(
      <>
        <Cmd i={0}>{`check ${amount} --withdraw`}</Cmd>
        <Ln i={1} className="text-ink-muted">{`  ${result.message}`}</Ln>
        <Ln i={2}>
          <span className="text-accent">$</span> <Cursor />
        </Ln>
      </>,
    );
  }

  const style = RISK[result.risk];
  const newestAge = result.matches[0]?.ageMs ?? null;
  const crowd = crowdAround(index, result.amountZat, shown.at);
  const { wait, commonAmounts, split } = result.suggestions;
  const firstBetter = wait?.find((w) => w.risk !== result.risk);
  const lines = result.reasons.length;

  return (
    <div className="space-y-6">
      {note && <p className="text-sm text-ink-muted">{note}</p>}
      {win(
        <>
          <Cmd i={0}>{`check ${amount} --withdraw`}</Cmd>
          <Ln i={1} className="text-ink-muted">
            {"  deposits loaded   "}
            <span className="text-ink">{loaded.toLocaleString("en-US")}</span>
            {"  (30 days, same file for everyone)"}
          </Ln>
          <Ln i={2} className="text-ink-muted">
            {"  match zone        "}
            <span className="text-ink">{`${amount} … ${formatZec(result.amountZat + FEE_BAND_ZAT)} ZEC`}</span>
          </Ln>
          <Ln i={3} className="py-1">
            <span className={`verdict-tag ${style.text}`}>{style.label}</span>
            <span className="text-ink">{`  ${verdict(result)}`}</span>
          </Ln>
          <Ln i={4} className="text-ink-muted">
            {"  matching deposits "}
            <span className={style.text}>{result.anonymitySet.toLocaleString("en-US")}</span>
            {"   exact "}
            <span className={style.text}>{result.exactCount.toLocaleString("en-US")}</span>
            {"   newest "}
            <span className={style.text}>{newestAge === null ? "none" : `${describeAge(newestAge)} ago`}</span>
          </Ln>
          {result.reasons.map((r, i) => (
            <Ln key={r} i={5 + i} className="text-ink-muted">
              {`# ${r}`}
            </Ln>
          ))}
          <Ln i={5 + lines}>
            <AsciiCrowdView crowd={crowd} amountZat={result.amountZat} risk={result.risk} />
          </Ln>
          <Ln i={6 + lines} className="text-ink-muted">
            {"  "}
            <span className={style.text}>●</span> match <span className="text-dim">·</span> nearby, not matching <span className="text-accent">─</span> your amount
          </Ln>
          <Ln i={7 + lines} className="mt-2 text-[13px] text-ink-muted">
            {crowdSummary(crowd, amount)}
          </Ln>
          <Ln i={8 + lines} className="mt-2">
            <span className="text-accent">$</span> <Cursor />
          </Ln>
        </>,
      )}

      {result.risk !== "low" && (
        <div className="grid gap-6 md:grid-cols-[1.3fr_1fr]">
          <section aria-labelledby="todo">
            <div className="sh">
              <span className="n">01</span>
              <h2 id="todo">Next moves</h2>
            </div>
            <ul className="divide-y divide-line">
              {firstBetter && (
                <li className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <code className="text-sm text-ink">
                      <span className="text-accent">$ </span>wait {firstBetter.afterDays}d
                    </code>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      risk drops to <span className={RISK[firstBetter.risk].text}>{firstBetter.risk}</span> for this amount
                    </p>
                  </div>
                  <span className={`st ${RISK[firstBetter.risk].text}`}>
                    <i />
                    {firstBetter.risk}
                  </span>
                </li>
              )}
              {commonAmounts?.slice(0, 2).map((c) => (
                <li key={c.amountZat} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <code className="text-sm text-ink">
                      <span className="text-accent">$ </span>check {plain(c.amountZat)}
                    </code>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {c.anonymitySet.toLocaleString("en-US")} others withdrew it · leave the rest shielded
                    </p>
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => onTry(c.amountZat)}>
                    run <span className="ar">→</span>
                  </button>
                </li>
              ))}
              {split && (
                <li className="py-3">
                  <code className="text-sm text-ink">
                    <span className="text-accent">$ </span>split {split.map((s) => plain(s.amountZat)).join(" ")}
                  </code>
                  <p className="mt-0.5 text-xs text-ink-muted">send the parts hours or days apart, to different addresses</p>
                </li>
              )}
              {!firstBetter && !commonAmounts && !split && <li className="py-3 text-sm text-ink-muted"># no simple alternative found in the data.</li>}
            </ul>
          </section>
          <WaitTable anonymitySet={result.anonymitySet} newestAgeMs={newestAge} />
        </div>
      )}

      {result.matches.length > 0 && result.risk !== "low" && (
        <section aria-labelledby="matches">
          <div className="sh">
            <span className="n">03</span>
            <h2 id="matches">ls matches</h2>
          </div>
          <ul className="divide-y divide-line border-y border-line text-[13px]">
            {result.matches.map((m, i) => (
              <li
                key={`${m.txidPrefix}-${i}`}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-1 px-1 py-2.5 sm:grid-cols-[1fr_1.4fr_0.8fr_1.2fr] sm:items-center"
              >
                <span className="text-ink-muted">
                  <time dateTime={new Date(m.time).toISOString()} title={new Date(m.time).toUTCString()}>
                    {describeAge(m.ageMs)} ago
                  </time>
                </span>
                <span className="min-w-0 text-right sm:text-left">
                  {formatZec(m.amountZat)}
                  {m.kind === "near" && <span className="block text-xs text-ink-muted sm:ml-1 sm:inline">(+{formatZec(m.differenceZat)})</span>}
                </span>
                <span>{POOL[m.pool] ?? m.pool}</span>
                <span className="min-w-0 break-all text-right text-xs text-ink-muted sm:text-left">{m.txidPrefix}…</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-ink-muted">
            Transaction IDs show their first 12 characters. We don&rsquo;t link to block explorers: opening one would
            tell that site which transaction you&rsquo;re interested in. Compare this ID with the one in your wallet.
          </p>
        </section>
      )}

      <p className="text-xs leading-relaxed text-ink-muted">{result.caveat}</p>
    </div>
  );
}

/** Risk now and after 1, 3 and 7 days, from the same rule as the main result (riskFor). */
function WaitTable({ anonymitySet, newestAgeMs }: { anonymitySet: number; newestAgeMs: number | null }) {
  const DAY = 86_400_000;
  const steps = [0, 1, 3, 7].map((d) => ({
    label: d === 0 ? "now" : `+${d}d`,
    risk: riskFor(anonymitySet, newestAgeMs === null ? null : newestAgeMs + d * DAY),
  }));
  return (
    <section aria-labelledby="wait-title">
      <div className="sh">
        <span className="n">02</span>
        <h2 id="wait-title">If you wait</h2>
      </div>
      <ol className="space-y-1.5 text-[13px]">
        {steps.map((s) => (
          <li key={s.label} className="grid grid-cols-[3.5rem_3rem_1fr] items-center">
            <span className="text-ink-muted">{s.label}</span>
            <span className={RISK[s.risk].text} aria-hidden="true">
              {BARS[s.risk]}
            </span>
            <span className={RISK[s.risk].text}>{s.risk}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs leading-relaxed text-ink-muted">
        Waiting weakens timing links. Someone who keeps full history can still match a unique amount.
      </p>
    </section>
  );
}
