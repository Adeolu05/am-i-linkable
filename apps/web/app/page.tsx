import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-4 py-14">
      <div className="space-y-5">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber-300">Zcash privacy check</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Am I Linkable?</h1>
        <p className="max-w-2xl text-lg leading-relaxed text-(--ink-muted)">
          Moving ZEC between transparent addresses and the shielded pools leaves public traces. See whether a
          move could be matched by amount and timing. Every check runs in your browser; the server never learns
          what you looked up.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/check" prefetch={false} className="glass group p-5 transition hover:border-amber-300/50 sm:col-span-2">
          <p className="text-sm text-amber-300">Available now</p>
          <h2 className="mt-1 text-xl font-semibold">Before you move</h2>
          <p className="mt-2 text-(--ink-muted)">
            Check an amount you plan to withdraw against recent deposits, before you send it.
          </p>
          <p className="mt-4 font-medium text-white">
            Check an amount <span aria-hidden="true" className="inline-block transition group-hover:translate-x-1">→</span>
          </p>
        </Link>
        <div className="glass p-5">
          <p className="text-sm text-(--ink-muted)">Coming soon</p>
          <h2 className="mt-1 text-lg font-semibold">Have I been linked?</h2>
          <p className="mt-2 text-sm text-(--ink-muted)">A k-anonymous check for a transparent address.</p>
        </div>
      </div>
    </main>
  );
}
