"use client";

// Loads the public shields snapshot once per visit and shares it between pages.
// The same file is served to everyone, so downloading it says nothing about you.

import { decodeShields, ShieldIndex, type LinkStats, type ShieldsPayload } from "@ail/core";
import { useEffect, useState } from "react";

export type ShieldsData =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; index: ShieldIndex; generatedAt: string; tipHeight: number | null; stats: LinkStats | null };

let pending: Promise<ShieldsData> | undefined;

function load(): Promise<ShieldsData> {
  // Always revalidate (ETag makes an unchanged copy a tiny 304): recent deposits matter most.
  pending ??= fetch("/api/v1/shields", { cache: "no-cache" })
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<ShieldsPayload>;
    })
    .then(
      (p): ShieldsData => ({
        status: "ready",
        index: new ShieldIndex(decodeShields(p)),
        generatedAt: p.generatedAt,
        tipHeight: p.tipHeight,
        stats: p.stats ?? null,
      }),
    )
    .catch((): ShieldsData => {
      pending = undefined; // allow a retry on the next visit
      return { status: "error" };
    });
  return pending;
}

export function useShields(): ShieldsData {
  const [data, setData] = useState<ShieldsData>({ status: "loading" });
  useEffect(() => {
    let live = true;
    load().then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, []);
  return data;
}

export function freshness(generatedAt: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - Date.parse(generatedAt)) / 60_000));
  if (mins <= 1) return "updated just now";
  if (mins < 120) return `updated ${mins} minutes ago`;
  return `updated ${Math.round(mins / 60)} hours ago`;
}
