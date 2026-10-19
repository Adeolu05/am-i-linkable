# Am I Linkable? — Specification

Status: draft, updated 2026-10-13.

Am I Linkable? is a free tool that tells Zcash users whether their movements
between transparent addresses and the shielded pools can be linked by amount
and timing, without the service ever learning what they checked.

It has three pieces: an **indexer** of public chain data, a **web app** with two
client-side tools, and a public **pool weather** page.

## Background: turnstiles

A Zcash transaction that moves value between a transparent address and a
shielded pool crosses that pool's *turnstile*. The amount that crossed is
public: it is the pool's value balance for that transaction. The transparent
side (addresses and amounts) is public too. Pairing a shielding (t -> z) with a
later unshielding (z -> t) of a similar amount, close in time, is the classic
round-trip linkage (see [PRIOR_ART.md](PRIOR_ART.md)).

Shielded pools on mainnet as of this spec:

| Pool     | Notes |
|----------|-------|
| Sprout   | Legacy, effectively closed. Indexed for completeness. |
| Sapling  | Active. |
| Orchard  | **Exit-only** since the Ironwood upgrade (NU6.3, block 3,428,143, 2026-07-28). Value can only leave. |
| Ironwood | Active since NU6.3. Uses the v6 transaction format. |

## 1. Indexer

Reads public chain data and stores two kinds of event.

### Turnstile events (matched)

A transaction produces one turnstile event per shielded pool whose net value
balance is non-zero, **if** the transaction also has at least one transparent
input or output. Coinbase transactions are excluded (newly minted value is not a
user movement).

