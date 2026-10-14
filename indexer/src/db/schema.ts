// Postgres schema for the collector (Drizzle ORM).
//
// Every child row hangs off indexed_blocks with ON DELETE CASCADE, so a reorg
// rollback or the 30-day prune is a single DELETE on indexed_blocks.

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

const POOL_CHECK = sql.raw(`('sprout', 'sapling', 'orchard', 'ironwood')`);

export const indexedBlocks = pgTable(
  "indexed_blocks",
  {
    height: integer("height").primaryKey(),
    /** Null for blocks loaded from dumps (dumps carry no hashes) until the collector verifies them. */
    hash: text("hash"),
    time: timestamp("time", { withTimezone: true }).notNull(),
    source: text("source", { enum: ["dump", "api"] }).notNull(),
    indexedAt: timestamp("indexed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("indexed_blocks_time_idx").on(t.time),
    check("indexed_blocks_source_check", sql`${t.source} in ('dump', 'api')`),
  ],
);

export const turnstileEvents = pgTable(
  "turnstile_events",
  {
    txid: text("txid").notNull(),
    pool: text("pool", { enum: ["sprout", "sapling", "orchard", "ironwood"] }).notNull(),
    height: integer("height")
      .notNull()
      .references(() => indexedBlocks.height, { onDelete: "cascade" }),
    time: timestamp("time", { withTimezone: true }).notNull(),
    direction: text("direction", { enum: ["shield", "unshield"] }).notNull(),
    amountZat: bigint("amount_zat", { mode: "bigint" }).notNull(),
    feeZat: bigint("fee_zat", { mode: "bigint" }).notNull(),
    isDust: boolean("is_dust").notNull(),
  },
  (t) => [
    // One event per (transaction, pool): re-inserting the same block is a no-op.
    primaryKey({ name: "turnstile_events_pk", columns: [t.txid, t.pool] }),
    index("turnstile_events_time_idx").on(t.time),
    index("turnstile_events_height_idx").on(t.height),
    index("turnstile_events_amount_idx").on(t.amountZat),
    check("turnstile_events_pool_check", sql`${t.pool} in ${POOL_CHECK}`),
    check("turnstile_events_direction_check", sql`${t.direction} in ('shield', 'unshield')`),
  ],
);

export const eventAddresses = pgTable(
  "event_addresses",
  {
    txid: text("txid").notNull(),
    pool: text("pool").notNull(),
    /** "input": spent from this address; "output": paid to it. */
    role: text("role", { enum: ["input", "output"] }).notNull(),
    address: text("address").notNull(),
    addressType: text("address_type", { enum: ["transparent", "nonstandard-script"] }).notNull(),
    amountZat: bigint("amount_zat", { mode: "bigint" }).notNull(),
    /** SHA-256 of the UTF-8 address. Bucket lookups are byte-range scans on this column. */
    addressHash: bytea("address_hash").notNull(),
  },
  (t) => [
    primaryKey({ name: "event_addresses_pk", columns: [t.txid, t.pool, t.role, t.address] }),
    foreignKey({
      name: "event_addresses_event_fk",
      columns: [t.txid, t.pool],
      foreignColumns: [turnstileEvents.txid, turnstileEvents.pool],
    }).onDelete("cascade"),
    index("event_addresses_hash_idx").on(t.addressHash),
    check("event_addresses_role_check", sql`${t.role} in ('input', 'output')`),
    check("event_addresses_type_check", sql`${t.addressType} in ('transparent', 'nonstandard-script')`),
  ],
);

export const poolMigrations = pgTable(
  "pool_migrations",
  {
    txid: text("txid").primaryKey(),
    height: integer("height")
      .notNull()
      .references(() => indexedBlocks.height, { onDelete: "cascade" }),
    time: timestamp("time", { withTimezone: true }).notNull(),
    /** [{ pool, amountZat }] the value left. */
    fromPools: jsonb("from_pools").$type<{ pool: string; amountZat: string }[]>().notNull(),
    /** [{ pool, amountZat }] the value entered. */
    toPools: jsonb("to_pools").$type<{ pool: string; amountZat: string }[]>().notNull(),
    feeZat: bigint("fee_zat", { mode: "bigint" }).notNull(),
  },
  (t) => [index("pool_migrations_time_idx").on(t.time), index("pool_migrations_height_idx").on(t.height)],
);

export const meta = pgTable("meta", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Pre-built, pre-compressed public payloads, one row per key (e.g. "shields-v1").
 * The collector rewrites them at the end of each cycle; the website only reads
 * this table, so a request never has to scan events.
 */
export const snapshots = pgTable("snapshots", {
  key: text("key").primaryKey(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  tipHeight: integer("tip_height"),
  /** Weak ETag of the uncompressed JSON; identical for every encoding. */
  etag: text("etag").notNull(),
  rowCount: integer("row_count").notNull(),
  jsonBytes: integer("json_bytes").notNull(),
  bodyGzip: bytea("body_gzip").notNull(),
  /** Optional: only stored when brotli finished within the cycle's time budget. */
  bodyBr: bytea("body_br"),
});
