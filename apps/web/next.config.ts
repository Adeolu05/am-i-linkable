import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import type { NextConfig } from "next";

// Content-Security-Policy. Every page is static, so scripts can't carry a
// per-request nonce; instead the inline scripts Next.js writes into each page
// are allowed by their SHA-256 hashes. scripts/next.mjs builds twice with the
// same build id: the first build is only read to collect the hashes, and the
// second serves them in this header. Without hashes (a plain `next build`, or
// a mismatch scripts/next.mjs detected) scripts fall back to 'self' plus
// inline: weaker, but the pages work and every other directive still applies.
// The fallback is announced in the build log, and privacy-audit.mjs fails on it.
function contentSecurityPolicy(phase: string): string {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  const hashes = (process.env.AIL_CSP_SCRIPT_HASHES ?? "").split(/\s+/).filter(Boolean);
  if (phase === PHASE_PRODUCTION_BUILD && hashes.length === 0 && process.env.AIL_CSP_PASS !== "collect") {
    console.warn("[csp] WARNING: no script hashes supplied; scripts fall back to 'unsafe-inline'. Build with `pnpm build` (scripts/next.mjs).");
  }
  const scripts = dev ? "'self' 'unsafe-inline' 'unsafe-eval'" : hashes.length > 0 ? `'self' ${hashes.map((h) => `'${h}'`).join(" ")}` : "'self' 'unsafe-inline'";
  return [
    "default-src 'self'",
    `script-src ${scripts}`,
    // React writes some style="" attributes; styles cannot run code, and every
    // fetch below is limited to this origin, so they cannot send data anywhere.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "worker-src 'none'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// Every powerful browser feature, switched off for this origin and any frame.
const permissionsPolicy = [
  "accelerometer", "ambient-light-sensor", "autoplay", "bluetooth", "browsing-topics", "camera",
  "clipboard-read", "clipboard-write", "display-capture", "encrypted-media", "fullscreen", "gamepad",
  "geolocation", "gyroscope", "hid", "identity-credentials-get", "idle-detection", "local-fonts",
  "magnetometer", "microphone", "midi", "otp-credentials", "payment", "picture-in-picture",
  "publickey-credentials-create", "publickey-credentials-get", "screen-wake-lock", "serial",
  "storage-access", "usb", "web-share", "window-management", "xr-spatial-tracking",
].map((f) => `${f}=()`).join(", ");

export default function config(phase: string): NextConfig {
  return {
    poweredByHeader: false,
    // Do not let `next dev` write tooling instruction files into the repo.
    agentRules: false,
    // packages/core ships TypeScript source.
    transpilePackages: ["@ail/core"],
    // Keep pg as a plain Node dependency on the server.
    serverExternalPackages: ["pg"],
    // Both CSP passes must produce the same pages (scripts/next.mjs sets this).
    generateBuildId: () => process.env.AIL_BUILD_ID ?? null,
    async headers() {
      return [
        {
          source: "/:path*",
          headers: [
            { key: "Content-Security-Policy", value: contentSecurityPolicy(phase) },
            { key: "Referrer-Policy", value: "no-referrer" },
            { key: "Permissions-Policy", value: permissionsPolicy },
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "X-Frame-Options", value: "DENY" },
            { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
            { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
            { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
            { key: "X-DNS-Prefetch-Control", value: "off" },
          ],
        },
      ];
    },
  };
}
