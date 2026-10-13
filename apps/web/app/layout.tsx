import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// next/font downloads these at build time and serves them from our own origin,
// so visitors' browsers never contact a font CDN.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Am I Linkable?",
  description:
    "A free tool that tells Zcash users whether their transparent-to-shielded movements can be linked, without learning what they checked.",
  referrer: "no-referrer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="flex min-h-dvh flex-col font-sans">
        <div className="flex flex-1 flex-col">{children}</div>
        <footer className="border-t border-stone-200 px-4 py-6 text-center text-sm text-stone-500 dark:border-stone-800">
          Public chain data from{" "}
          <a
            href="https://3xpl.com"
            rel="noreferrer noopener"
            className="underline decoration-stone-400 underline-offset-2 hover:text-stone-700 dark:hover:text-stone-300"
          >
            3xpl
          </a>
          . Open source under the MIT license.
        </footer>
      </body>
    </html>
  );
}
