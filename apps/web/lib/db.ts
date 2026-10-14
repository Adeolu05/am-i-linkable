// Read-only database access for the website. Uses DATABASE_URL_READONLY (the
// web_readonly role, which can only SELECT). Never logs connection details.

import "server-only";
import pg from "pg";

/** node-postgres treats require/prefer/verify-ca as verify-full; say so explicitly. */
function withStrictSsl(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    const mode = u.searchParams.get("sslmode");
    if (mode === "require" || mode === "prefer" || mode === "verify-ca") u.searchParams.set("sslmode", "verify-full");
    return u.toString();
  } catch {
    return connectionString;
  }
}

/** Runs `fn` with a short-lived connection that is always closed, so the database can sleep. */
export async function withReadonlyClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL_READONLY;
  if (!url) throw new Error("DATABASE_URL_READONLY is not set");
  const client = new pg.Client({ connectionString: withStrictSsl(url), connectionTimeoutMillis: 10_000 });
  // Swallow idle errors; the request path reports failures generically.
  client.on("error", () => {});
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}
