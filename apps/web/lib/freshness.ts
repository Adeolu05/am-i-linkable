// "updated 5 minutes ago" for snapshot timestamps.

export function freshness(generatedAt: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - Date.parse(generatedAt)) / 60_000));
  if (mins <= 1) return "updated just now";
  if (mins < 120) return `updated ${mins} minutes ago`;
  return `updated ${Math.round(mins / 60)} hours ago`;
}
