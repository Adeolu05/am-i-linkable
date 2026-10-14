import type { Metadata } from "next";
import { CheckClient } from "./CheckClient";

export const metadata: Metadata = {
  title: "Before you move",
  description: "Check whether withdrawing an amount from a Zcash shielded pool could be linked to a recent deposit. Runs entirely in your browser.",
};

export default function CheckPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-10">
      <div className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber-300">Before you move</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Could this withdrawal be linked?</h1>
        <p className="max-w-2xl leading-relaxed text-(--ink-muted)">
          Planning to move ZEC out of a shielded pool to a transparent address? Enter the amount to see whether it
          could be matched to a recent deposit by amount and timing. The check runs in your browser; your amount
          is never sent anywhere.
        </p>
      </div>

      <CheckClient />

      <section aria-labelledby="how" className="glass space-y-3 p-5 sm:p-6">
        <h2 id="how" className="text-lg font-semibold">
          How this works
        </h2>
        <ol className="list-decimal space-y-2 pl-5 leading-relaxed text-(--ink-muted)">
          <li>
            When you open this page, it downloads every deposit into the shielded pools from the last 30 days. Everyone
            gets the same file, so downloading it says nothing about you.
          </li>
          <li>
            When you press Check, code on this page compares your amount with those deposits, on your device. Nothing
            is sent.
          </li>
          <li>
            A withdrawal is easiest to link when only one or two recent deposits have the same amount, or the same
            amount plus a typical fee. If many deposits match, yours blends in.
          </li>
          <li>
            Results are a risk indicator based on public data, not proof. Someone with more information (such as
            exchange records) may know more. A low result does not guarantee privacy.
          </li>
        </ol>
      </section>
    </main>
  );
}
