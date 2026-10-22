"use client";

// Fetching address buckets for "Have I been linked?". The browser only ever asks
// for whole buckets by their hash prefix; the address and its full hash never
// leave the device. Buckets are kept for the visit, so checking again (or
// switching to paranoid mode) does not download them twice.

import { bucketId, type BucketPayload, type BucketPlanInfo, type StatsPayload } from "@ail/core";

export class PlanChanged extends Error {}

const cache = new Map<string, BucketPayload>();

/** The current bucket plan (from the public stats snapshot, identical for everyone). */
export async function loadPlan(): Promise<BucketPlanInfo> {
  const r = await fetch("/api/v1/stats", { cache: "no-cache" });
  if (!r.ok) throw new Error(String(r.status));
  const p = (await r.json()) as StatsPayload;
  if (!p.buckets) throw new Error("Address buckets are not available yet.");
  return p.buckets;
}

export const bucketPath = (bits: number, index: number) => `/api/v1/buckets/${bits}/${bucketId(index, bits)}`;

export async function fetchBucket(bits: number, index: number): Promise<BucketPayload> {
  const path = bucketPath(bits, index);
  const hit = cache.get(path);
  if (hit) return hit;
  const r = await fetch(path, { cache: "no-cache" });
  if (r.status === 409) throw new PlanChanged();
  if (!r.ok) throw new Error(String(r.status));
  const p = (await r.json()) as BucketPayload;
  cache.set(path, p);
  return p;
}

/** Every bucket of the plan (paranoid mode), a few at a time. */
export async function fetchAllBuckets(plan: BucketPlanInfo, onProgress?: (done: number) => void): Promise<BucketPayload[]> {
  const out: BucketPayload[] = new Array(plan.bucketCount);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < plan.bucketCount) {
      const i = next++;
      out[i] = await fetchBucket(plan.bits, i);
      onProgress?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, plan.bucketCount) }, worker));
  return out;
}

export function formatMB(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}
