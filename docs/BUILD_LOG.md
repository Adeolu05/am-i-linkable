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

## 2026-10-14: Collector on Postgres (Neon)

### Done

- Drizzle schema and first migration: `indexed_blocks`, `turnstile_events`,
  `event_addresses`, `pool_migrations`, `meta`. Child rows cascade from
  `indexed_blocks`, so reorg rollback and pruning are single deletes.
  Migrations run over Neon's direct connection (`DATABASE_URL_UNPOOLED`);
  everything else uses the pooled one with node-postgres.
- `pnpm --filter indexer backfill`: 3xpl daily dumps (checksum-verified,
  cached, stream-decompressed), then the JSON API up to the tip. Resumable.
- `pnpm --filter indexer start`: collector loop (reorg check over the last 10
  hashes, one transaction per cycle, daily prune, meta refresh, one log line,
  no connections held between cycles, graceful SIGTERM). `--once` runs one cycle.
- Dockerfile (Node 24 Alpine, non-root) and README instructions for Railway.
- Secret handling: dotenv only, nothing printed; every error goes through a
  redaction helper that strips connection strings, hosts, endpoint ids, users,
  passwords and API keys.

### Backfill results

| | |
|---|---|
| Dumps loaded | 29 (2026-09-14 .. 2026-10-12), 0 column-11 anomalies, 0 block-count mismatches |
| Dump phase | 703 s (about 12 minutes) |
| API gap fill | 1,721 blocks (3,515,759 .. 3,517,479), 1,671 s (about 1 block a second) |
| Pruned (older than 30 days) | 571 blocks |
| Coverage | blocks 3,483,075 .. 3,517,479, 2026-09-14 12:02 to 2026-10-14 11:56 UTC |

Rows after the backfill: 34,405 blocks, 93,303 turnstile events, 114,132
address rows, 9,633 pool migrations.

**Bucket plan:** 5 bits (32 buckets), smallest bucket 1,595 addresses, largest
1,762, over 53,460 distinct transparent addresses. Target of 1,000 met.

**Last 24 hours:**

| Pool | Shield | Unshield | ZEC in | ZEC out |
|---|---:|---:|---:|---:|
| Ironwood | 758 | 1,322 | 20,048.27 | 19,641.70 |
| Sapling | 100 | 121 | 1,046.92 | 1,343.67 |
| Orchard | 0 | 12 | 0 | 957.33 |
| **Total** | **858** | **1,455** | **21,095.19** | **21,942.71** |

Dust: 14 shields and 631 unshields. Pool migrations: 85 (1,983.95 ZEC left
their source pools).

### Collector check

Two `start --once` cycles after the backfill:

- `+19 blocks, +39 events, +5 migrations, indexed 3517498, tip 3517498, 20.3s`
- `+1 blocks, +1 events, +0 migrations, indexed 3517499, tip 3517499, 13.8s`

### Problems found and fixed

- **Rate-limit check paused on every keyed request.** Keyed 3xpl responses have
  no `X-RateLimit-Remaining` header, and `Number(null)` is 0, so the client
  thought the quota was spent and waited 30 s per block. Fixed (a missing
  header now means "no quota") and covered by tests; the backfill was stopped
  and resumed, skipping the 29 dumps already loaded.
- **`pnpm deploy` copied `indexer/.env` into the deploy folder** during a local
  test of the Docker bundle. The copy was deleted at once; `files` allowlists in
  the package manifests and `.dockerignore` now keep `.env` out of bundles and images.
- node-postgres warned that `sslmode=require` is treated as `verify-full`. The
  client now states `verify-full` explicitly (same, strict behaviour).
- The collector logged a misleading "dumps key not set" line; it now only does so
  for callers that use dumps.

### Open

- The 3xpl test key's long-term quota is unknown; the gap fill ran at about
  1 block a second without throttling.
- The Docker image has not been built locally (Docker Desktop was not running);
  the same `pnpm deploy` bundle was run directly instead.

## 2026-10-14 (later): Matching and "Before you move"

- **Collector fix:** 1.5 s minimum gap between keyed 3xpl requests
  (`THREEXPL_MIN_INTERVAL_MS`), after HTTP 429s while catching up. A redeploy
  is safe: SIGTERM between cycles exits cleanly, and a kill mid-cycle rolls
  back that cycle's single transaction.
- **Read-only role:** `create-web-role` created `web_readonly`. Verified: SELECT
  allowed; INSERT, UPDATE, DELETE, CREATE TABLE and reading `event_addresses`
  all refused.
- **Matching (packages/core):** fee band of 100,000 zat (99th percentile of 30
  days of unshield fees: median 15,000, p95 50,000). See docs/MATCHING.md.
