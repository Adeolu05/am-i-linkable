// k-anonymity buckets for the "Have I been linked?" range query.
//
// An address's bucket is the first `bits` bits of SHA-256(address), as an
// integer. The bit length is chosen from the current data: the largest value
// for which every one of the 2^bits buckets holds at least `minBucketSize`
// addresses.

export const DEFAULT_MIN_BUCKET_SIZE = 1_000;
export const MAX_BITS = 24;

export interface BucketPlan {
  /** Prefix length in bits. 0 means a single bucket holding everything. */
  bits: number;
  bucketCount: number;
  /** Smallest bucket size: the anonymity set we publish. */
  minBucketSize: number;
  maxBucketSize: number;
  totalAddresses: number;
  /** False when even a single bucket is below the target (too little data). */
  meetsTarget: boolean;
}

/** First 32 bits of a hex-encoded hash, as an unsigned integer. */
function head32(hashHex: string): number {
  if (!/^[0-9a-f]{8}/i.test(hashHex)) throw new Error("hash must be hex, at least 8 characters");
  return parseInt(hashHex.slice(0, 8), 16);
}

function checkBits(bits: number) {
  if (!Number.isInteger(bits) || bits < 0 || bits > MAX_BITS) throw new RangeError(`bits must be 0..${MAX_BITS}`);
}

/** Top `bits` bits of a hex-encoded hash, as an integer. */
export function bucketIndex(hashHex: string, bits: number): number {
  checkBits(bits);
  return bits === 0 ? 0 : head32(hashHex) >>> (32 - bits);
}

/** Bucket id as used in file names: lowercase hex, zero-padded to ceil(bits / 4) chars. */
export function bucketId(index: number, bits: number): string {
  checkBits(bits);
  return index.toString(16).padStart(Math.max(1, Math.ceil(bits / 4)), "0");
}

function bucketSizes(heads: number[], bits: number): { min: number; max: number } {
  const sizes = new Uint32Array(2 ** bits);
  for (const h of heads) sizes[bits === 0 ? 0 : h >>> (32 - bits)]!++;
  let min = Infinity;
  let max = 0;
  for (const s of sizes) {
    if (s < min) min = s;
    if (s > max) max = s;
  }
  return { min, max };
}

/** Picks the bucket bit length for a set of address hashes (hex, deduplicated here). */
export function planBuckets(hashesHex: Iterable<string>, minBucketSize = DEFAULT_MIN_BUCKET_SIZE): BucketPlan {
  const heads = [...new Set([...hashesHex].map((h) => h.toLowerCase()))].map(head32);
  let bits = 0;
  let sizes = bucketSizes(heads, 0);
  for (let b = 1; b <= MAX_BITS && heads.length >= minBucketSize * 2 ** b; b++) {
    const next = bucketSizes(heads, b);
    if (next.min < minBucketSize) break;
    bits = b;
    sizes = next;
  }
  return {
    bits,
    bucketCount: 2 ** bits,
    minBucketSize: sizes.min,
    maxBucketSize: sizes.max,
    totalAddresses: heads.length,
    meetsTarget: sizes.min >= minBucketSize,
  };
}
