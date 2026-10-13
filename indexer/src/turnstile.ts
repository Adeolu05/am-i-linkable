// Turnstile extraction: turns per-address balance effects of a transaction
// into events that move value between transparent addresses and a shielded pool,
// plus pool-to-pool migration events.
//
// Input model (source-agnostic): every transaction is a list of signed balance
// effects in zatoshis. Transparent addresses appear as themselves; shielded
// pools appear as pseudo-addresses ("sapling-pool", "orchard-pool",
// "ironwood-pool", ...). A positive pool effect means value entered the pool
// (shielding); a negative one means value left it (unshielding).

import { isDust } from "@ail/core";

export type Pool = "sprout" | "sapling" | "orchard" | "ironwood";
export const POOLS: readonly Pool[] = ["sprout", "sapling", "orchard", "ironwood"];

/** "in" = transparent -> shielded (shielding), "out" = shielded -> transparent (unshielding). */
export type Direction = "in" | "out";

export interface BalanceEffect {
  address: string;
  /** Signed amount in zatoshis. */
  effectZat: bigint;
}

export interface RawTx {
  txid: string;
  blockHeight: number;
  /** ISO 8601 block time. */
  time: string;
  effects: BalanceEffect[];
}

/**
 * "transparent": a t1/t3/tex1 address.
 * "nonstandard-script": a transparent output whose script has no address form
 * (the source names it "script-<hash>").
 */
export type TransparentAddressType = "transparent" | "nonstandard-script";

export interface TransparentLeg {
  address: string;
  addressType: TransparentAddressType;
  amountZat: string;
}

export interface TurnstileEvent {
  kind: "turnstile";
  txid: string;
  blockHeight: number;
  time: string;
  pool: Pool;
  direction: Direction;
  /** Net value that crossed this pool's turnstile, in zatoshis (decimal string). */
  amountZat: string;
  /** Fee paid by the transaction, in zatoshis (decimal string). */
  feeZat: string;
  /** At or below 0.001 ZEC: stored and counted, but excluded from matching. */
  isDust: boolean;
  /** Transparent addresses spent from in this transaction. */
  transparentInputs: TransparentLeg[];
  /** Transparent addresses paid to in this transaction. */
  transparentOutputs: TransparentLeg[];
}

export interface PoolLeg {
  pool: Pool;
  amountZat: string;
}

/** Value moved between shielded pools with no transparent side (e.g. Orchard -> Ironwood). Not matched in v1. */
export interface PoolMigrationEvent {
  kind: "pool-migration";
  txid: string;
  blockHeight: number;
  time: string;
  /** Pools value left. */
  from: PoolLeg[];
  /** Pools value entered. */
  to: PoolLeg[];
  feeZat: string;
}

export type TxClass =
  | "turnstile" // transparent leg plus a net pool change: matched
  | "pool-migration" // value moves from one shielded pool to another, no transparent leg: stored, not matched
  | "shielded-internal" // stays within one pool; only the fee leaves it
  | "coinbase" // value is minted; excluded
  | "transparent-only" // no pool change
  | "unknown"; // unrecognised pseudo-address present

export interface ClassifiedTx {
  class: TxClass;
  events: TurnstileEvent[];
  migration?: PoolMigrationEvent;
  /** Pseudo-addresses we did not recognise, for diagnostics. */
  unknownAddresses: string[];
}

const FEE_SINK = "the-void";
const IGNORED_PSEUDO = new Set(["lockbox"]);

export function isTransparentAddress(address: string): boolean {
  // Mainnet P2PKH (t1), P2SH (t3) and ZIP 320 TEX addresses.
  return /^t[13][1-9A-HJ-NP-Za-km-z]{33}$/.test(address) || /^tex1[02-9ac-hj-np-z]+$/.test(address);
}

export function isNonstandardScript(address: string): boolean {
  return /^script-[0-9a-f]+$/.test(address);
}

export function poolFromPseudoAddress(address: string): Pool | undefined {
  const m = /^([a-z]+)-pool$/.exec(address);
  if (!m) return undefined;
  return (POOLS as readonly string[]).includes(m[1]!) ? (m[1] as Pool) : undefined;
}

function sumByAddress(effects: BalanceEffect[]): Map<string, bigint> {
  const net = new Map<string, bigint>();
  for (const e of effects) net.set(e.address, (net.get(e.address) ?? 0n) + e.effectZat);
  return net;
}

const abs = (n: bigint) => (n < 0n ? -n : n);

export function classifyTx(tx: RawTx): ClassifiedTx {
  const net = sumByAddress(tx.effects);
  const poolNet = new Map<Pool, bigint>();
  const inputs: TransparentLeg[] = [];
  const outputs: TransparentLeg[] = [];
  const unknownAddresses: string[] = [];
  let voidNet = 0n;

  for (const [address, amount] of net) {
    // Zero-value effects (e.g. data-only script outputs) carry nothing across a turnstile.
    if (amount === 0n) continue;
    const addressType: TransparentAddressType | undefined = isTransparentAddress(address)
      ? "transparent"
      : isNonstandardScript(address)
        ? "nonstandard-script"
        : undefined;
    if (addressType) {
      (amount < 0n ? inputs : outputs).push({ address, addressType, amountZat: abs(amount).toString() });
      continue;
    }
    if (address === FEE_SINK) {
      voidNet += amount;
      continue;
    }
    const pool = poolFromPseudoAddress(address);
    if (pool) {
      poolNet.set(pool, (poolNet.get(pool) ?? 0n) + amount);
      continue;
    }
    if (!IGNORED_PSEUDO.has(address)) unknownAddresses.push(address);
  }

  if (unknownAddresses.length > 0) return { class: "unknown", events: [], unknownAddresses };
  // The fee sink only goes negative when the transaction creates new coins.
  if (voidNet < 0n) return { class: "coinbase", events: [], unknownAddresses };

  const changed = POOLS.filter((p) => (poolNet.get(p) ?? 0n) !== 0n);
  if (changed.length === 0) return { class: "transparent-only", events: [], unknownAddresses };

  const base = { txid: tx.txid, blockHeight: tx.blockHeight, time: tx.time, feeZat: voidNet.toString() };

  if (inputs.length === 0 && outputs.length === 0) {
    const legs = (sign: 1n | -1n) =>
      changed
        .filter((p) => poolNet.get(p)! * sign > 0n)
        .map((pool) => ({ pool, amountZat: abs(poolNet.get(pool)!).toString() }));
    const from = legs(-1n);
    const to = legs(1n);
    if (from.length > 0 && to.length > 0) {
      return { class: "pool-migration", events: [], migration: { kind: "pool-migration", ...base, from, to }, unknownAddresses };
    }
    return { class: "shielded-internal", events: [], unknownAddresses };
  }

  const byAddress = (a: TransparentLeg, b: TransparentLeg) => a.address.localeCompare(b.address);
  inputs.sort(byAddress);
  outputs.sort(byAddress);

  const events: TurnstileEvent[] = changed.map((pool) => {
    const amount = poolNet.get(pool)!;
    return {
      kind: "turnstile",
      ...base,
      pool,
      direction: amount > 0n ? "in" : "out",
      amountZat: abs(amount).toString(),
      isDust: isDust(abs(amount)),
      transparentInputs: inputs,
      transparentOutputs: outputs,
    };
  });
  return { class: "turnstile", events, unknownAddresses };
}
