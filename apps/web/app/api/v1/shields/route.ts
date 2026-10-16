// GET /api/v1/shields
//
// Every non-dust shield (transparent -> shielded) event from the last 30 days,
// in the compact format defined by packages/core (12-character txid prefixes).
// Built and compressed by the collector each cycle; see lib/snapshotRoute.ts.

import { snapshotHandler } from "@/lib/snapshotRoute";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = snapshotHandler("shields-v1");
