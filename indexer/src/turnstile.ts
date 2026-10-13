// Turnstile extraction: turns per-address balance effects of a transaction
// into events that move value between transparent addresses and a shielded pool.
//
// Input model (source-agnostic): every transaction is a list of signed balance
// effects in zatoshis. Transparent addresses appear as themselves; shielded
// pools appear as pseudo-addresses ("sapling-pool", "orchard-pool",
// "ironwood-pool", ...). A positive pool effect means value entered the pool
// (shielding); a negative one means value left it (unshielding).

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

export interface TransparentLeg {
  address: string;
  amountZat: string;
}

export interface TurnstileEvent {
  txid: string;
  blockHeight: number;
  time: string;
  pool: Pool;
  direction: Direction;
  /** Net value that crossed this pool's turnstile, in zatoshis (decimal string). */
  amountZat: string;
  /** Fee paid by the transaction, in zatoshis (decimal string). */
  feeZat: string;
  /** Transparent addresses spent from in this transaction. */
  transparentInputs: TransparentLeg[];
  /** Transparent addresses paid to in this transaction. */
  transparentOutputs: TransparentLeg[];
}

export type TxClass =
  | "turnstile" // transparent leg plus a net pool change: what we index
  | "coinbase" // value is minted; excluded
  | "shielded-only" // pool change(s) with no transparent leg, e.g. Orchard -> Ironwood migration
  | "transparent-only" // no pool change
  | "unknown"; // unrecognised pseudo-address present

export interface ClassifiedTx {
  class: TxClass;
  events: TurnstileEvent[];
  /** Pseudo-addresses we did not recognise, for diagnostics. */
  unknownAddresses: string[];
}

const FEE_SINK = "the-void";
const IGNORED_PSEUDO = new Set(["lockbox"]);

export function isTransparentAddress(address: string): boolean {
  // Mainnet P2PKH (t1), P2SH (t3) and ZIP 320 TEX addresses.
  return /^t[13][1-9A-HJ-NP-Za-km-z]{33}$/.test(address) || /^tex1[02-9ac-hj-np-z]+$/.test(address);
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

export function classifyTx(tx: RawTx): ClassifiedTx {
  const net = sumByAddress(tx.effects);
  const poolNet = new Map<Pool, bigint>();
  const inputs: TransparentLeg[] = [];
  const outputs: TransparentLeg[] = [];
  const unknownAddresses: string[] = [];
  let voidNet = 0n;

  for (const [address, amount] of net) {
    if (amount === 0n) continue;
    if (isTransparentAddress(address)) {
      const leg = { address, amountZat: (amount < 0n ? -amount : amount).toString() };
      (amount < 0n ? inputs : outputs).push(leg);
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
  if (poolNet.size === 0) return { class: "transparent-only", events: [], unknownAddresses };
  if (inputs.length === 0 && outputs.length === 0) {
    return { class: "shielded-only", events: [], unknownAddresses };
  }

  const byAddress = (a: TransparentLeg, b: TransparentLeg) => a.address.localeCompare(b.address);
  inputs.sort(byAddress);
  outputs.sort(byAddress);

  const events: TurnstileEvent[] = [];
  for (const pool of POOLS) {
    const amount = poolNet.get(pool);
    if (amount === undefined || amount === 0n) continue;
    events.push({
      txid: tx.txid,
      blockHeight: tx.blockHeight,
      time: tx.time,
      pool,
      direction: amount > 0n ? "in" : "out",
      amountZat: (amount < 0n ? -amount : amount).toString(),
      feeZat: voidNet.toString(),
      transparentInputs: inputs,
      transparentOutputs: outputs,
    });
  }
  return { class: events.length > 0 ? "turnstile" : "transparent-only", events, unknownAddresses };
}
