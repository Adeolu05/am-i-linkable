# Privacy

Am I Linkable? is built so that the people running it cannot learn what you
checked. This page says exactly what that means and where the limits are.

## What the server never receives

- **No full address.** For "Have I been linked?", your browser hashes your
  transparent address with SHA-256 and sends only a short prefix of the hash.
  The full address, and the full hash, stay on your device.
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

- `shielding/recent.json`: the same file for everyone.
- `buckets/<prefix>.json`: the same file for everyone who requests that
  prefix. Each bucket covers a large number of addresses, and we publish the
  smallest, median and largest bucket sizes (the anonymity set).

Nothing in a response depends on who you are or on anything else you sent.

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
bucket, so it is one of roughly *k* addresses (the published anonymity-set size),
or an address with no recorded events that happens to share the prefix. Checking
several of your addresses one after another from the same network location
could let an observer narrow things down. Space out checks or change networks if
that is a concern.

## Results are a risk indicator, not a guarantee

The tool applies public heuristics (amount and timing matching) to public chain
data. A "low risk" result does not prove your movements are unlinkable: an
adversary may have other data (exchange records, network observations, wallet
fingerprints). A "high risk" result means a public pattern exists, not that
anyone has linked you. Use the results to make better decisions, not as proof.

## Scope

The tool never asks for, receives or stores keys, seed phrases, spending
authority or funds.
