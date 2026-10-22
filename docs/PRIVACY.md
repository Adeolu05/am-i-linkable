# Privacy

Am I Linkable? is built so that the people running it cannot learn what you
checked. This page says exactly what that means and where the limits are.

## What the server never receives

- **No address, and no hash of it.** For "Have I been linked?", your browser
  hashes your transparent address with SHA-256 and asks only for the bucket its
  first few bits fall in (currently 5 bits: one bucket number out of 32). The
  address and its full hash stay on your device. In **paranoid mode** the
  browser downloads all 32 buckets (about 3.1 MB), so the server cannot even
  tell which bucket you were interested in. Shielded and unified addresses are
  explained in the page and nothing is sent at all.
- **No planned amount.** For "Before you move", your browser downloads the
  same dataset of recent shielding events that everyone gets, and compares your
  amount locally. The amount is never sent anywhere.

## All matching happens in your browser

The matching logic lives in `packages/core` and runs client-side. The server
only serves static data files. You can verify this by watching the network tab
in your browser's developer tools: the only requests are for the page itself,
its scripts, styles and fonts (all from our own origin), and the data files
described below.

## Data responses are identical for everyone

Every data file is static and the same for every visitor who requests it:

- `/api/v1/shields` and `/api/v1/stats`: the same bytes for everyone.
- `/api/v1/buckets/<bits>/<bucket-id>`: the same bytes for everyone who asks
  for that bucket. The path holds only the bit length and the bucket number;
  anything else is rejected. The stats payload publishes the plan, including
  the smallest and largest bucket sizes (the anonymity set).

Nothing in a response depends on who you are or on anything else you sent.

## Anonymity set (live numbers, 22 October 2026)

| | |
|---|---|
| Transparent addresses with non-dust activity in the 30-day window | 39,903 |
| Bits / buckets | 5 / 32 |
| Smallest bucket | 1,186 addresses |
| Largest bucket | 1,321 addresses |
| One bucket download | about 90 KB gzip (largest 280 KB) |
| Paranoid mode (every bucket) | about 3.1 MB |

The bit length is chosen automatically at each rebuild: the most buckets for
which the smallest still holds at least 1,000 addresses. As activity grows the
buckets split; they never shrink below that floor.

## What a bucket contains, and why

A bucket is a list of `[SHA-256 of the address, events]`. It never contains an
address in plain text (a test checks stored bucket bodies for anything shaped
like a t1/t3 address and for `tex1`). Each event of that address in the window is one row:

| Field | Why it is needed |
|---|---|
| Time (seconds after the bucket's base time) | to place the event on your timeline and measure gaps |
| Amount (zatoshi) | to show which movement it was; amounts are already public on chain |
| Direction (into or out of a shielded pool) | the risk rule differs for deposits and withdrawals |
| Pool (Sapling, Orchard, Ironwood) | so you can recognise the transaction |
| First 12 hex characters of the txid | enough to find it in your wallet, not a full identifier |
| Role (spent from this address, or paid to it) | so the explanation says "you sent" or "you received" |
| Matching count, crowd size, gap, lookback days | the result of the link check, precomputed |

**No counterparties.** A row never says *which* other movement may match it:
no other address, hash or txid. The matching numbers are aggregates (how many
candidates, how big the crowd, how long the gap to the nearest one). Listing
the matching transactions would hand anyone who downloads a bucket a ready-made
map from one person's address to someone else's; the counts are enough to tell
you whether you stand out. A test checks that a bucket entry holds no hash of
another address and no txid of the matching event.

Gaps are rounded (5-minute steps under an hour, whole hours above) and dust
movements are left out, as everywhere else on the site. Rows hold no
generation time, so a bucket's bytes change only when its contents do.

## No cookies, accounts, analytics or third-party requests

- No cookies or browser storage for tracking.
- No accounts or sign-in.
- No analytics, telemetry, tag managers or session replay.
- No third-party scripts, fonts or CDNs. Fonts are self-hosted via `next/font`.

## IP addresses and logs

- **The application does not log IP addresses.** Our code does not record who
  requested what.
- **Honest disclosure:** the hosting platform (and any CDN in front of it) may
  keep standard access logs containing your IP address, user agent, time, and
  the requested path. For a bucket request, that path includes the hash prefix.
  We do not control those logs. We will name the hosting provider and link its
  log retention policy once it is chosen.
- If this matters to you, use Tor or a trusted VPN. The tool works the same way.

## What the prefix still reveals

The bucket you request tells the server that your address hashes into that
bucket, so it is one of at least 1,186 addresses today (the smallest bucket),
or an address with no recorded events that happens to share the prefix. Checking
several of your addresses one after another from the same network location
could let an observer narrow things down. Space out checks, change networks, or
use paranoid mode, which downloads every bucket and reveals nothing about which
one you wanted.

## Ethics

The data is public chain data that anyone can already analyse. The tool shows
you your own exposure so you can protect yourself; it is not meant for looking
up other people, and it cannot name who is on the other side of a movement.

## Results are a risk indicator, not a guarantee

The tool applies public heuristics (amount and timing matching) to public chain
data. A "low risk" result does not prove your movements are unlinkable: an
adversary may have other data (exchange records, network observations, wallet
fingerprints). A "high risk" result means a public pattern exists, not that
anyone has linked you. Use the results to make better decisions, not as proof.

## Scope

The tool never asks for, receives or stores keys, seed phrases, spending
authority or funds.
