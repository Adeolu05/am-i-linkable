// Helpers for the website's read-only database role (see create-web-role.ts).

export const WEB_ROLE = "web_readonly";
/** The only table the website reads: pre-built public payloads. Add to this list (and re-run) only if a page needs more. */
export const WEB_TABLES = ["snapshots"] as const;

/** Replaces or appends KEY=value in dotenv text, keeping every other line. */
export function upsertEnvLine(text: string, key: string, value: string): string {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  const line = `${key}=${value}`;
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = line;
  else lines.push(line);
  return `${lines.join("\n")}\n`;
}

/** The pooled connection string with the web role's credentials swapped in. */
export function readonlyUrl(pooledUrl: string, password: string): string {
  const u = new URL(pooledUrl);
  u.username = WEB_ROLE;
  u.password = encodeURIComponent(password);
  return u.toString();
}
