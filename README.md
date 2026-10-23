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

**Privacy self-audit:** [docs/AUDIT.md](docs/AUDIT.md) checks every layer
(browser, headers, hosting, data, collector, repo, dependencies) with the
evidence for each item and the known limitations. Re-run the browser part with
`node apps/web/scripts/privacy-audit.mjs` against a running site.

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
| `THREEXPL_MIN_INTERVAL_MS` | Minimum delay between requests (default 2400 ms keyless, about 25 a minute; 1500 ms keyed). |

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
| `SNAPSHOT_MIN_MINUTES` | start | Minimum minutes between rebuilds of the public snapshots (default 30). |
| `THREEXPL_MIN_INTERVAL_MS` | backfill, start | Minimum gap between 3xpl requests (default 1500 ms with a key, 2400 ms without). |

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

## Database egress (read this before running things locally)

Neon's free plan meters data sent **out of** the database (5 GB a month).
The production design keeps that small:

- The collector loads the 30-day window into memory **once** at startup, then
  updates it from the blocks it fetches from 3xpl. Snapshots are rebuilt from
  memory (no database reads) at most every `SNAPSHOT_MIN_MINUTES`, and only
  when something changed. The bucket plan comes back as per-prefix counts, not
  hashes, and writes use no `RETURNING`.
- Each web server instance checks a snapshot's ETag at most every 5 minutes
  and downloads a body only when the ETag changes, in one encoding.

**Local runs against the production database count toward the same quota.**
A collector start reads about 4–5 MB (the one-off window load); a backfill or
a full snapshot rebuild reads more. Avoid running them casually.

**Design work without the database:** save the current snapshots once, then
start the web app in fixture mode. It serves the saved files and never
contacts Neon.

```powershell
pnpm --filter indexer export-fixtures      # one small read (~0.6 MB) into data/fixtures/
$env:SNAPSHOT_FIXTURES_DIR = "../../data/fixtures"
pnpm dev
```

`SNAPSHOT_FIXTURES_DIR` is resolved from `apps/web`. Leave it unset in production.

## Website database role (read-only)

The website reads Postgres as `web_readonly`, a login role that can only
`SELECT` from `snapshots` (the pre-built, pre-compressed public payloads the
collector writes each cycle). Its sessions are read-only by default, and it
cannot create tables or read anything else.

```powershell
pnpm --filter indexer create-web-role
```

This creates the role (using `DATABASE_URL_UNPOOLED`), re-applies its grants,
writes the pooled read-only connection string to `apps/web/.env.local` as
`DATABASE_URL_READONLY` (gitignored), and verifies that SELECT works while
INSERT, UPDATE, DELETE, CREATE and reads of every other table are refused. It never prints the password
or the URL. Re-running it is safe; it only re-applies grants.

**Rotating the password:**

```powershell
pnpm --filter indexer create-web-role -- --rotate
```

This sets a new random password, rewrites `apps/web/.env.local`, and verifies
again. Then copy the new `DATABASE_URL_READONLY` from `apps/web/.env.local`
into your web host's environment settings and redeploy the site. The old
password stops working immediately, so update the host straight away.

## Other commands

```powershell
pnpm test        # vitest in core and indexer
pnpm typecheck   # tsc in every package
pnpm dev         # web app on http://localhost:3000
pnpm build       # web app: two builds for the CSP script hashes (see below)
pnpm --filter indexer create-web-role -- --verify   # read-only check of the web role
```

The web app's scripts (`apps/web/scripts/next.mjs`) run Next.js with
`NEXT_TELEMETRY_DISABLED=1`. `pnpm build` builds twice with one build id: the
first build is read to collect the SHA-256 of each inline script, the second
serves them in the Content-Security-Policy. If the hashes cannot be collected
or the builds differ, or if plain `next build` runs, scripts fall back to
`'self' 'unsafe-inline'` with a warning in the build log, so a deploy never
ships pages its own CSP would block. `privacy-audit.mjs` fails on that
fallback. On Vercel, keep the default build command (it runs `pnpm build` in
`apps/web`).

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
