// Minimal client for the 3xpl JSON API (https://3xpl.com/data/json-api/docs).
// Without THREEXPL_API_KEY it uses the keyless sandbox, which is rate limited
// (observed: 30 requests per rolling window of about a minute; we stay near 25 a minute) and has no uptime guarantee.

import { createHash } from "node:crypto";
import type { BlockSource } from "../cycle";
import { describeError } from "../env";
import type { SourceBlock } from "../ingest";
import type { BalanceEffect, RawTx } from "../turnstile";

const SANDBOX_BASE = "https://sandbox-api.3xpl.com";
const KEYED_BASE = "https://api.3xpl.com";
const MODULE = "zcash-main";
const PAGE_LIMIT = 1000;
const MAX_ATTEMPTS = 8;
/** Minimum gap between requests. The keyed API returned HTTP 429 during fast catch-up at 250 ms. */
export const KEYED_MIN_INTERVAL_MS = 1500;
/** Keeps the keyless sandbox near 25 requests a minute (its quota is about 30). */
export const SANDBOX_MIN_INTERVAL_MS = 2400;

/** Parses THREEXPL_MIN_INTERVAL_MS; undefined (use the default) when empty or invalid. */
export function minIntervalFromEnv(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const ms = Number(value);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

interface ApiEvent {
  transaction: string;
  sort_key: number;
  address: string;
  currency: string;
  effect: string;
  failed: boolean;
}

interface BlockResponse {
  data: {
    block?: { block: number; hash: string; time: string };
    events?: Record<string, ApiEvent[]>;
  };
  context: { code: number };
}

interface BlocksResponse {
  data: { blocks: Record<string, { hash: string; time: string }> };
}

export interface BlockEvents {
  height: number;
  hash: string;
  time: string;
  events: ApiEvent[];
}

export interface ThreeXplOptions {
  apiKey?: string;
  /** Token for dumps.3xpl.com downloads (sent as a Bearer header, never in URLs or logs). */
  dumpsKey?: string;
  minIntervalMs?: number;
  log?: (msg: string) => void;
}

/** One day of zcash-main events, as listed by /dumps. */
export interface DumpInfo {
  date: string;
  blocks: number;
  events: number;
  uncompressed_size: number;
  compressed_size: number;
  compression_algo: string;
  link: string;
  checksum: string;
  checksum_algo: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True only when the server reports a remaining-requests value of 1 or less. A missing header means no quota. */
export function quotaNearlyExhausted(header: string | null): boolean {
  if (header === null || header.trim() === "") return false;
  const remaining = Number(header);
  return Number.isFinite(remaining) && remaining <= 1;
}

/** Treats empty values and .env.example placeholders ("your-...") as unset. */
export function usableKey(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v && !v.toLowerCase().startsWith("your-") ? v : undefined;
}

export class ThreeXplClient {
  readonly base: string;
  readonly keyed: boolean;
  private readonly apiKey: string | undefined;
  private readonly dumpsKey: string | undefined;
  private readonly minIntervalMs: number;
  private readonly log: (msg: string) => void;
  private lastRequestAt = 0;
  requestCount = 0;

  constructor(opts: ThreeXplOptions = {}) {
    this.apiKey = usableKey(opts.apiKey);
    this.dumpsKey = usableKey(opts.dumpsKey);
    this.keyed = Boolean(this.apiKey);
    this.base = this.keyed ? KEYED_BASE : SANDBOX_BASE;
    this.minIntervalMs = opts.minIntervalMs ?? (this.keyed ? KEYED_MIN_INTERVAL_MS : SANDBOX_MIN_INTERVAL_MS);
    this.log = opts.log ?? (() => {});
    // Never log key values, only whether one is in use.
    if (!this.apiKey) this.log("API key not set (THREEXPL_API_KEY): using the keyless sandbox");
    // Only mention the dumps key to callers that use dumps (they pass the option, even if empty).
    if (!this.dumpsKey && "dumpsKey" in opts) this.log("dumps key not set (THREEXPL_DUMPS_KEY): dump downloads disabled");
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.base}${path}`;
    let backoff = 15_000;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();
      this.requestCount++;

      let res: Response;
      try {
        res = await fetch(url, {
          headers: {
            Accept: "application/json",
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        this.log(`network error (${describeError(err)}), retrying in ${backoff / 1000}s`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 120_000);
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff;
        this.log(`HTTP ${res.status}, retrying in ${Math.round(delay / 1000)}s`);
        await sleep(delay);
        backoff = Math.min(backoff * 2, 120_000);
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`3xpl ${res.status} for ${path}: ${body.slice(0, 300)}`);
      }

      // Stay just under the quota rather than tripping 429s.
      // Keyed responses carry no rate-limit headers; only the sandbox reports a quota.
      if (quotaNearlyExhausted(res.headers.get("x-ratelimit-remaining"))) {
        this.log("rate-limit quota nearly exhausted, pausing 30s");
        this.lastRequestAt = Date.now() + 30_000 - this.minIntervalMs;
      }
      return (await res.json()) as T;
    }
    throw new Error(`3xpl: giving up on ${path} after ${MAX_ATTEMPTS} attempts`);
  }

  async tipHeight(): Promise<number> {
    const r = await this.get<BlocksResponse>(`/zcash/blocks?data=blocks&from=${MODULE}&limit=1`);
    const heights = Object.keys(r.data.blocks).map(Number);
    if (heights.length === 0) throw new Error("3xpl: empty blocks list");
    return Math.max(...heights);
  }

  get hasDumpsKey(): boolean {
    return this.dumpsKey !== undefined;
  }

  /** Block hash only (one cheap request), for reorg checks. */
  async blockHash(height: number): Promise<string> {
    const r = await this.get<BlockResponse>(`/zcash/block/${height}?data=block&from=${MODULE}`);
    if (!r.data.block?.hash) throw new Error(`3xpl: no block metadata for ${height}`);
    return r.data.block.hash;
  }

  async blockEvents(height: number): Promise<BlockEvents> {
    const events: ApiEvent[] = [];
    let meta: { hash: string; time: string } | undefined;
    for (let page = 0; ; page++) {
      const data = page === 0 ? "block,events" : "events";
      const r = await this.get<BlockResponse>(
        `/zcash/block/${height}?data=${data}&from=${MODULE}&limit=${PAGE_LIMIT}&page=${page}`,
      );
      if (r.data.block) meta = { hash: r.data.block.hash, time: r.data.block.time };
      const batch = r.data.events?.[MODULE] ?? [];
      events.push(...batch);
      if (batch.length < PAGE_LIMIT) break;
    }
    if (!meta) throw new Error(`3xpl: no block metadata for ${height}`);
    return { height, ...meta, events };
  }

  /** Lists the available daily zcash-main dumps, oldest first. */
  async listDumps(): Promise<DumpInfo[]> {
    const r = await this.get<{ data: { dumps?: Record<string, Record<string, Omit<DumpInfo, "date">>> } }>(
      `/dumps?from=${MODULE}&mode=all`,
    );
    const days = r.data.dumps?.[MODULE] ?? {};
    return Object.entries(days)
      .map(([date, info]) => ({ ...info, date }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Downloads one daily dump (zstd TSV) and verifies its SHA-256 checksum. Requires THREEXPL_DUMPS_KEY. */
  async downloadDump(dump: DumpInfo): Promise<Uint8Array> {
    if (!this.dumpsKey) throw new Error("3xpl: dumps key not set (THREEXPL_DUMPS_KEY); dumps cannot be downloaded without one");
    if (dump.checksum_algo !== "sha256sum") throw new Error(`3xpl: unsupported checksum ${dump.checksum_algo}`);
    const res = await fetch(dump.link, {
      headers: { Authorization: `Bearer ${this.dumpsKey}` },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`3xpl dumps: HTTP ${res.status} for ${dump.date}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (sha !== dump.checksum) throw new Error(`3xpl dumps: checksum mismatch for ${dump.date}`);
    return bytes;
  }
}

/** Groups a block's events into transactions with signed effects. */
export function blockToTxs(block: BlockEvents): RawTx[] {
  const byTx = new Map<string, BalanceEffect[]>();
  for (const e of block.events) {
    if (e.failed || e.currency !== "zcash") continue;
    let list = byTx.get(e.transaction);
    if (!list) byTx.set(e.transaction, (list = []));
    list.push({ address: e.address, effectZat: BigInt(e.effect) });
  }
  const time = new Date(block.time).toISOString();
  return [...byTx].map(([txid, effects]) => ({ txid, blockHeight: block.height, time, effects }));
}

export function toSourceBlock(block: BlockEvents): SourceBlock {
  return {
    height: block.height,
    hash: block.hash,
    time: new Date(block.time).toISOString(),
    source: "api",
    txs: blockToTxs(block),
  };
}

/** Adapts the 3xpl client to the collector's BlockSource interface. */
export function threeXplBlockSource(client: ThreeXplClient): BlockSource {
  return {
    tipHeight: () => client.tipHeight(),
    block: async (height) => toSourceBlock(await client.blockEvents(height)),
    blockHash: (height) => client.blockHash(height),
  };
}
