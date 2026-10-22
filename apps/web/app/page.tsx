import Link from "next/link";
import { ProofStrip } from "@/components/ProofStrip";
import { ArrowRightIcon, CheckCircleIcon, CrowdIcon, DeviceIcon, DownloadIcon, LockIcon } from "@/components/icons";

const steps = [
  {
    icon: DownloadIcon,
    title: "Get the same file as everyone",
    body: "Your browser downloads every deposit into the shielded pools from the last 30 days. Everyone gets identical bytes.",
  },
  {
    icon: DeviceIcon,
    title: "Check on your device",
    body: "You type an amount. It is compared with those deposits right here in the page. Nothing is sent.",
  },
  {
    icon: CrowdIcon,
    title: "See your crowd",
    body: "Stand out or blend in? You get a risk level, the matching deposits, and ways to lower the risk.",
  },
];

const promises = ["Your amount never leaves your device", "No cookies, accounts or analytics", "No third-party requests, fonts or scripts", "Public chain data only"];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-16 px-4 pb-6 pt-12 sm:px-6 sm:pt-16 lg:space-y-20">
      <section className="animate-rise grid items-center gap-10 lg:grid-cols-[1.15fr_1fr]" aria-labelledby="hero">
        <div className="space-y-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-gold">
            <LockIcon className="h-3.5 w-3.5" />
            Zcash privacy check
          </p>
          <h1 id="hero" className="font-display text-5xl font-bold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
            Your amount can <span className="text-gold">give you away.</span>
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-ink-muted">
            Moving ZEC out of a shielded pool? See whether the amount could be matched to a recent deposit, checked
            entirely in your browser, so nobody learns what you looked up.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/check"
              prefetch={false}
              className="group inline-flex min-h-14 items-center gap-3 rounded-2xl bg-gold px-7 text-lg font-semibold text-night shadow-glow-gold transition hover:bg-gold-bright"
            >
              Check an amount
              <ArrowRightIcon className="h-5 w-5 transition group-hover:translate-x-1" />
            </Link>
            <a href="#how" className="rounded-xl px-4 py-3 font-medium text-ink-muted hover:text-ink">
              How it works
            </a>
          </div>
        </div>
        <ProofStrip />
      </section>

      <section id="how" aria-labelledby="how-title" className="space-y-6">
        <h2 id="how-title" className="font-display text-3xl font-semibold tracking-tight">
          How it works
        </h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="glass p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-gold/12 text-gold ring-1 ring-gold/30">
                  <Icon className="h-6 w-6" />
                </span>
                <span className="font-mono text-sm text-ink-faint">Step {i + 1}</span>
              </div>
              <h3 className="mt-4 font-display text-xl font-semibold">{title}</h3>
              <p className="mt-2 leading-relaxed text-ink-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="glass p-6 sm:p-8" aria-labelledby="promise">
          <h2 id="promise" className="font-display text-2xl font-semibold tracking-tight">
            The privacy promise
          </h2>
          <p className="mt-2 max-w-xl text-ink-muted">
            A privacy tool should not become a new leak. This site is built so its operators cannot learn what you
            check.
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {promises.map((p) => (
              <li key={p} className="tile flex items-start gap-3 p-3.5">
                <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-risk-low" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <Link
          href="/linked"
          prefetch={false}
          className="glass group flex flex-col justify-between gap-6 p-6 transition hover:border-gold/50 sm:p-8"
          aria-labelledby="linked-card"
        >
          <div>
            <p className="inline-flex rounded-full border border-risk-low/40 bg-risk-low/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-risk-low">
              Live
            </p>
            <h2 id="linked-card" className="mt-4 font-display text-2xl font-semibold tracking-tight">
              Have I been linked?
            </h2>
            <p className="mt-2 text-ink-muted">
              Check a transparent address you already used, with a k-anonymous lookup: only a short hash prefix
              leaves your device, and you get back a whole bucket of addresses to search locally.
            </p>
          </div>
          <p className="inline-flex items-center gap-2 font-medium text-white">
            Check an address
            <ArrowRightIcon className="h-5 w-5 transition group-hover:translate-x-1" />
          </p>
        </Link>
      </section>
    </main>
  );
}
