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

### Spike results (blocks 3,515,422 to 3,516,421)

Time span: 2026-10-12 17:05 to 2026-10-13 14:00 UTC (about 21 hours).
982 requests, about 50 minutes on the keyless sandbox, 0 HTTP errors.

| Transactions | Count |
|---|---|
| Turnstile (t <-> pool) | 3,269 |
| Coinbase | 1,000 |
| Shielded-only (pool <-> pool, e.g. Orchard -> Ironwood) | 1,258 |
| Transparent-only | 2,733 |
| Unrecognised | 0 |

| Pool | Shield | Unshield | ZEC in | ZEC out |
|---|---:|---:|---:|---:|
| Sapling | 85 | 77 | 1,377.19 | 1,401.94 |
| Orchard | 0 | 18 | 0 | 37.43 |
| Ironwood | 942 | 2,150 | 3,581.44 | 5,072.41 |
| **Total** | **1,027** | **2,245** | | |

- 2,816 distinct transparent addresses touch a turnstile in 21 hours.
- Orchard shows no shielding at all, only exits, which confirms it is exit-only.
- **Dust dominates unshield counts:** 1,554 of 2,245 unshields move at most
  0.001 ZEC net of fee (mostly 20,000 or 5,000 zat outputs, repeated hundreds of
  times). They look automated.
- Exact-amount round-trip candidates (an unshield whose exact amount was
  shielded earlier in the window): 1,473 including dust, **62 excluding dust**.
  Separately, 57 amounts appear exactly once as a shield and once as a later
  unshield in the window, the strongest kind of match (Quesnelle's uniqueness
  criterion).

### Open decisions

1. Long-term data source: run our own Zebra node (or Zaino) vs a keyed 3xpl
   plan for the 90-day backfill (about 103,000 blocks; about 86 hours on the
   keyless sandbox at the observed rate).
2. Whether to index Orchard -> Ironwood migrations (no transparent side, but
   the Orchard turnstile amount is public).
3. A dust threshold for matching and for the published datasets.
4. Final k-anonymity prefix length. At about 2,800 addresses per day, a 90-day
   set may hold on the order of 100,000 to 200,000 addresses (not deduplicated
   yet). For a minimum bucket of 1,000 that means a prefix of about 7 bits, so
   prefixes should be specified in bits rather than whole hex characters.

### Next

- Move the matching heuristics (exact, fee-adjusted, tolerance bands, time
  windows) into `packages/core` with tests.
- Decide the indexer storage format and the published-dataset layout.
