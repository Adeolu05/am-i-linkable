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
    <main className="mx-auto w-full max-w-[1220px] space-y-10 px-4 pt-10 sm:px-7">
      <div className="max-w-3xl space-y-3.5">
        <p className="r up text-accent" style={{ "--i": 0 } as React.CSSProperties}>
          Have I been linked?
        </p>
        <h1 className="wipe text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.05] tracking-[-0.04em]">
          <span>Could your past moves</span>
          <span>be linked?</span>
        </h1>
        <p className="r text-[15px] leading-relaxed text-ink-muted" style={{ "--i": 3 } as React.CSSProperties}>
          Paste a transparent address you used to move ZEC into or out of a shielded pool. See which of its deposits and withdrawals from the last 30 days
          stand out, without telling us which address you checked.
        </p>
      </div>

      <LinkedClient />

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
