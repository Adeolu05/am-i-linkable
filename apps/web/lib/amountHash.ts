// Handing an amount from the home page to /check without it touching a URL.
//
// The amount is kept in this module's memory, which survives the client-side
// navigation to /check, and /check takes it once. It never enters the address
// bar, the browser history, storage or a request. Opening /check any other way
// (a new tab, a reload) simply starts empty.
//
// The two examples are fixed words, not anything the user typed, so they travel
// in the fragment (/check#risky) and also work from a link. Any other fragment
// is ignored: an amount in a URL would end up in the browser's history.

export type HashIntent = { kind: "amount"; raw: string } | { kind: "example"; which: "risky" | "common" } | null;

let pending: string | null = null;

/** Keeps an amount for /check to take on its next mount. */
export function handOverAmount(value: string): void {
  pending = value.trim();
}

/** The amount handed over by the home page, once; null afterwards. */
export function takeHandedAmount(): string | null {
  const v = pending;
  pending = null;
  return v;
}

/** An example named in the fragment; anything else (including an amount) is null. */
export function readAmountHash(hash: string): HashIntent {
  const s = hash.replace(/^#/, "");
  return s === "risky" || s === "common" ? { kind: "example", which: s } : null;
}

/** The /check URL for one of the two examples. */
export function exampleHref(which: "risky" | "common"): string {
  return `/check#${which}`;
}

/** Removes the fragment from the address bar without reloading or adding history. */
export function clearHash(): void {
  if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
}
