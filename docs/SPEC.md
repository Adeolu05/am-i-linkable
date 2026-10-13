# Am I Linkable? — Specification

Status: draft, 2026-10-13.

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

Reads public chain data and stores **turnstile events**.

### Event definition

A transaction produces one turnstile event per shielded pool whose net value
balance is non-zero, **if** the transaction also has at least one transparent
input or output. Coinbase transactions are excluded (newly minted value is not a
user movement).

| Field                | Type                                | Notes |
|----------------------|-------------------------------------|-------|
| `txid`               | hex string                          | |
| `blockHeight`        | integer                             | |
| `time`               | ISO 8601                            | Block time. |
| `pool`               | `sprout \| sapling \| orchard \| ironwood` | |
| `direction`          | `in \| out`                         | `in` = shielding (t -> pool), `out` = unshielding (pool -> t). |
| `amountZat`          | decimal string (zatoshis)           | Net value that crossed the pool's turnstile. For `out`, this includes the fee. |
| `feeZat`             | decimal string (zatoshis)           | Transaction fee. |
| `transparentInputs`  | `{address, amountZat}[]`            | Transparent addresses spent from, netted per address. |
| `transparentOutputs` | `{address, amountZat}[]`            | Transparent addresses paid to, netted per address. |

Amounts are kept as strings because zatoshi totals can exceed 2^53.

Transactions that move value between pools with no transparent side (for
example Orchard -> Ironwood migrations) are counted but not stored as events in
v1. Their amounts are public as well; whether to index them is an open
question (see below).

### Retention and sync

- Backfill the last **90 days** of blocks (about 103,000 blocks at 75 s spacing).
- Then follow the tip, handling reorgs by re-processing the last N blocks
  (N = 100, well above Zebra's 99-block finality limit) on each poll.
- Events older than 90 days are dropped from published datasets.

### Data source

The spike (2026-10-13) evaluated three options:

| Option | Result |
|--------|--------|
| lightwalletd / Zaino gRPC (`zec.rocks:443`) | Reachable and keyless. Compact blocks omit value balances, so it needs raw transaction parsing (v4, v5 and the new v6 format) plus a lookup of every transparent input's previous output to get addresses and amounts. Most work, most independent. |
| Blockchair API | Keyless for light use. **Rejected for now:** it reports `shielded_value_delta = 0` for Ironwood/v6 transactions, so it misses most current turnstile traffic. It is correct for Sapling. |
| Public Zebra JSON-RPC | No keyless public endpoint found. Providers (GetBlock, QuickNode) need an account token. |
| **3xpl JSON API** | **Chosen for the spike.** Per-block events list every balance effect, including pool pseudo-addresses (`sapling-pool`, `orchard-pool`, `ironwood-pool`), the fee sink (`the-void`) and the dev-fund `lockbox`. The keyless sandbox allows about 30 requests a minute. Sapling values were cross-checked against Blockchair and matched exactly. |

Production plan: keep the extraction logic source-agnostic (it consumes signed
per-address balance effects) and move to our own Zebra node (or Zaino) for the
90-day backfill and tip-following, with 3xpl as a cross-check. 3xpl's daily
TSV dumps would make the backfill cheap but require an API key.

### Published datasets

The indexer emits static files. Every visitor who requests a file gets the same
bytes.

- `shielding/recent.json`: all events from the last 90 days, minimal fields
  (height, time, pool, direction, amount, fee). No addresses.
- `buckets/<prefix>.json`: for each hash prefix, the list of
  `{addressHash, events[]}` for transparent addresses that appear in any event.
- `weather.json`: the aggregates for the pool weather page.
- `meta.json`: dataset height, generation time, prefix length, and the
  anonymity-set sizes (minimum, median and maximum addresses per bucket).

## 2. Web app

Next.js (App Router) + Tailwind. All matching happens in the browser in
`packages/core`. No cookies, accounts, analytics or third-party requests. Fonts
are self-hosted via `next/font`.

### Tool A: "Before you move"

For someone planning to shield or unshield.

1. The browser downloads `shielding/recent.json` (identical for everyone).
2. The user enters a planned amount and direction. It never leaves the browser.
3. `core` finds events of the opposite direction whose amounts fall within a
   tolerance (exact, within the fee, within a small percentage) and reports how
   many candidates there are and how recent they are.
4. Output: a plain-language risk level, how many other movements the amount
   blends in with, and suggestions (split the amount, wait, avoid round numbers
   that match a recent deposit).

### Tool B: "Have I been linked?"

For someone who has already moved funds and wants to know whether a
transparent address of theirs sits in a likely round trip.

1. The browser computes `h = SHA-256(address)` (UTF-8 of the canonical address string).
2. It requests only `buckets/<first P hex chars of h>.json`.
3. It receives the whole bucket and looks for `h` locally.
4. If it finds a match, `core` runs the round-trip heuristics over that
   address's events against the recent dataset and explains the result.

This is a k-anonymity range query, like HaveIBeenPwned's Pwned Passwords.
The prefix length `P` is chosen so that every bucket holds a large number of
addresses (target: a minimum of 1,000 per bucket; calibrated once real counts are
known). The current anonymity-set sizes are published in `meta.json` and shown
in the UI.

Limits we state openly: the server learns which bucket was requested, so it
learns that the address is one of the roughly k addresses in that bucket (or
an address that hashes into it but has no events). Repeated checks of several
addresses from the same network location could narrow that down. See
[PRIVACY.md](PRIVACY.md).

### 3. Pool weather page

Public aggregate statistics, computed by the indexer and served as `weather.json`:

- Shield and unshield counts and ZEC volume per pool (24 h, 7 d, 90 d).
- Share of unshields whose amount exactly or nearly matches an earlier shield
  (a network-wide linkability rate).
- Distribution of amounts (how many movements share each amount band), so
  users can see where they would blend in.
- Orchard -> Ironwood migration progress.

## Out of scope

- Wallets, keys, spending authority, or any access to funds.
- User accounts or saved history.
- Anything inside the shielded pools beyond public value balances.
- Advice tied to a specific user's finances.

## Open questions

1. Whether to index shielded-only cross-pool movements (Orchard -> Ironwood
   migrations reveal their amounts at the Orchard turnstile).
2. Final prefix length and minimum bucket size, once 90 days of real addresses
   are counted.
3. Whether the indexer runs its own Zebra node or uses a keyed 3xpl plan for
   the backfill.
4. Tolerance bands and time windows for the round-trip heuristics.
