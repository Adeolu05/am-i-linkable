import type { Metadata } from "next";
import { LinkedClient } from "./LinkedClient";

export const metadata: Metadata = {
  title: "Have I been linked?",
  description:
    "Check whether a transparent Zcash address's recent shield and unshield activity may be linkable, without telling the server which address you checked.",
};

const how = [
  ["Checked on your device", "The address is validated and hashed (SHA-256) in this page. Neither the address nor its hash is sent anywhere."],
  ["One bucket, shared by many", "Only the bucket your hash falls into is downloaded: a file with the hashes of about 1,200 addresses. The server learns the bucket number, nothing more."],
  ["Or all of them", "Paranoid mode downloads every bucket, so the server cannot even tell which bucket you needed."],
  ["Counts, not counterparties", "Each event shows how many other deposits or withdrawals matched it, never who made them."],
];

export default function LinkedPage() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-4 pb-6 pt-10 sm:px-6">
      <div className="animate-rise max-w-3xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">Have I been linked?</p>
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">Could your past moves be linked?</h1>
        <p className="text-lg leading-relaxed text-ink-muted">
          Paste a transparent address you used to move ZEC into or out of a shielded pool. See which of its deposits and withdrawals from the last 30 days
          stand out, without telling us which address you checked.
        </p>
      </div>

      <LinkedClient />

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
