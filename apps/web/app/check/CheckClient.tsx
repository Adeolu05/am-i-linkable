"use client";

// Downloads the recent deposits once, then checks amounts entirely in the browser
// with packages/core. The typed amount is never sent anywhere.

import {
  checkWithdrawal,
  decodeShields,
  describeAge,
  formatZec,
  parseZecToZat,
  ShieldIndex,
  type CheckResult,
  type Risk,
  type ShieldsPayload,
} from "@ail/core";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { requestCount, RequestsPanel } from "./RequestsPanel";

type DataState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; index: ShieldIndex; generatedAt: string; tipHeight: number | null };

const RISK_STYLE: Record<Risk, { label: string; badge: string; ring: string; icon: string }> = {
  high: { label: "High risk", badge: "bg-rose-500/20 text-rose-200 ring-rose-400/50", ring: "border-rose-400/40", icon: "▲" },
  medium: { label: "Medium risk", badge: "bg-amber-500/20 text-amber-100 ring-amber-300/50", ring: "border-amber-300/40", icon: "◆" },
  low: { label: "Low risk", badge: "bg-emerald-500/20 text-emerald-100 ring-emerald-300/50", ring: "border-emerald-300/40", icon: "●" },
};

const POOL_LABEL: Record<string, string> = { sprout: "Sprout", sapling: "Sapling", orchard: "Orchard", ironwood: "Ironwood" };

const shortTx = (txid: string) => `${txid.slice(0, 10)}…${txid.slice(-6)}`;

