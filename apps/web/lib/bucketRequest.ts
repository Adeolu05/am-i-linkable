// Strict parsing of GET /api/v1/buckets/[bits]/[prefix]. Anything that is not
// exactly a bucket id under some plan is rejected before any lookup happens.

export const MAX_BUCKET_BITS = 24;

export type BucketRequest = { ok: true; bits: number; prefix: string; index: number } | { ok: false; error: string };

/** Hex characters a bucket id has under a plan of `bits` bits. */
export const prefixLength = (bits: number) => Math.max(1, Math.ceil(bits / 4));

export function parseBucketRequest(bitsRaw: string, prefixRaw: string, search: string): BucketRequest {
  if (search !== "") return { ok: false, error: "This endpoint takes no parameters." };
  if (!/^(0|[1-9][0-9]?)$/.test(bitsRaw)) return { ok: false, error: "Invalid bucket bit length." };
  const bits = Number(bitsRaw);
  if (bits > MAX_BUCKET_BITS) return { ok: false, error: "Invalid bucket bit length." };
  if (!/^[0-9a-f]+$/.test(prefixRaw) || prefixRaw.length !== prefixLength(bits)) return { ok: false, error: "Invalid bucket id." };
  const index = parseInt(prefixRaw, 16);
  if (index >= 2 ** bits) return { ok: false, error: "Invalid bucket id." };
  return { ok: true, bits, prefix: prefixRaw, index };
}
