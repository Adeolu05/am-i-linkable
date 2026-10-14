// node-postgres connection for Neon (pooled connection string), as Neon
// recommends for long-running Node services. Callers open a connection for a
// unit of work and close it afterwards, so nothing stays connected between
// collector cycles and Neon can scale to zero.

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { describeError, withStrictSsl } from "../env";
import * as schema from "./schema";
import type { Db } from "./store";

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
}

export function openDb(connectionString: string, log: (msg: string) => void = console.error): DbHandle {
  const pool = new pg.Pool({
    connectionString: withStrictSsl(connectionString),
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    // Let the process exit even if a client is idle.
    allowExitOnIdle: true,
  });
  // An idle client can error (e.g. the server closed it); never let that crash the process.
  pool.on("error", (err) => log(`db: idle client error: ${describeError(err)}`));
  const db = drizzle(pool, { schema }) as unknown as Db;
  return { db, close: () => pool.end() };
}
