# Build log

## 2026-10-13: Scaffold, docs and turnstile spike

### Done

- pnpm workspace: `apps/web` (Next.js 16 App Router, Tailwind 4, fonts
  self-hosted via `next/font`), `packages/core` (vitest, placeholder test),
  `indexer` (Node + TypeScript, run with `tsx`).
- gitleaks GitHub Actions workflow on every push and pull request.
- Docs: SPEC, PRIVACY, PRIOR_ART, this log, README.
- Turnstile extraction (`indexer/src/turnstile.ts`) with unit tests, plus the
  `pnpm spike` script.

### Finding: Ironwood changes the picture

The Ironwood network upgrade (NU6.3) activated on 2026-07-28 at block 3,428,143.
It added a third shielded pool (Ironwood, v6 transactions) and made Orchard
exit-only. Indexing only Sapling and Orchard would have missed about 95% of
today's turnstile events, so the extractor handles every pool generically
(Sprout, Sapling, Orchard, Ironwood).

### Data source evaluation

| Source | Verdict |
|---|---|
| Blockchair API | Keyless and fast, but `shielded_value_delta` is 0 for Ironwood/v6 transactions (checked on tx `307b6cfd…`). Correct for Sapling. Not usable as the primary source. |
| lightwalletd / Zaino (`zec.rocks:443`) | Reachable, but needs a v4/v5/v6 transaction parser plus previous-output lookups for transparent inputs. Too much for a first spike; kept for later. |
| Public Zebra JSON-RPC | No keyless public endpoint found; GetBlock and QuickNode need account tokens. |
| **3xpl JSON API (sandbox)** | **Chosen.** Keyless, per-block events that already include pool pseudo-addresses (`sapling-pool`, `orchard-pool`, `ironwood-pool`), fees (`the-void`) and `lockbox`. About 30 requests a minute observed (`X-RateLimit-Limit: 30`). Daily TSV dumps exist but return 403 without a key. |

Validation: the spike's Sapling events were checked against Blockchair's
`shielded_value_delta` and fees; both matched to the zatoshi.

### Spike headline numbers

Blocks 3,515,422 to 3,516,421, 2026-10-12 17:05 to 2026-10-13 14:00 UTC
(about 21 hours). 982 requests, about 50 minutes on the keyless sandbox, 0 HTTP
errors. Figures below are from the final extractor (re-run from cache).

| Transactions | Count |
|---|---:|
| Turnstile (t <-> pool) | 3,269 |
| Pool migration (pool -> pool, no transparent side) | 57 |
| Shielded-internal (stays in one pool) | 1,201 |
| Coinbase | 1,000 |
| Transparent-only | 2,733 |
| Unrecognised | 0 |

| Pool | Shield | Unshield | ZEC in | ZEC out |
|---|---:|---:|---:|---:|
| Sapling | 85 | 77 | 1,377.19 | 1,401.94 |
| Orchard | 0 | 18 | 0 | 37.43 |
| Ironwood | 942 | 2,150 | 3,581.44 | 5,072.41 |
| **Total** | **1,027** | **2,245** | | |

- **3,272 turnstile events**, touching 2,816 distinct transparent addresses.
- Orchard shows no shielding at all, only exits, which confirms it is exit-only.
- **Dust (at most 0.001 ZEC):** 310 shields and 1,547 unshields, mostly a few
  tiny amounts repeated hundreds of times. That leaves **1,415 matchable events**.
- **Pool migrations:** 57, of which 47 are Orchard -> Ironwood (998.26 ZEC),
  8 Sapling -> Ironwood, 1 Ironwood -> Sapling, and 1 Sapling + Orchard ->
  Ironwood (1,192.73 ZEC).
- **Round-trip candidates:** 62 non-dust unshields whose exact amount was
  shielded earlier in the window; 57 of those involve an amount seen exactly
  once in each direction (Quesnelle's uniqueness criterion). Including dust the
  count would be 1,473, almost all noise. All of these are *candidates*
  for linkage and nothing more.
- **Bucket plan on this sample:** 1 bit (2 buckets), smallest bucket 1,399
  addresses, meeting the 1,000 target.

Correction: an earlier draft of this log reported 1,258 "shielded-only"
transactions as migrations. That figure also included transactions that never
leave one pool (only the fee does). Splitting them gives 57 real migrations and
1,201 shielded-internal transactions.

### Decisions (same day)

1. **History: 30-day rolling window** (not 90). Most round-trip linkage happens
   within hours to days. Initial backfill is about 34,560 blocks, **about 29
   hours** at the sandbox rate, resumable.
2. **Data source: keep 3xpl**, at about 25 requests a minute with exponential
   backoff. 3xpl is credited in the README and the site footer. Scale-up paths
   (a paid key or a self-run Zebra node) are documented in SPEC.md.
3. **Migrations:** shielded -> shielded pool movements are stored as their own
   `pool-migration` event kind, excluded from matching in v1. Chaining them
   into matches is future work.
4. **Dust:** amounts at or below 0.001 ZEC are flagged `isDust`, excluded from
   matching and counted separately. The checker tells users a dust amount is
   "too small and common to match meaningfully".
5. **Address prefix:** chosen dynamically so the smallest bucket holds at least
   1,000 addresses (`planBuckets` in `packages/core`). The bit length and
   smallest bucket size are published in `meta.json` for the site to display.
6. **Prior art:** payments-gateway is described neutrally from its public Glama
   listing.
7. **License:** MIT, copyright 2026 David Peluola.

### Next

- Round-trip heuristics in `packages/core` (exact, fee-adjusted, tolerance
  bands, time windows) with tests, using non-dust turnstile events only.
- Indexer storage and the 30-day backfill; emit the `/api/v1/*` files.
- Site footer and pages that read `meta.json` and show the anonymity set.

### 3xpl test keys and daily dumps (later the same day)

Two public 3xpl test keys (from the 3xpl Discord FAQ) were added locally to
`indexer/.env` as `THREEXPL_API_KEY` and `THREEXPL_DUMPS_KEY`. Neither is
committed or logged; empty or `your-...` placeholder values are treated as unset.

- **Test keys verified.** With the API key, `api.3xpl.com` returns no
  rate-limit headers (the sandbox returns `X-RateLimit-Limit: 30`); a burst of
  35 block requests in about 7 seconds all returned 200. Without a key the
  keyed endpoint returns 403. The test key's long-term quota is not published.
- **Dumps include Ironwood.** 3,636 daily `zcash-main` dumps are listed
  (2016-10-28 to 2026-10-12). The most recent (2026-10-12: 1,154 blocks, 38,494
  events, 0.90 MB zstd) downloaded with the dumps key, passed its SHA-256
  check, and contains 3,408 `ironwood-pool` rows alongside 195 `sapling-pool`
  and 88 `orchard-pool` rows.
- **Dump and API agree.** On the 337 blocks that overlap the spike, per-block
  event counts match the cached API responses exactly, and signs and amounts
  agree.
- **30-day backfill is now about 38 MB** of compressed downloads (37.7 MB for the
  latest 30 days) instead of about 29 hours of API calls.
- **Nonstandard scripts.** Dumps contain `script-<hash>` pseudo-addresses
  (94 rows that day, all zero-value data outputs). Zero-value ones are
  ignored; a value-carrying one is now kept as a transparent leg with
  `addressType: "nonstandard-script"` instead of marking the transaction
  unknown.

Dump format notes for the backfill reader: no header row; the address is in
column 7, and amounts are split into a sign column (-1 or 1) and a magnitude
column.