| Field                | Type                                | Notes |
|----------------------|-------------------------------------|-------|
| `kind`               | `"turnstile"`                       | |
| `txid`               | hex string                          | |
| `blockHeight`        | integer                             | |
| `time`               | ISO 8601                            | Block time. |
| `pool`               | `sprout \| sapling \| orchard \| ironwood` | |
| `direction`          | `in \| out`                         | `in` = shielding (t -> pool), `out` = unshielding (pool -> t). |
| `amountZat`          | decimal string (zatoshis)           | Net value that crossed the pool's turnstile. For `out`, this includes the fee. |
| `feeZat`             | decimal string (zatoshis)           | Transaction fee. |
| `isDust`             | boolean                             | `amountZat` at or below 0.001 ZEC (100,000 zat). See [Dust](#dust). |
| `transparentInputs`  | `{address, addressType, amountZat}[]` | Transparent addresses spent from, netted per address. |
| `transparentOutputs` | `{address, addressType, amountZat}[]` | Transparent addresses paid to, netted per address. |

`addressType` is `transparent` for t1/t3/tex1 addresses, or `nonstandard-script`
for a transparent output whose script has no address form (the data source
names it `script-<hash>`). Zero-value script outputs (data-only outputs) are
ignored; value-carrying ones are kept as legs rather than marking the
transaction unknown. Only `transparent` addresses go into the lookup buckets.

Amounts are kept as strings because zatoshi totals can exceed 2^53.

### Pool-migration events (stored, not matched in v1)

A transaction with no transparent side that takes value out of one shielded pool
and into another (for example Orchard -> Ironwood after NU6.3) is stored as a
`pool-migration` event:

| Field         | Type                         | Notes |
|---------------|------------------------------|-------|
| `kind`        | `"pool-migration"`           | |
| `txid`, `blockHeight`, `time`, `feeZat` | | As above. |
| `from`        | `{pool, amountZat}[]`        | Pools value left. |
| `to`          | `{pool, amountZat}[]`        | Pools value entered. |

These amounts are public at the source pool's turnstile, but v1 does **not**
use migrations for matching. They are counted in the stats and kept for the
future work below. Transactions that stay inside a single pool (only the fee
leaves it) are counted as `shielded-internal` and not stored.

### Dust

An amount at or below **0.001 ZEC** is dust. In the spike, dust made up 1,547 of
2,245 unshields, mostly the same few tiny amounts repeated hundreds of times by
automated senders. Dust events are:

- stored, with `isDust: true`;
- **excluded from matching**;
- counted separately in the stats.

When a user enters a dust amount in a checker, the app tells them:
*"This amount is too small and common to match meaningfully."*
(`DUST_MESSAGE` in `packages/core`.)

### Retention and sync

- **30-day rolling window.** Most round-trip linkage happens within hours to
  days of the original movement, so 30 days covers the useful history while
  keeping the dataset small.
- Initial backfill: about 34,560 blocks (30 days at 75 s spacing). At the
  keyless sandbox rate (about 20 blocks a minute, observed) that takes
  **about 29 hours**, resumable thanks to the per-block cache.
- Then follow the tip, re-processing the last 100 blocks on each poll to absorb
  reorgs (Zebra does not reorg deeper than 99 blocks).
- Events older than 30 days are dropped from published datasets.

### Data source

**3xpl JSON API** (<https://3xpl.com>). Per-block events list every balance
effect, including pool pseudo-addresses (`sapling-pool`, `orchard-pool`,
`ironwood-pool`), the fee sink (`the-void`) and the dev-fund `lockbox`. Sapling
values were cross-checked against Blockchair and matched exactly.

- The keyless sandbox allows about 30 requests a minute. The indexer stays at
  **about 25 requests a minute** (2.4 s minimum interval), backs off
  exponentially on HTTP 429 and 5xx, honours `Retry-After`, and pauses when the
  `X-RateLimit-Remaining` header runs low.
- Attribution: 3xpl is credited in the README and in the site footer.
- The extraction logic is source-agnostic (it consumes signed per-address
  balance effects), so the source can change without touching matching.

**Scale-up paths**, if the sandbox becomes a bottleneck or disappears:

1. **A paid 3xpl API key** (`THREEXPL_API_KEY`): higher limits on
   `api.3xpl.com` plus the daily TSV dumps, which turn the backfill into about
   30 file downloads.
2. **A self-run Zebra node** (optionally with Zaino): no third-party dependency
   or limits, at the cost of running a full node and decoding v4/v5/v6
   transactions ourselves.

Rejected during the spike: Blockchair (reports zero shielded value change for
Ironwood/v6 transactions), raw lightwalletd (needs a transaction parser and
previous-output lookups), public Zebra RPC (none keyless).

### Published datasets (the API)

Every visitor who requests a file gets the same bytes. The collector builds
each public payload at the end of every cycle, compresses it (gzip, plus brotli
when it fits a 30-second budget) and stores it in one `snapshots` row; the
website's read-only role can read that table and nothing else, so a request
never scans events.

- `GET /api/v1/shields` (live, snapshot `shields-v1`): every non-dust shield
  from the last 30 days as compact rows `[timeOffset, amountZat, poolIndex,
  txidPrefix]`, with the generation time and tip height. Only the first 12 hex
  characters of each txid are included. ETag/304, `max-age=0`,
  `s-maxage=300`. No addresses.
- `GET /api/v1/stats` (live, snapshot `stats-v1`): aggregate counts only, for
  the home page (payload `v: 2`). Withdrawals that **stood out** (only 1–2
  matching deposits in their lookback; they may be linkable) and those that
  blended into a crowd of 10 or more, for the last 24 hours (each compared with
  the 29 days before it) and for the last 23 days (each compared with the 7
  days before it). Every withdrawal counted has its full lookback inside the
  data; see docs/MATCHING.md. A few hundred bytes, same ETag/cache headers. The home page loads only this; the
  full deposit list is downloaded on `/check`.
- `GET /api/v1/meta.json`: dataset window, generation time, and the current
  bucket plan (`prefixBits`, `bucketCount`, `minBucketSize`,
  `targetMinBucketSize`, `meetsTarget`, `totalAddresses`). The site reads this
  to display the anonymity set.
- `GET /api/v1/buckets/<bits>/<bucket-id>.json`: for one bucket, the list of
  `{addressHash, events[]}` for transparent addresses that appear in any event.
- `GET /api/v1/weather.json`: aggregates for the pool weather page.

## 2. Web app

Next.js (App Router) + Tailwind. All matching happens in the browser in
`packages/core`. No cookies, accounts, analytics or third-party requests. Fonts
are self-hosted via `next/font`.

### Tool A: "Before you move"

For someone planning to shield or unshield.

1. The browser downloads `/api/v1/shields` (identical for everyone).
2. The user enters a planned amount and direction. It never leaves the browser.
3. If the amount is dust, the app shows the dust message and stops.
4. Otherwise `core` finds non-dust events of the opposite direction whose
   amounts fall within a tolerance (exact, within the fee, within a small
   percentage) and reports how many candidates there are and how recent they are.
5. Output: a plain-language risk level, how many other movements the amount
   blends in with, and suggestions (split the amount, wait, avoid amounts that
   match a recent movement).

### Tool B: "Have I been linked?"

For someone who has already moved funds and wants to know whether a
transparent address of theirs sits in a likely round trip.

1. The browser fetches `meta.json` to learn the current `prefixBits`.
2. It computes `h = SHA-256(address)` (UTF-8 of the canonical address string).
3. It requests only the bucket for the first `prefixBits` **bits** of `h`
   (`buckets/<bits>/<bucket-id>.json`, id written as zero-padded hex).
4. It receives the whole bucket and looks for `h` locally.
5. If it finds a match, `core` runs the round-trip heuristics over that
   address's non-dust events and explains the result as *candidates*, never as
   proof.

This is a k-anonymity range query, like HaveIBeenPwned's Pwned Passwords.

**Dynamic prefix length.** Each time the dataset is rebuilt, the indexer picks
the largest bit length for which the *smallest* bucket still holds at least
**1,000 addresses** (`planBuckets` in `packages/core`). The current bit length and
smallest bucket size are published in `meta.json` and shown on the site, so
users can see their anonymity set. Bits rather than whole hex characters allow
fine control: with the spike's 2,816 addresses the plan is 1 bit (2 buckets,
smallest 1,399).

Limits we state openly: the server learns which bucket was requested, so it
learns that the address is one of at least `minBucketSize` addresses in that
bucket (or an address with no events that hashes into it). Repeated checks of
several addresses from the same network location could narrow that down. See
[PRIVACY.md](PRIVACY.md).

### 3. Pool weather page

Public aggregate statistics, computed by the indexer and served as `weather.json`:

- Shield and unshield counts and ZEC volume per pool (24 h, 7 d, 30 d), with
  dust counted separately.
- Share of non-dust unshields that are round-trip *candidates* (an exact or
  near amount match with an earlier shield).
- Distribution of amounts (how many movements share each amount band), so
  users can see where they would blend in.
- Pool migration counts and volume (Orchard -> Ironwood progress).

## Out of scope

- Wallets, keys, spending authority, or any access to funds.
- User accounts or saved history.
- Anything inside the shielded pools beyond public value balances.
- Advice tied to a specific user's finances.

## Future work

- **Matching across pool migrations.** A shield into Sapling followed by a
  Sapling -> Ironwood migration and an Ironwood unshield of a similar amount is
  still a round trip. v1 stores migrations but does not chain them into
  matches.
- Tolerance bands and time windows for the round-trip heuristics, tuned on the
  30-day dataset.
- Moving the indexer to a paid key or a self-run node if the sandbox limits bite.
