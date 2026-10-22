"use client";

// Loads the tiny public stats snapshot (aggregate counts only). Identical for
// everyone. One request per visit, shared by the nav, the ticker and the home
// page; the full deposit list is only downloaded on /check.

import type { StatsPayload } from "@ail/core";
import { useEffect, useState } from "react";

export type StatsData = { status: "loading" } | { status: "error" } | { status: "ready"; payload: StatsPayload };

let pending: Promise<StatsData> | undefined;

function load(): Promise<StatsData> {
  pending ??= fetch("/api/v1/stats", { cache: "no-cache" })
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<StatsPayload>;
    })
    .then((payload): StatsData => ({ status: "ready", payload }))
    .catch((): StatsData => {
      pending = undefined; // allow a retry on the next visit
      return { status: "error" };
    });
  return pending;
}

export function useStats(): StatsData {
  const [data, setData] = useState<StatsData>({ status: "loading" });
  useEffect(() => {
    let live = true;
    load().then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, []);
  return data;
}
