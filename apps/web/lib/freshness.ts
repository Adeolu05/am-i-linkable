// "updated 5 minutes ago" for snapshot timestamps, plus the short form the nav uses.

export function freshness(generatedAt: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - Date.parse(generatedAt)) / 60_000));
  if (mins <= 1) return "updated just now";
  if (mins < 120) return `updated ${mins} minutes ago`;
  return `updated ${Math.round(mins / 60)} hours ago`;
}

/** Snapshots older than this are shown as stale (amber, no pulse). */
export const STALE_MS = 2 * 3_600_000;

/** "8m old", "5h old", "3d old". Rounds down, so a fresh snapshot never reads as old as the stale threshold. */
export function snapshotAge(generatedAt: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - Date.parse(generatedAt)) / 60_000));
  if (mins < 60) return `${mins}m old`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h old`;
  return `${Math.floor(hours / 24)}d old`;
}
