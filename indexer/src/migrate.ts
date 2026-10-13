// Applies the SQL migrations in indexer/drizzle over the direct (non-pooled)
// connection, as Neon recommends for schema changes.
//
//   pnpm --filter indexer migrate

import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { describeError, INDEXER_ROOT, loadEnv, requireEnv } from "./env";

async function main() {
  loadEnv();
  const url = requireEnv(
    "DATABASE_URL_UNPOOLED",
    "Migrations need Neon's direct (non-pooled) connection string; add it to indexer/.env or the service environment.",
  );
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 15_000 });
  pool.on("error", (err) => console.error(`db: ${describeError(err)}`));
  try {
    const started = Date.now();
    await migrate(drizzle(pool), { migrationsFolder: path.join(INDEXER_ROOT, "drizzle") });
    console.log(`migrations applied in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`migrate failed: ${describeError(err)}`);
  process.exit(1);
});
