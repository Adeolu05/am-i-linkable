// Source-agnostic block shape and its conversion into database rows.

import { createHash } from "node:crypto";
import { classifyTx, type RawTx, type TxClass } from "./turnstile";
import type { eventAddresses, indexedBlocks, poolMigrations, turnstileEvents } from "./db/schema";

export interface SourceBlock {
  height: number;
  /** Null when the source does not provide it (dumps). */
  hash: string | null;
  /** ISO 8601. */
  time: string;
  source: "dump" | "api";
  txs: RawTx[];
}

export interface BlockRows {
  block: typeof indexedBlocks.$inferInsert;
  events: (typeof turnstileEvents.$inferInsert)[];
  addresses: (typeof eventAddresses.$inferInsert)[];
  migrations: (typeof poolMigrations.$inferInsert)[];
  classes: Partial<Record<TxClass, number>>;
  unknownAddresses: string[];
}

export const sha256 = (s: string): Uint8Array => createHash("sha256").update(s, "utf8").digest();

export function blockToRows(b: SourceBlock): BlockRows {
  const time = new Date(b.time);
  const rows: BlockRows = {
    block: { height: b.height, hash: b.hash, time, source: b.source },
    events: [],
    addresses: [],
    migrations: [],
    classes: {},
    unknownAddresses: [],
  };
  for (const tx of b.txs) {
    const r = classifyTx(tx);
    rows.classes[r.class] = (rows.classes[r.class] ?? 0) + 1;
    rows.unknownAddresses.push(...r.unknownAddresses);
    for (const e of r.events) {
      rows.events.push({
        txid: e.txid,
        pool: e.pool,
        height: b.height,
        time,
        direction: e.direction === "in" ? "shield" : "unshield",
        amountZat: BigInt(e.amountZat),
        feeZat: BigInt(e.feeZat),
        isDust: e.isDust,
      });
      for (const [role, legs] of [
        ["input", e.transparentInputs],
        ["output", e.transparentOutputs],
      ] as const) {
        for (const leg of legs) {
          rows.addresses.push({
            txid: e.txid,
            pool: e.pool,
            role,
            address: leg.address,
            addressType: leg.addressType,
            amountZat: BigInt(leg.amountZat),
            addressHash: sha256(leg.address),
          });
        }
      }
    }
    if (r.migration) {
      rows.migrations.push({
        txid: r.migration.txid,
        height: b.height,
        time,
        fromPools: r.migration.from,
        toPools: r.migration.to,
        feeZat: BigInt(r.migration.feeZat),
      });
    }
  }
  return rows;
}
