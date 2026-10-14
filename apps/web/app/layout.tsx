import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

// next/font downloads these at build time and serves them from our own origin,
// so visitors' browsers never contact a font CDN.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Am I Linkable?", template: "%s · Am I Linkable?" },
  description:
    "A free tool that tells Zcash users whether their transparent-to-shielded movements can be linked, without learning what they checked.",
  referrer: "no-referrer",
};

export const viewport: Viewport = { themeColor: "#0a0e1c", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="flex min-h-dvh flex-col font-sans antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-amber-300 focus:px-3 focus:py-2 focus:text-slate-950"
        >
          Skip to content
        </a>
        <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-6">
          <Link href="/" prefetch={false} className="font-semibold tracking-tight text-(--ink)">
            Am I Linkable?
          </Link>
          <nav aria-label="Main">
            <Link href="/check" prefetch={false} className="rounded-full px-3 py-1.5 text-sm text-(--ink-muted) hover:text-white">
              Before you move
            </Link>
          </nav>
        </header>
        <div id="main" className="flex flex-1 flex-col">
          {children}
        </div>
        <footer className="mx-auto w-full max-w-3xl px-4 pb-8 pt-10 text-center text-sm text-(--ink-muted)">
          Public chain data from{" "}
          <a href="https://3xpl.com" rel="noreferrer noopener" className="underline decoration-white/40 underline-offset-2 hover:text-white">
            3xpl
          </a>
          . No cookies, accounts or analytics. Open source under the MIT license.
        </footer>
      </body>
    </html>
  );
}
