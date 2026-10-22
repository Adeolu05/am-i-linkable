import type { Metadata } from "next";
import { CheckClient } from "./CheckClient";

export const metadata: Metadata = {
  title: "Before you move",
  description: "Check whether withdrawing an amount from a Zcash shielded pool could be linked to a recent deposit. Runs entirely in your browser.",
};

const how = [
  ["Same file for everyone", "Opening this page downloads every deposit into the shielded pools from the last 30 days. Everyone gets identical bytes, so the download says nothing about you."],
  ["Checked on your device", "Pressing run compares your amount with those deposits in this page. Nothing is sent; the network log shows it."],
  ["Why amounts matter", "A withdrawal is easiest to link when only one or two recent deposits have the same amount, or the same plus a typical fee. Many matches means you blend in."],
  ["A risk signal, not proof", "Someone with more information, such as exchange records, may know more. A low result does not guarantee privacy."],
];

export default function CheckPage() {
  return (
    <main className="mx-auto w-full max-w-[1220px] space-y-10 px-4 pt-10 sm:px-7">
      <div className="max-w-3xl space-y-3.5">
        <p className="r up text-accent" style={{ "--i": 0 } as React.CSSProperties}>
          Before you move
        </p>
        <h1 className="wipe text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.05] tracking-[-0.04em]">
          <span>Could this withdrawal</span>
          <span>be linked?</span>
        </h1>
        <p className="r text-[15px] leading-relaxed text-ink-muted" style={{ "--i": 3 } as React.CSSProperties}>
          Enter the amount you plan to move out of a shielded pool to a transparent address. See how many recent
          deposits it could be matched to. Your amount never leaves this device.
        </p>
      </div>

      <CheckClient />

      <section id="how" aria-labelledby="how-title" className="scroll-mt-6">
        <div className="sh">
          <span className="n">··</span>
          <h2 id="how-title">How this works</h2>
        </div>
        <ol className="cells grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 max-lg:[&>*:nth-child(3)]:border-l-0 max-lg:[&>*:nth-child(n+3)]:border-t max-sm:[&>*]:border-l-0 max-sm:[&>*+*]:border-t [&>*]:border-line">
          {how.map(([title, body], i) => (
            <li key={title}>
              <p className="text-xs tracking-[0.14em] text-accent">0{i + 1}</p>
              <h3 className="mt-2.5 text-base font-semibold">{title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
