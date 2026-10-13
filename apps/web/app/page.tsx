export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-4 py-16">
      <p className="font-mono text-sm uppercase tracking-widest text-amber-700 dark:text-amber-400">
        Zcash privacy check
      </p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Am I Linkable?</h1>
      <p className="text-lg leading-relaxed text-stone-600 dark:text-stone-300">
        Moving ZEC between transparent addresses and the shielded pools leaves public traces. This
        tool will show whether those movements can be linked by amount and timing, with every check
        running in your browser. The server never learns what you looked up.
      </p>
      <ul className="space-y-2 text-stone-700 dark:text-stone-300">
        <li>
          <span className="font-medium">Before you move:</span> check a planned amount against recent
          shielding activity.
        </li>
        <li>
          <span className="font-medium">Have I been linked?</span> check a transparent address with a
          k-anonymous range query.
        </li>
        <li>
          <span className="font-medium">Pool weather:</span> public aggregate stats.
        </li>
      </ul>
      <p className="text-sm text-stone-500">Under construction. No cookies, accounts or analytics.</p>
    </main>
  );
}