- **GET /api/v1/shields:** 45,991 non-dust shields; 4.0 MB raw, 2.0 MB gzip,
  1.78 MB brotli. Uses ETag/304, an in-memory 5-minute cache with background
  refresh, and `s-maxage=300`. A cold start takes about 17 s (Neon wake plus
  the query); warm requests take about 10 ms.
- **/check:** checks run in the browser. Verified in a browser: requests go
  only to the site's own origin (page, its static assets, `/api/v1/shields`),
  and a check adds 0 requests.
- **Examples (real data):**
  - 5.15861741 ZEC: high (1 near match, 9 minutes old)
  - 1.53804745 ZEC: medium (4 matches)
  - 0.99985 ZEC: low (281 matches, 51 exact)

## 2026-10-14 (evening): Smaller payload, snapshot-backed endpoint

- **Txid prefixes:** the shields payload now carries only the first 12 hex
  characters of each txid. The page shows them as plain text, with no explorer
  links and a note on why. Payload: 45,912 shields, 1.61 MB raw, **650 KB
  gzip, 549 KB brotli** (was 4.0 MB / 2.0 MB / 1.78 MB).
- **Snapshots:** the collector (and the backfill) builds the compact payload at
  the end of each cycle, compresses it (gzip, plus brotli within a 30 s budget;
  brotli took about 3.5 s) and stores it in one `snapshots` row
  (`shields-v1`, with ETag, tip height and generation time). The
  `web_readonly` role was re-granted: SELECT on `snapshots` only. Verified:
  writes refused, and reads of `turnstile_events`, `event_addresses` and
  `meta` refused.
- **Endpoint:** reads that one row. A cold start fetches the ETag and the
  needed body in a single query; after that it only re-checks the ETag every
  60 s. Measured from the development machine (far from Neon's region:
  ~2.1 s TLS connect, ~2 s to download the body):

| Request | Before | Now |
|---|---:|---:|
| Cold (fresh server) | 17–19 s | 5.1 s |
| Warm | ~10 ms | 6–15 ms |
| Revalidation (304) | n/a | 6 ms |

- **Re-verified in the browser:** only same-origin requests (the page, its
  static assets, `/api/v1/shields`); three checks added 0 requests. High,
  medium and low examples unchanged.

## 2026-10-16: Design upgrade ("Glassmorphism 2.0")

- **Design system:** tokens in one `@theme` block in `apps/web/app/globals.css`
  (colours, Zcash gold `#F4B728`, risk colours, radii, blur, shadows, motion).
  Frosted glass over a slowly drifting gradient scene (navy, teal, a hint of
  gold), with a solid fallback without `backdrop-filter` or with reduced
  transparency. Bricolage Grotesque for display, Inter for body, JetBrains Mono
  for amounts; all self-hosted via next/font, tabular numbers. Motion stops
  under `prefers-reduced-motion`.
- **Home:** hero with one call to action, a live proof strip, 3 steps, the
  privacy promise and "Have I been linked?" (coming soon).
- **Proof strip data:** the collector adds aggregate counts only (`stats`) to
  the shields snapshot (`computeLinkStats` in core, same matching rule as the
  checker). At build time, 86 of 939 withdrawals in the last 24 h stood out
  (only 1–2 possible deposits; they may be linkable), while 600 blended into a
  crowd of 10 or more. (A raw "matched any earlier deposit" count, 821, was
  shown at first but overstates risk because it includes crowd matches; it was
  replaced the same day, see below.)
- **Check page:** colour-coded result header (icon + word + verdict), "The
  crowd" SVG dot plot with a text summary, a "wait" mini-chart (now, +1, +3, +7
  days), action cards, a tidier matches list (12-character prefixes, plain
  text), "Try a risky example" and "Try a common amount" (picked on the
  device), and a prominent privacy receipt.
- **Verified with headless Chrome (DevTools protocol, network log):** at 375,
  768 and 1440 px, no horizontal scroll; every request went to the site's own
  origin (page, static assets, `/api/v1/shields`); clicking an example (a
  check) added 0 requests. JS: about 183 KB gzip on /check, mostly
  React/Next; no chart libraries.

## 2026-10-16 (later): Honest headline, light home page

- **Headline:** the home proof strip now leads with withdrawals that **stood
  out** in the last 24 hours (only 1–2 earlier matching deposits; they may be
  linkable): 86 of 938 at build time, with context that most blended into a
  crowd (599 matched 10 or more deposits). The raw "matched any earlier
  deposit" count is no longer shown as a headline because it includes crowd
  matches and overstates risk.
- **GET /api/v1/stats:** the collector writes the aggregate counts as their own
  snapshot row (`stats-v1`, about 200 B gzip, 172 B brotli), served with the
  same no-parameters, ETag/304 and cache pattern through a shared snapshot
  handler. `web_readonly` reads it via its existing SELECT on `snapshots`
  (create-web-role re-run and verified).