export function CheckClient() {
  const [data, setData] = useState<DataState>({ status: "loading" });
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [checked, setChecked] = useState<string>("");
  const [checksRun, setChecksRun] = useState(0);
  const [requestsAtLastCheck, setRequestsAtLastCheck] = useState<number | null>(null);
  const inputId = useId();
  const errorId = useId();
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    // Always revalidate: recent deposits matter most, so never check against a stale browser copy.
    fetch("/api/v1/shields", { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<ShieldsPayload>;
      })
      .then((p) => {
        if (!cancelled) setData({ status: "ready", index: new ShieldIndex(decodeShields(p)), generatedAt: p.generatedAt, tipHeight: p.tipHeight });
      })
      .catch(() => {
        if (!cancelled) setData({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = (raw: string) => {
    const parsed = parseZecToZat(raw);
    if (!parsed.ok) {
      setError(parsed.error);
      setResult(null);
      return;
    }
    if (data.status !== "ready") return;
    setError(null);
    setInput(raw);
    setChecked(formatZec(parsed.zat));
    setResult(checkWithdrawal(parsed.zat, Date.now(), data.index));
    setChecksRun((n) => n + 1);
    setRequestsAtLastCheck(requestCount());
    requestAnimationFrame(() => resultRef.current?.focus());
  };

  const status = useMemo(() => {
    if (data.status === "loading") return "Downloading recent deposits…";
    if (data.status === "error") return "Recent deposits could not be loaded. Please try again later.";
    const mins = Math.max(0, Math.round((Date.now() - Date.parse(data.generatedAt)) / 60_000));
    const detail = [
      data.tipHeight ? `up to block ${data.tipHeight.toLocaleString("en-US")}` : null,
      `updated ${mins <= 1 ? "just now" : `${mins} minutes ago`}`,
    ].filter(Boolean);
    return `${data.index.size.toLocaleString("en-US")} deposits from the last 30 days loaded (${detail.join(", ")}).`;
  }, [data]);

  return (
    <div className="space-y-6">
      <form
        className="glass space-y-4 p-5 sm:p-6"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          run(input);
        }}
      >
        <div className="space-y-2">
          <label htmlFor={inputId} className="block font-medium">
            Amount you plan to withdraw (ZEC)
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
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
              className="min-h-12 flex-1 rounded-xl border border-white/20 bg-white/10 px-4 font-mono text-lg text-white placeholder:text-white/40 focus:border-amber-300/70"
            />
            <button
              type="submit"
              disabled={data.status !== "ready"}
              className="min-h-12 rounded-xl bg-amber-300 px-6 font-semibold text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Check
            </button>
          </div>
          {error && (
            <p id={errorId} className="text-sm text-rose-200">
              {error}
            </p>
          )}
        </div>
        <p className="text-sm text-(--ink-muted)" role="status">
          {status}
        </p>
      </form>

      <div ref={resultRef} tabIndex={-1} aria-live="polite" aria-atomic="true" className="outline-none">
        {result && <ResultCard result={result} amount={checked} onTry={(zat) => run(formatZec(zat).replace(/,/g, ""))} />}
      </div>

      <RequestsPanel checksRun={checksRun} requestsAtLastCheck={requestsAtLastCheck} />
    </div>
  );
}

function ResultCard({ result, amount, onTry }: { result: CheckResult; amount: string; onTry: (zat: number) => void }) {
  if (result.kind !== "result") {
    return (
      <section className="glass p-5 sm:p-6" aria-label="Result">
        <h2 className="text-lg font-semibold">{amount} ZEC</h2>
        <p className="mt-2 text-(--ink-muted)">{result.message}</p>
      </section>
    );
  }
  const style = RISK_STYLE[result.risk];
  const { wait, commonAmounts, split } = result.suggestions;
  return (
    <section className={`glass space-y-5 border p-5 sm:p-6 ${style.ring}`} aria-label="Result">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ring-1 ${style.badge}`}>
          <span aria-hidden="true">{style.icon}</span>
          {style.label}
        </span>
        <h2 className="text-lg font-semibold">Withdrawing {amount} ZEC</h2>
      </div>

      <ul className="space-y-1.5 leading-relaxed">
        {result.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>

      <p className="text-sm text-(--ink-muted)">
        Matching deposits in the last 30 days: <strong className="text-white">{result.anonymitySet}</strong>
        {result.exactCount > 0 && <> ({result.exactCount} exact)</>}.
      </p>

      {result.matches.length > 0 && result.risk !== "low" && (
        <div className="space-y-2">
          <h3 className="font-semibold">Matching deposits</h3>
          {/* relative: keeps the visually hidden cells inside the scroll area on narrow screens */}
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">Recent deposits that match this amount</caption>
              <thead className="text-(--ink-muted)">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 font-medium">When</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Amount (ZEC)</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Pool</th>
                  <th scope="col" className="py-1.5 font-medium">Transaction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {result.matches.map((m) => (
                  <tr key={m.txid}>
                    <td className="py-2 pr-3">
                      <time dateTime={new Date(m.time).toISOString()} title={new Date(m.time).toUTCString()}>
                        {describeAge(m.ageMs)} ago
                      </time>
                    </td>
                    <td className="py-2 pr-3 font-mono">
                      {formatZec(m.amountZat)}
                      {m.kind === "near" && <span className="ml-1 text-xs text-(--ink-muted)">(+{formatZec(m.differenceZat)})</span>}
                    </td>
                    <td className="py-2 pr-3">{POOL_LABEL[m.pool] ?? m.pool}</td>
                    <td className="py-2 font-mono text-xs">
                      <span title={m.txid}>{shortTx(m.txid)}</span>
                      <span className="sr-only">full id {m.txid}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(wait || commonAmounts || split) && (
        <div className="space-y-4 rounded-2xl bg-white/5 p-4">
          <h3 className="font-semibold">What you could do</h3>
          {wait && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Wait</p>
              <ul className="flex flex-wrap gap-2 text-sm">
                {wait.map((w) => (
                  <li key={w.afterDays} className={`rounded-full px-3 py-1 ring-1 ${RISK_STYLE[w.risk].badge}`}>
                    in {w.afterDays} day{w.afterDays === 1 ? "" : "s"}: {w.risk}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-(--ink-muted)">
                Waiting weakens timing links. Anyone who keeps full history can still match a unique amount.
              </p>
            </div>
          )}
          {commonAmounts && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Use a common amount instead</p>
              <ul className="flex flex-wrap gap-2">
                {commonAmounts.map((c) => (
                  <li key={c.amountZat}>
                    <button
                      type="button"
                      onClick={() => onTry(c.amountZat)}
                      className="rounded-full bg-white/10 px-3 py-1.5 text-sm ring-1 ring-white/20 hover:bg-white/15"
                    >
                      <span className="font-mono">{formatZec(c.amountZat)}</span> ZEC · blends with {c.anonymitySet}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-(--ink-muted)">Leave the rest shielded. Select an amount to check it.</p>
            </div>
          )}
          {split && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Split it</p>
              <p className="text-sm">
                Withdraw{" "}
                {split.map((s, i) => (
                  <span key={`${s.amountZat}-${i}`}>
                    {i > 0 && (i === split.length - 1 ? " and " : ", ")}
                    <span className="font-mono">{formatZec(s.amountZat)}</span>
                  </span>
                ))}{" "}
                ZEC separately.
              </p>
              <p className="text-xs text-(--ink-muted)">
                Send the parts hours or days apart, to different addresses. Parts sent together can be added back up.
              </p>
            </div>
          )}
        </div>
      )}

      <p className="text-xs leading-relaxed text-(--ink-muted)">{result.caveat}</p>
    </section>
  );
}
