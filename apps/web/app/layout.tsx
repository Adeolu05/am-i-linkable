import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import { NavLinks, NavStatus, Ticker } from "@/components/Chrome";
import "./globals.css";

// next/font downloads the font at build time and serves it from our own origin,
// so visitors' browsers never contact a font CDN.
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Am I Linkable?", template: "%s · Am I Linkable?" },
  description:
    "A free tool that tells Zcash users whether their transparent-to-shielded movements can be linked, without learning what they checked.",
  referrer: "no-referrer",
};

export const viewport: Viewport = { themeColor: "#050807", colorScheme: "dark" };

// Entrance animations run only when the tab is visible and painting frames, so
// content never stays invisible in a background tab or a screenshot tool.
const animGate =
  "(function(){if(document.visibilityState!=='visible')return;var t=performance.now();requestAnimationFrame(function(){requestAnimationFrame(function(){if(performance.now()-t<250)document.documentElement.classList.add('anim')})})})();";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={mono.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: animGate }} />
      </head>
      {/* suppressHydrationWarning: browser extensions add attributes to <body> before React hydrates. */}
      <body className="flex min-h-dvh flex-col font-mono antialiased" suppressHydrationWarning>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:bg-accent focus:px-3 focus:py-2 focus:font-semibold focus:text-accent-ink"
        >
          Skip to content
        </a>
        <div className="mx-auto w-full max-w-[1220px] px-4 sm:px-7">
          <header className="flex h-[68px] items-center gap-5 border-b border-line sm:gap-8">
            <Link href="/" prefetch={false} className="flex shrink-0 items-center gap-3 text-[15px] font-semibold tracking-[0.02em]">
              <span className="h-[18px] w-[10px] bg-accent" aria-hidden="true" />
              <span className="hidden min-[400px]:inline">am-i-linkable</span>
              <span className="sr-only min-[400px]:hidden">Am I Linkable? home</span>
            </Link>
            <nav aria-label="Main">
              <NavLinks />
            </nav>
            <div className="ml-auto">
              <NavStatus />
            </div>
          </header>
          <Ticker />
        </div>
        <div id="main" className="flex flex-1 flex-col">
          {children}
        </div>
        <footer className="mx-auto mt-14 flex w-full max-w-[1220px] flex-wrap justify-between gap-3 border-t border-line px-4 pb-8 pt-4 text-[11px] text-ink-muted sm:px-7">
          <span>
            public chain data:{" "}
            <a href="https://3xpl.com" rel="noreferrer noopener" className="lnk">
              3xpl
            </a>{" "}
            · no cookies, accounts, analytics
          </span>
          <span>MIT · open source</span>
        </footer>
      </body>
    </html>
  );
}
