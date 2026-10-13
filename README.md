# Am I Linkable?

A free tool that tells Zcash users whether their transparent <-> shielded
movements can be linked by amount and timing, **without ever learning what they
checked**. All matching runs in your browser. Built for ZECATHON (Core & Tooling track).

- **Before you move:** check a planned shield or unshield amount against recent
  public turnstile activity, locally.
- **Have I been linked?:** check a transparent address with a k-anonymous
  SHA-256 prefix query (like HaveIBeenPwned), matched locally.
- **Pool weather:** public aggregate stats for Sapling, Orchard and Ironwood.

See [docs/SPEC.md](docs/SPEC.md), [docs/PRIVACY.md](docs/PRIVACY.md),
[docs/PRIOR_ART.md](docs/PRIOR_ART.md) and [docs/BUILD_LOG.md](docs/BUILD_LOG.md).

## Layout

```
apps/web/        Next.js (App Router) + Tailwind front end (placeholder for now)
packages/core/   Pure TypeScript matching logic, tested with vitest
indexer/         Node + TypeScript service that reads public chain data
docs/            Spec, privacy model, prior art, build log
data/            Local output and caches (gitignored)
```

## Requirements

- Node.js 22.15 or newer (tested on 24)
- pnpm 9 (`corepack enable` sets it up from `packageManager`)

## Setup (Windows / PowerShell 7)

```powershell
git clone git@github.com:Adeolu05/am-i-linkable.git
cd am-i-linkable
pnpm install
```

## Run the turnstile spike

The spike pulls the most recent ~1,000 mainnet blocks, extracts every
transaction that moves value between a transparent address and a shielded pool
(Sapling, Orchard or Ironwood), prints a summary, and writes JSON to
`data/spike/`.

```powershell
pnpm spike
```

Options (pass them after `--`):

```powershell
pnpm spike -- --blocks 200        # scan fewer blocks
pnpm spike -- --tip 3516000       # end at a fixed height, for reproducible runs
```

Data source: the [3xpl](https://3xpl.com/data/json-api) JSON API. No key is
needed: without one the spike uses the keyless sandbox, which is rate limited
to about 30 requests a minute, so 1,000 blocks take around 35-40 minutes.
Raw block data is cached in `data/cache/`, so if you interrupt it (Ctrl+C) and
run it again, it resumes where it stopped and re-runs are instant.

Optional settings go in `indexer/.env` (copy from `indexer/.env.example`, never commit it):

| Variable | Purpose |
|---|---|
| `THREEXPL_API_KEY` | Use the keyed `api.3xpl.com` endpoint instead of the sandbox. |
| `THREEXPL_MIN_INTERVAL_MS` | Minimum delay between requests (default 2100 ms keyless, 250 ms keyed). |

Output:

- `data/spike/summary.json`: blocks scanned, transaction classes, shield and
  unshield counts per pool, exact-amount round-trip candidates.
- `data/spike/turnstile-events.json`: every extracted event.

## Other commands

```powershell
pnpm test        # vitest in core and indexer
pnpm typecheck   # tsc in every package
pnpm dev         # web app on http://localhost:3000
```

Next.js collects anonymous build telemetry by default. To turn it off on your
machine, run `pnpm --filter @ail/web exec next telemetry disable`.

## Privacy in one paragraph

The server never receives a full address or a planned amount. Data files are
static and identical for everyone who requests them. No cookies, accounts,
analytics or third-party requests. The app does not log IPs, but the hosting
platform may keep access logs; see [docs/PRIVACY.md](docs/PRIVACY.md). Results
are a risk indicator, not a guarantee.