- **Home page weight (cold load, headless Chrome):** 819 KB before, **285 KB**
  after; its only data request is `/api/v1/stats` (~1 KB). `/check` still
  loads `/api/v1/shields` (532 KB brotli).
- Re-verified: same-origin only on every page and width; checks add 0
  requests; no horizontal scroll at 375, 768 and 1440 px.

## 2026-10-18: Cutting database egress

Neon's free plan reported 4 GB of its 5 GB monthly egress used in about 5
days. Estimates below use the Postgres wire format (text rows) and the known
row counts (~44k non-dust shields, ~43k unshields, ~53.5k distinct addresses
in the window). No heavy queries were run to measure.

**Before, per collector cycle (~8.3 MB):**

| Query | Egress |
|---|---:|
| Bucket plan: every distinct address hash (`encode(address_hash)`) | ~4.0 MB |
| Snapshot rebuild: all window shields | ~2.8 MB |
| Stats: all window unshields | ~1.5 MB |
| RETURNING on inserts, reorg check, meta, window stats | ~10 KB |

At 10-minute cycles that is **~1.2 GB/day** (0.4 GB/day at 30 minutes). Web:
each active instance re-downloaded the 0.55 MB shields body after every
snapshot change (up to 144 a day) plus an ETag check every minute.

**After:**

- The collector loads the window into memory once at startup (~5 MB) and then
  updates it from the blocks it fetches from 3xpl; reorg rollbacks drop the
  affected heights from memory, and any error forces a full reload next cycle.
  Snapshots are rebuilt from memory (zero reads) only when something changed
  and at most every `SNAPSHOT_MIN_MINUTES` (default 30).
- The bucket plan comes back as per-12-bit-prefix counts (≤ 4,096 rows,
  ~90 KB) and is recomputed only with a snapshot rebuild; writes use no
  `RETURNING`.
- Web: each instance checks the ETag at most every 5 minutes and downloads one
  body per ETag change, in one encoding (other encodings are made locally).
  Unit tests count the queries and downloads.
- Local design work can use fixture mode (`SNAPSHOT_FIXTURES_DIR`) with no
  database at all.

| | Before | After |
|---|---:|---:|
| Collector, per cycle | ~8.3 MB | ~5 KB |
| Collector, per snapshot rebuild | (every cycle) | ~95 KB (≤ 48/day) |
| Collector, per day | ~1.2 GB (10-min) / ~0.4 GB (30-min) | **~5 MB** (plus ~5 MB per restart) |
| Web, per active instance per day (worst case) | up to ~80 MB + 1,440 checks | ≤ ~26 MB + ≤ 288 checks |

Tests: the in-memory window equals a full database rebuild after several
cycles, after a prune and after a reorg; snapshots are skipped when unchanged
or not yet due.

Also: Next 16's `next dev` wrote an AGENTS.md file into apps/web; it was
removed and disabled with `agentRules: false` so tooling instruction files
never enter the repo.

## 2026-10-19: Polish after reviewing the live site

- **Honest 30-day stats.** The old 30-day stood-out count compared each
  withdrawal with "all earlier deposits we have", so withdrawals early in the
  30-day window (with little history) stood out more easily. Every withdrawal
  is now compared with a fixed lookback lying fully inside the data, and
  withdrawals without it are not counted: the home tiles cover the last 23
  days, each withdrawal vs the 7 days before it. The 24-hour headline did
  **not** have a full 30-day lookback (a withdrawal 20 h ago would need 30 days
  and 20 h of history), so it now uses 29 days, which every last-24-hour
  withdrawal fully has. Stats payload is `v: 2`; MATCHING.md explains the
  reasoning, and a test shows the naive method flagging old withdrawals that
  the fixed lookback does not. First live numbers: 64 of 816 withdrawals in the
  last 24 h stood out; over 23 days, 4,360 of 22,579 stood out vs the 7 days
  before them.
- **Crowd chart.** Three lanes: larger amounts, a tall shaded matching zone,
  smaller amounts. Nearby deposits are faded, sit in their own lanes on a log
  distance scale, and never overlap the zone; matching deposits are large, in
  the risk colour, with "36 min ago"-style tags on leader lines in rows that
  never overlap. Labels live in a gutter no dot can enter. A common amount
  fills the whole zone. Geometry is a pure, tested function (`crowdLayout`).
- **Background seams: a stitching artifact, not a real bug.** Measured with
  per-row colour analysis of the page margin: zero abrupt colour jumps in real
  scrolling viewports and in a single-pass full-page capture. Each viewport
  goes from navy at the top to near-black at the bottom (the background is
  fixed), so a tool that stitches scrolled viewport captures puts a hard edge
  at every viewport height. Nothing to fix in the page.
