"use client";

// Loads the tiny public stats snapshot (aggregate counts only) for the home page.
// Identical for everyone; the full deposit list is only downloaded on /check.

import type { StatsPayload } from "@ail/core";
import { useEffect, useState } from "react";

export type StatsData = { status: "loading" } | { status: "error" } | { status: "ready"; payload: StatsPayload };

export function useStats(): StatsData {
  const [data, setData] = useState<StatsData>({ status: "loading" });
  useEffect(() => {
    let live = true;
    fetch("/api/v1/stats", { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<StatsPayload>;
      })
      .then((payload) => live && setData({ status: "ready", payload }))
      .catch(() => live && setData({ status: "error" }));
    return () => {
      live = false;
    };
  }, []);
  return data;
}
