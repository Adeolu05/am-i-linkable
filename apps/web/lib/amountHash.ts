// Handing an amount from the home page to /check without telling the server.
//
// The amount travels in the URL fragment (/check#2.5). Browsers never send the
// fragment in a request, so the server only learns that /check was opened.
// /check reads it once, runs it, and clears it from the address bar.

export type HashIntent = { kind: "amount"; raw: string } | { kind: "example"; which: "risky" | "common" } | null;

/** Longest fragment we accept as an amount; anything longer is ignored, not parsed. */
const MAX_LEN = 40;

export function readAmountHash(hash: string): HashIntent {
  let s: string;
  try {
    s = decodeURIComponent(hash.replace(/^#/, "")).trim();
  } catch {
    return null; // malformed percent-encoding
  }
  if (s === "" || s.length > MAX_LEN) return null;
  if (s === "risky" || s === "common") return { kind: "example", which: s };
  return { kind: "amount", raw: s };
}

/** The /check URL for an amount or an example, with the value only in the fragment. */
export function checkHref(value: string): string {
  return `/check#${encodeURIComponent(value.trim())}`;
}

/** Removes the fragment from the address bar without reloading or adding history. */
export function clearHash(): void {
  if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
}
