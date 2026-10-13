// Environment loading and secret redaction.
//
// Secrets (DATABASE_URL*, THREEXPL_*_KEY) are read from indexer/.env locally or
// from the platform's environment in production. They must never reach logs:
// every error message that leaves this process goes through `redact`.

import path from "node:path";
import dotenv from "dotenv";

export const INDEXER_ROOT = path.resolve(import.meta.dirname, "..");
export const REPO_ROOT = path.resolve(INDEXER_ROOT, "..");
export const DATA_DIR = path.join(REPO_ROOT, "data");

const SECRET_VARS = ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "THREEXPL_API_KEY", "THREEXPL_DUMPS_KEY"] as const;

export function loadEnv(): void {
  // Existing environment variables win, so platform-provided values are never overridden.
  dotenv.config({ path: path.join(INDEXER_ROOT, ".env"), quiet: true });
}

/** Every secret value plus, for connection strings, each component that could identify the server. */
function secretFragments(): string[] {
  const out = new Set<string>();
  for (const name of SECRET_VARS) {
    const value = process.env[name]?.trim();
    if (!value) continue;
    out.add(value);
    if (name.startsWith("DATABASE_URL")) {
      try {
        const u = new URL(value);
        for (const part of [u.hostname, u.username, u.password, decodeURIComponent(u.password), u.pathname.slice(1)]) {
          if (part && part.length >= 4) out.add(part);
        }
        // Neon endpoint ids appear on their own in some driver errors.
        const endpoint = u.hostname.split(".")[0];
        if (endpoint && endpoint.length >= 4) out.add(endpoint.replace(/-pooler$/, ""));
      } catch {
        // Not a URL; the whole value is already covered.
      }
    }
  }
  // Longest first so a full value is replaced before its parts.
  return [...out].sort((a, b) => b.length - a.length);
}

export function redact(text: string): string {
  let s = text;
  for (const fragment of secretFragments()) s = s.split(fragment).join("[redacted]");
  return s.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]");
}

/** A log-safe one-line description of an error. Never includes stacks or connection details. */
export function describeError(err: unknown): string {
  const e = err as { message?: unknown; code?: unknown };
  const message = typeof e?.message === "string" ? e.message : String(err);
  const code = typeof e?.code === "string" ? ` [${e.code}]` : "";
  return redact(`${message}${code}`.replace(/\s+/g, " ").trim());
}

export function requireEnv(name: string, hint: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set. ${hint}`);
  return v;
}
