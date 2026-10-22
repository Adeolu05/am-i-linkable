import Link from "next/link";
import { HomePrompt } from "@/components/HomePrompt";
import { StatsStrip, StatsWindow } from "@/components/LiveStats";
import { Cmd, Ln, Win } from "@/components/Term";

const steps = [
  ["01 · download", "The same file for everyone", "Your browser downloads every deposit into the shielded pools from the last 30 days. Everyone gets identical bytes."],
  ["02 · match", "On your machine", "You type an amount. It is compared with those deposits right here in the page. Nothing is sent."],
  ["03 · read", "Stand out or blend in", "You get a risk level, the matching deposits, and ways to lower the risk. A risk signal, not proof."],
];

const promises = ["Your amount never leaves your device", "No cookies, accounts or analytics", "No third-party requests, fonts or scripts", "Public chain data only"];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-[1220px] space-y-16 px-4 pt-12 sm:px-7 lg:space-y-20">
      <section className="grid items-start gap-11 lg:grid-cols-[0.9fr_1.1fr]" aria-labelledby="hero">
        <div className="min-w-0 space-y-7">
          <p className="r up flex items-center gap-3" style={{ "--i": 0 } as React.CSSProperties}>
            <span className="st live text-accent" aria-hidden="true">
              <i />
            </span>
            Zcash privacy check · runs in your browser
          </p>
          <h1 id="hero" className="wipe text-[clamp(34px,4.6vw,62px)] font-semibold leading-[1.02] tracking-[-0.04em]">
            <span>Checked here.</span>
            <span className="text-accent">Sent nowhere.</span>
          </h1>
          <p className="r max-w-[46ch] text-[15px] leading-relaxed text-ink-muted" style={{ "--i": 3 } as React.CSSProperties}>
            Before you move ZEC out of a shielded pool, see whether the amount could be matched to a recent deposit. The
            match runs on this machine; the network log on the check page proves it.
          </p>
          <div className="r" style={{ "--i": 4 } as React.CSSProperties}>
            <HomePrompt />
          </div>
        </div>
        <div className="r min-w-0" style={{ "--i": 2 } as React.CSSProperties}>
          <StatsWindow />
        </div>
      </section>

      <StatsStrip />

      <section id="how" aria-labelledby="how-title" className="scroll-mt-6">
        <div className="sh">
          <span className="n">01</span>
          <h2 id="how-title">How it works</h2>
        </div>
        <ol className="cells grid-cols-1 md:grid-cols-3 max-md:[&>*]:border-l-0 max-md:[&>*+*]:border-t [&>*]:border-line">
          {steps.map(([n, title, body]) => (
            <li key={n}>
              <p className="text-xs tracking-[0.14em] text-accent">{n}</p>
              <h3 className="mt-2.5 text-base font-semibold">{title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Win title="cat PROMISES" aria-labelledby="promise">
          <div className="term">
            <h2 id="promise" className="sr-only">
              The privacy promise
            </h2>
            <Cmd i={0}>cat PROMISES</Cmd>
            <Ln i={1} className="text-ink-muted">
              {"# a privacy tool should not become a new leak. this site is built so its operators cannot learn what you check."}
            </Ln>
            {promises.map((p, i) => (
              <Ln key={p} i={i + 2}>
                <span className="text-risk-low">✓</span> {p}
              </Ln>
            ))}
          </div>
        </Win>
        <Link
          href="/linked"
          prefetch={false}
          className="group flex flex-col justify-between gap-6 border-y border-line py-6 transition-colors hover:border-line-strong"
          aria-labelledby="linked-card"
        >
          <div>
            <span className="st text-risk-low">
              <i />
              live
            </span>
            <h2 id="linked-card" className="mt-4 text-xl font-semibold tracking-[-0.02em]">
              Have I been linked?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Check a transparent address you already used, with a k-anonymous lookup: only a short hash prefix leaves
              your device, and you get back a whole bucket of addresses to search locally.
            </p>
          </div>
          <p className="text-sm font-medium text-ink">
            <span className="text-accent">$</span> check an address{" "}
            <span className="inline-block text-accent transition-transform duration-300 group-hover:translate-x-1">→</span>
          </p>
        </Link>
      </section>
    </main>
  );
}
