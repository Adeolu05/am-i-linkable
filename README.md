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
needed: without one the spike uses the keyless sandbox (about 30 requests a
minute allowed). The client stays at about 25 requests a minute and backs off on
errors, so 1,000 blocks take around 50 minutes.
Raw block data is cached in `data/cache/`, so if you interrupt it (Ctrl+C) and
run it again, it resumes where it stopped and re-runs are instant.

Optional settings go in `indexer/.env` (copy from `indexer/.env.example`, never commit it):

| Variable | Purpose |
|---|---|
| `THREEXPL_API_KEY` | Use the keyed `api.3xpl.com` endpoint instead of the sandbox. |
| `THREEXPL_MIN_INTERVAL_MS` | Minimum delay between requests (default 2400 ms keyless, about 25 a minute; 250 ms keyed). |

Output:

- `data/spike/summary.json`: blocks scanned, transaction classes, shield and
  unshield counts per pool, dust counts, pool migrations, round-trip
  candidates and the bucket plan.
- `data/spike/meta.json`: the k-anonymity bucket plan (prefix bits, smallest
  bucket size), in the shape the site will read.
- `data/spike/turnstile-events.json`: every turnstile event (dust flagged with `isDust`).
- `data/spike/pool-migrations.json`: shielded -> shielded pool migrations
  (stored, not matched in v1).

## Running the collector

The collector keeps a rolling 30-day window of turnstile events in Postgres
(Neon). It reads public chain data only.

### Environment variables

Names only; put the values in `indexer/.env` locally (see
`indexer/.env.example`) or in your host's secret settings. Never commit them.

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | backfill, start | Neon **pooled** connection string. |
| `DATABASE_URL_UNPOOLED` | migrate | Neon **direct** connection string (Neon recommends it for migrations). |
| `THREEXPL_API_KEY` | backfill, start | 3xpl JSON API token. Optional (falls back to the rate-limited sandbox). |
| `THREEXPL_DUMPS_KEY` | backfill | 3xpl dumps token. Optional (without it the backfill uses the JSON API only). |
| `INTERVAL_MINUTES` | start | Minutes between cycles (default 10). |

### Locally (PowerShell 7)

```powershell
pnpm install
pnpm --filter indexer migrate     # create or upgrade the tables
pnpm --filter indexer backfill    # last 30 days: daily dumps, then the API up to the tip
pnpm --filter indexer start       # collector loop; Ctrl+C stops after the current cycle
pnpm --filter indexer start -- --once   # a single cycle, then exit
```

The backfill is resumable: re-run it after an interruption and it continues.
Downloaded dumps are cached (checksum-verified) in `data/3xpl-dumps/`.

Each cycle checks the last 10 stored block hashes for reorgs, adds new blocks
in one transaction, prunes data older than 30 days once a day, refreshes the
bucket plan and stats in the `meta` table, and logs one line. Between cycles
it holds no database connections, so Neon can scale to zero.

### On Railway

1. Create a service from this GitHub repo.
2. Set the builder to Dockerfile with path `indexer/Dockerfile`, and leave the
   root directory as the repo root (the image builds the pnpm workspace).
3. Add the variables above in the service's Variables tab.
4. Run migrations once, either locally with `pnpm --filter indexer migrate` or
   as a one-off Railway command: `node --import tsx src/migrate.ts`.
5. Run the backfill once (locally is fine; it writes to the same database).
6. Deploy. The container runs `start` as a non-root user and stops cleanly on
   SIGTERM during redeploys.

To build the image yourself: `docker build -f indexer/Dockerfile -t am-i-linkable-indexer .`

## Other commands

```powershell
pnpm test        # vitest in core and indexer
pnpm typecheck   # tsc in every package
pnpm dev         # web app on http://localhost:3000
```

Next.js collects anonymous build telemetry by default. To turn it off on your
machine, run `pnpm --filter @ail/web exec next telemetry disable`.

## Credits

Public chain data comes from [3xpl](https://3xpl.com), via its free sandbox
JSON API. Thank you to the 3xpl team.

## Privacy in one paragraph

The server never receives a full address or a planned amount. Data files are
static and identical for everyone who requests them. No cookies, accounts,
analytics or third-party requests. The app does not log IPs, but the hosting
platform may keep access logs; see [docs/PRIVACY.md](docs/PRIVACY.md). Results
are a risk indicator, not a guarantee.

## License

[MIT](LICENSE), copyright 2026 David Peluola.
