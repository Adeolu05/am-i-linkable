// GET /api/v1/stats
//
// Aggregate counts only (no events): how many recent withdrawals stood out or
// blended in. A few hundred bytes, so the home page stays light. Built by the
// collector each cycle; see lib/snapshotRoute.ts.

import { snapshotHandler } from "@/lib/snapshotRoute";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = snapshotHandler("stats-v1");
