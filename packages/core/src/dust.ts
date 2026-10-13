// Dust: amounts this small are moved in large numbers by automated senders,
// so matching them says nothing useful about any one user.

/** 0.001 ZEC. Amounts at or below this are dust. */
export const DUST_THRESHOLD_ZAT = 100_000n;

export const DUST_MESSAGE = "This amount is too small and common to match meaningfully.";

export function isDust(amountZat: bigint | string): boolean {
  return BigInt(amountZat) <= DUST_THRESHOLD_ZAT;
}
