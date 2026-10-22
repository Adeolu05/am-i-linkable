import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { LogoMark } from "@/components/icons";
import "./globals.css";

// next/font downloads these at build time and serves them from our own origin,
// so visitors' browsers never contact a font CDN.
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Am I Linkable?", template: "%s · Am I Linkable?" },
  description:
    "A free tool that tells Zcash users whether their transparent-to-shielded movements can be linked, without learning what they checked.",
  referrer: "no-referrer",
};

export const viewport: Viewport = { themeColor: "#070b18", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${inter.variable} ${mono.variable}`}>
      {/* suppressHydrationWarning: browser extensions add attributes to <body> before React hydrates. */}
      <body className="flex min-h-dvh flex-col font-sans antialiased" suppressHydrationWarning>
        <div className="scene" aria-hidden="true">
          <div className="blob blob-navy" />
          <div className="blob blob-teal" />
          <div className="blob blob-gold" />
        </div>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-gold focus:px-3 focus:py-2 focus:font-semibold focus:text-night"
        >
          Skip to content
        </a>
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 pt-5 sm:px-6">
          <Link href="/" prefetch={false} className="group flex items-center gap-2.5 rounded-full py-1 pr-2">
            <LogoMark className="h-8 w-8" />
            <span className="font-display text-base font-semibold tracking-tight sm:text-lg">Am I Linkable?</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-2">
            {[
              ["/check", "Check an amount", "Amount"],
              ["/linked", "Have I been linked?", "Address"],
            ].map(([href, full, short]) => (
              <Link
                key={href}
                href={href!}
                prefetch={false}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-ink transition hover:border-gold/60 hover:text-white sm:px-4"
              >
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{full}</span>
              </Link>
            ))}
          </nav>
        </header>
        <div id="main" className="flex flex-1 flex-col">
          {children}
        </div>
        <footer className="mx-auto w-full max-w-6xl px-4 pb-8 pt-12 text-center text-sm text-ink-faint sm:px-6">
          Public chain data from{" "}
          <a href="https://3xpl.com" rel="noreferrer noopener" className="underline decoration-white/30 underline-offset-2 hover:text-ink">
            3xpl
          </a>
          . No cookies, accounts or analytics. Open source under the MIT license.
        </footer>
      </body>
    </html>
  );
}
