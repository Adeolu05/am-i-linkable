import type { Metadata } from "next";
import { CheckClient } from "./CheckClient";

export const metadata: Metadata = {
  title: "Before you move",
  description: "Check whether withdrawing an amount from a Zcash shielded pool could be linked to a recent deposit. Runs entirely in your browser.",
};

const how = [
  ["Same file for everyone", "Opening this page downloads every deposit into the shielded pools from the last 30 days. Everyone gets identical bytes, so the download says nothing about you."],
  ["Checked on your device", "Pressing Check compares your amount with those deposits in this page. Nothing is sent; the privacy receipt shows it."],
  ["Why amounts matter", "A withdrawal is easiest to link when only one or two recent deposits have the same amount, or the same plus a typical fee. Many matches means you blend in."],
  ["A risk signal, not proof", "Someone with more information, such as exchange records, may know more. A low result does not guarantee privacy."],
];

export default function CheckPage() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-4 pb-6 pt-10 sm:px-6">
      <div className="animate-rise max-w-3xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">Before you move</p>
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">Could this withdrawal be linked?</h1>
        <p className="text-lg leading-relaxed text-ink-muted">
          Enter the amount you plan to move out of a shielded pool to a transparent address. See how many recent
          deposits it could be matched to. Your amount never leaves this device.
        </p>
      </div>

      <CheckClient />

      <section aria-labelledby="how" className="space-y-4">
        <h2 id="how" className="font-display text-2xl font-semibold tracking-tight">
          How this works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {how.map(([title, body], i) => (
            <li key={title} className="glass p-5">
              <p className="font-mono text-sm text-gold">0{i + 1}</p>
              <h3 className="mt-2 font-display text-lg font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