- **Privacy receipt:** the hostname sits on its own line, never broken, with an
  ellipsis if it ever does not fit.
- **Verified in fixture mode (no database):** 375/768/1440 px, no horizontal
  scroll, same-origin requests only, checks add 0 requests. Fixtures refreshed
  with `export-fixtures -- stats-v1` (a few hundred bytes).

## 2026-10-22: "Have I been linked?" (private address check)

- **Address handling in `core`.** t1/t3 Base58Check validation, TEX (ZIP 320)
  decoded and converted to its t1 form; shielded, unified and testnet input is
  explained and nothing is sent. A pure TypeScript SHA-256 is shared by the
  browser and the collector; tests compare it with Node's crypto and WebCrypto.
- **Buckets from the in-memory window.** The collector now also loads the
  transparent address rows of non-dust events in the window (hashed locally)
  and builds `bucket-v1-<bits>-<id>` snapshots after each cycle. A bucket is
  rewritten only when its ETag changes, old-plan rows are removed when the plan
  changes, and the result equals a fresh database load after cycles, a prune
  and a reorg (tested). Rows hold full hashes and per-event aggregates only: no
  plaintext addresses and no counterparties (both tested).
- **Endpoint.** `GET /api/v1/buckets/<bits>/<id>`, strictly validated (400), a
  different bit length gets 409 "reload" and no data; same cache, ETag and
  no-cookie pattern as the other snapshots. The plan is in the stats payload.
- **Page `/linked`.** Input, Check, paranoid toggle with its download size,
  privacy receipt saying exactly what was sent, a verdict, a colour-coded
  timeline in plain English, advice, the no-activity message (which proves
  nothing about older activity) and an ethics line. Home card is live; nav has
  both tools.
- **Numbers (built locally with `export-fixtures --build`, read-only):**
  39,903 addresses, 5 bits, 32 buckets of 1,186 to 1,321; gzip about 90 KB per
  bucket (largest 280 KB), 3.1 MB for paranoid mode. Egress: the collector's
  startup load grows from about 5 MB to about 12 MB; a normal cycle reads about
  5 KB more; bucket writes are ingress.
- **Verified in fixture mode:** a normal check makes 1 request, paranoid 32, a
  shielded address 0; all same-origin; no horizontal scroll at 375/768/1440 px.

## 2026-10-23: Privacy self-audit before submission

Every layer checked; the full checklist with evidence is in docs/AUDIT.md.
What changed:

- **Amount no longer in a URL.** The home page used to hand an amount to
  `/check` in the fragment (`/check#2.5`). It was never sent to a server, but
  it did leave a browser history entry. The amount is now handed over in
  memory, and `/check` ignores an amount in a fragment; only the fixed words
  `#risky` and `#common` remain.
- **Strict Content-Security-Policy without `unsafe-inline` for scripts.** The
  pages are static, so nonces would have meant rendering every page on demand.
  Instead `apps/web/scripts/next.mjs` builds twice with one build id, collects
  the SHA-256 of each inline script from the first build and serves them in
  the CSP of the second. If that fails (no hashes, the builds differ, or a
  plain `next build`), scripts fall back to `'self' 'unsafe-inline'` with a
  warning in the build log rather than failing the deploy; the first version
  failed hard, and its first Vercel deploy failed, so the live site stayed on
  the previous deployment until the fallback landed. Also: `frame-ancestors 'none'`,
  `form-action 'none'`, a Permissions-Policy that denies 33 features,
  `X-Frame-Options`, HSTS, COOP and CORP. Checked in the browser that injected
  inline scripts, external scripts and third-party fetches are blocked.
- **Next.js 16.4.0 → 16.4.3** for three published advisories (Image
  Optimization with SVGs, `use cache`, Server Actions DoS); the site used none
  of those features.
- **Telemetry off for every Next.js command** (`NEXT_TELEMETRY_DISABLED=1` in
  the package scripts).
- **Reusable browser audit** (`apps/web/scripts/privacy-audit.mjs`): headless
  Chrome checks third-party requests, what Check sends, CSP violations,
  cookies and storage, history entries and titles, input attributes and
  headers. Locally, fixture mode: 33 passed, 0 failed.
- **Stats test** now asserts the payload is aggregates only (no lists, only
  numbers and the generation time).
- **Read-only role check:** `create-web-role -- --verify` reads the catalog and
  probes as `web_readonly` without changing anything. SELECT on `snapshots`
  only; everything else refused.
- **Collector:** the 3xpl network-retry log line now goes through the same
  redaction as every other error.
- PRIVACY.md names the host (Vercel) and what its logs keep.

Tests: 128 (core 51, indexer 51, web 26). gitleaks over all refs and the
stash: no leaks.
