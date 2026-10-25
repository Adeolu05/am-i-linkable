# Privacy self-audit

Audited on 23 October 2026, before submission. Every layer was checked: the
browser, security headers, hosting, the published data, the collector, the
repository and the dependencies. Each item is **PASS** (already true) or
**FIXED** (wrong or missing, fixed in this audit), with the evidence: a
command, a test name or an observation.

The browser checks are automated, so anyone can repeat them:

```
pnpm --filter @ail/web build
pnpm --filter @ail/web start            # or any deployed URL
node apps/web/scripts/privacy-audit.mjs http://localhost:3000
```

The script drives headless Chrome over the DevTools protocol, loads every page,
runs every kind of check, and fails on any of the problems listed in section 1.
It ran locally in fixture mode (real exported data, no database): **33 passed,
0 failed**.

Against the live site (`https://am-i-linkable.vercel.app`, deployment of
commit `649d894`) it ran once with `--light` (one load of each page, one amount
hand-off and one address check, to keep load on the host minimal): **26
passed, 1 failed**. The one failure is the open item in section 2: on Vercel,
scripts are currently allowed by `'self' 'unsafe-inline'` instead of hashes.
Everything else held on production, including no third-party requests, no
cookies or storage, nothing in URLs or history, exactly one bucket request, and
no CSP violations.

## 1. Browser

| Item | Result | Evidence |
|---|---|---|
| No third-party requests on any page | PASS | `privacy-audit.mjs`: "every request goes to this origin" for `/`, `/check`, `/linked` and a 404 page, and for all 150 requests in the run. Fonts are self-hosted by `next/font`. |
| The page cannot contact a third party even if a script tried | FIXED | New CSP (section 2): `connect-src 'self'`, `default-src 'self'`. Checked in the browser by injecting a script that adds an inline script, an external script and a `fetch` to another site: all three were blocked and reported as CSP violations. |
| No cookies | PASS | `privacy-audit.mjs`: 0 `Set-Cookie` headers on any response and 0 cookies in the browser after every check. No code reads or writes cookies (`grep` for `cookie` in `apps/web`). |
| No amounts or addresses in localStorage, sessionStorage, IndexedDB or Cache Storage | PASS | `privacy-audit.mjs`: all four empty after every kind of check. No code uses browser storage. |
| Amounts never in a URL, query string, history entry or title | FIXED | The home page handed the amount to `/check` in the URL fragment (`/check#2.5`). The fragment is never sent to a server, but it did create a browser history entry holding the amount. The amount is now handed over in memory (`apps/web/lib/amountHash.ts`) and `/check` ignores any amount in a fragment. Only the two fixed example words (`#risky`, `#common`) still use the fragment, and it is cleared once read. Tests: `amountHash.test.ts` "never reads an amount from a URL" and "in-memory hand-over". `privacy-audit.mjs`: "the amount is handed over without a URL" and "No amount or address in any history entry URL or title" (checked against Chrome's own navigation history). |
| Addresses never in a URL, query string, history entry or title | PASS | The address stays in page state. `privacy-audit.mjs` checks every request URL, history entry and title for the address, for its SHA-256 (hex, base64 and base64url) and for the shielded address. |
| Page titles are fixed | PASS | Titles come from static `metadata` per page; no code sets `document.title`. |
| Inputs: `autocomplete="off"`, spellcheck off | PASS | Both inputs (`components/Prompt.tsx`) have `autocomplete="off"`, `spellcheck="false"`, `autocorrect="off"` and `autocapitalize="off"`. Spellcheck off stops browser "enhanced spellcheck" features from sending the text to a service. `privacy-audit.mjs` checks every input on every page. |
| A form submitted before the page's script runs sends nothing | PASS | The inputs have no `name`, so a native submission carries no value; the CSP's `form-action 'none'` now blocks native submission as well. |
| Check sends nothing on `/check` | PASS | `privacy-audit.mjs`: "/check: a check sends nothing" (0 requests). The netlog on the page shows the same count from the browser's own Performance API. |
| Check on `/linked` sends only the documented bucket request | PASS | `privacy-audit.mjs`: 1 request (`/api/v1/buckets/5/<id>`) for a t-address, all 32 buckets in paranoid mode, 0 requests for a shielded address, and no request carries the address or its hash. |
| Referrer never leaks the page to 3xpl (footer link) | PASS | The link has `rel="noreferrer noopener"` and the site sends `Referrer-Policy: no-referrer`. Opening it is a navigation the user chooses; nothing loads from 3xpl. |

## 2. Security headers

Set for every path in `apps/web/next.config.ts`. Verified on the documents by
`privacy-audit.mjs` and with `curl -I`.

| Header | Result | Value / evidence |
|---|---|---|
| Content-Security-Policy | FIXED (was missing; live on Vercel) | `default-src 'self'; script-src 'self' 'sha256-…' (8 hashes; on Vercel for now `'self' 'unsafe-inline'`, see next row); style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; worker-src 'none'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'` |
| No `unsafe-inline` or `unsafe-eval` for scripts | **OPEN on Vercel** (FIXED locally) | Locally the CSP carries 8 script hashes and no `unsafe-inline`. On Vercel the build script runs (the live pages carry its 12-character build id), but its hash step fell back, so production currently serves `script-src 'self' 'unsafe-inline'`. Vercel builds through its own build adapter (for example, it serves chunks from `/_next/static/immutable/`), so its prerendered pages either sit somewhere else or differ between the two builds; the `[csp]` lines in the Vercel build log say which. Even with the fallback, scripts can only come from this origin and `connect-src 'self'` stops any script from sending data elsewhere. How it works: every page is static, so there is no per-request nonce. `apps/web/scripts/next.mjs` builds twice with one build id: the first build is read for the SHA-256 of each inline script (our animation gate and the scripts Next.js writes), and the second serves exactly those hashes. If the second build contains any inline script not in the list, or no hashes can be collected, or plain `next build` runs, scripts fall back to `'self' 'unsafe-inline'` with a warning in the build log, so a deploy never ships a page its own CSP would block. `privacy-audit.mjs` fails on that fallback, so it cannot go unnoticed. |
| The site works under the CSP | PASS | `privacy-audit.mjs` runs every kind of check under the CSP: "No Content-Security-Policy violations", "No script errors", and results render. |
| `frame-ancestors 'none'` (+ `X-Frame-Options: DENY`) | FIXED | Both set. |
| `Referrer-Policy: no-referrer` | PASS | Also set as `<meta name="referrer">` by the root layout. |
| Permissions-Policy denying everything | FIXED | Was 4 features. Now 33 features set to `()`: camera, microphone, geolocation, clipboard, payment, USB, serial, Bluetooth, HID, sensors, `browsing-topics` and more. |
| `X-Content-Type-Options: nosniff` | PASS | |
| HSTS | FIXED | `Strict-Transport-Security: max-age=63072000; includeSubDomains` from our config. Vercel also sends its own HSTS on `*.vercel.app`. |
| Also added | FIXED | `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `X-DNS-Prefetch-Control: off`. `X-Powered-By` stays off. |

`style-src` keeps `'unsafe-inline'` because React writes some `style=""`
attributes. Styles cannot run code, and with `default-src`/`connect-src`/
`img-src`/`font-src` limited to this origin they cannot send anything anywhere.

## 3. Server and CDN

| Item | Result | Evidence |
|---|---|---|
| Our code logs nothing about requests | PASS | No `console.*` or logger call anywhere in `apps/web/app`, `apps/web/lib` or `apps/web/components`. No route reads request headers other than `Accept-Encoding` and `If-None-Match`, and none reads the IP, geolocation or cookies. |
| Responses do not depend on the visitor | PASS | Every data response is a pre-built snapshot, identical for everyone (same bytes, weak ETag). The bucket route accepts only `/<bits>/<hex id>` under the current plan, otherwise 400 or 409 with no data. Tests: `route.test.ts`, `bucketRequest.test.ts`, `snapshotRoute.test.ts`. |
| What Vercel and its CDN can see | Disclosed | For every request: IP address, time, user agent and the path. On `/linked` the path holds the bucket number (5 bits of the hash: 1 of 32 buckets of at least 1,186 addresses). On `/check` nothing about the amount is requested. Runtime logs visible to the project keep path, time, user agent and region for 1 hour on our plan ([Vercel docs](https://vercel.com/docs/logs/runtime)); what Vercel keeps internally is covered by its privacy policy. No log drains, analytics, Speed Insights or monitoring are configured. Bucket responses are CDN-cacheable for 5 minutes, so many never reach a function at all. |
| Build telemetry off | FIXED | `apps/web/scripts/next.mjs` runs every Next.js command with `NEXT_TELEMETRY_DISABLED=1`, and the package scripts (`dev`, `build`, `start`) go through it. Vercel runs `pnpm build`, so its builds have it too; adding the variable in the Vercel dashboard is optional. Build telemetry never contained visitor data. |
| Next.js itself up to date | FIXED | Next.js 16.4.0 had three published advisories: RCE in the Image Optimization API with SVGs, RCE in `use cache` functions, and DoS via Server Actions ([GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw), [GHSA-673q-mjm6-r5xr](https://github.com/advisories/GHSA-673q-mjm6-r5xr), [GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r)). The site uses none of those features, but it now runs 16.4.3, for which the npm advisory API returns none. |

## 4. Data

| Item | Result | Evidence |
|---|---|---|
| Buckets: no plaintext addresses | PASS | Test `memory.test.ts` "never contain a plaintext address, and never name a counterparty". Scan of the 32 real exported buckets (39,903 entries): every key is a 44-character base64 SHA-256; the 3 strings shaped like a t-address are pieces of base64 hashes, and none is a valid Base58Check address (`checkAddress`). |
| Buckets: no counterparties | PASS | Same test (the receiving address's entry holds no hash of the sender and no txid of the matching deposit), plus `linked.test.ts` "publishes exactly the documented per-event fields, nothing about counterparties". Every real bucket row has exactly the 10 documented fields. |
| Deposits file: 12-character txid prefixes only | PASS | Tests `match.test.ts` "encodes compactly, sends only a 12-character txid prefix, and decodes back" and `cycle.test.ts` "…txids cut to 12 characters". All 27,673 rows in the real export have a 12-character prefix. |
| Stats: aggregates only | PASS, test added | `cycle.test.ts` now walks the stats payload: no lists, every value a number apart from the generation time, no txid or address. The real export has 23 values, 0 lists. |
| Dust excluded | PASS | Shields and buckets leave out movements of 0.001 ZEC or less (tests in `cycle.test.ts` and `memory.test.ts`). |

Re-run: `pnpm test` (128 tests on 23 October: core 51, indexer 51, web 26).

## 5. Collector

| Item | Result | Evidence |
|---|---|---|
| Logs contain no secrets | PASS, hardened | Every error that leaves the process goes through `describeError`/`redact`, which removes each secret value and every identifying part of the connection strings (test `env.test.ts` "removes connection strings and every identifying part of them"). Keys are never logged, only whether one is set. One log line (a 3xpl network retry) printed a raw error message; it now goes through `describeError` too. dotenv runs with `quiet: true`. |
| 3xpl only sees requests for public blocks | PASS | `indexer/src/sources/threexpl.ts` calls only: latest block, a block by height, a block's events (paged), and the dump listing/downloads. The key travels in an `Authorization` header, never in a URL. 3xpl sees the collector's server IP and which blocks it fetches, all of them, in order. Nothing a visitor types ever reaches the collector or 3xpl. |
| Database roles are least-privilege | PASS | `pnpm --filter indexer create-web-role -- --verify` (new read-only mode): `web_readonly` is not superuser, cannot create databases or roles, has no replication or RLS bypass, inherits nothing and belongs to no other role; its sessions are read-only with a 15 s statement timeout and 20 connections at most. Its only grant is `SELECT` on `snapshots`. Connected as the role: SELECT on `snapshots` works; INSERT, UPDATE, DELETE, CREATE TABLE and SELECT on `turnstile_events`, `event_addresses` and `meta` are all refused. |

## 6. Repository

| Item | Result | Evidence |
|---|---|---|
| gitleaks over the full history, every branch and the stash | PASS | `gitleaks git --log-opts="--all"` (8.30.1): all refs (`main`, `design/ui-directions`, their remotes and `refs/stash`), 92 commits with changes, no leaks. The stash's diff, including untracked files, scanned separately with `gitleaks stdin`: no leaks. The gitleaks workflow also runs on every push. |
| No real person's transparent address in the repository or its history | FIXED (25 October) | Every blob reachable from every ref was scanned for t1/t3 strings (`git rev-list --all --objects` → `git cat-file --batch`), plus all commit messages. Four real addresses had come from chain data during development: three from 3xpl block data used as test constants since 13 October, and one used by `privacy-audit.mjs`; a test also held a one-character variant of one of them, and `dumps.test.ts` held two real txids. All are now synthetic (valid checksums, made from SHA-256 of fixed labels, not anyone's wallet), **in every commit**: the history was rewritten with `git filter-repo --replace-text`, keeping every commit's author, committer, dates and message (checked by comparing `git log --format='%an %ae %ad %cd'` before and after: identical for all 108 commits). After the rewrite, `git log -p --all` contains none of the real strings, the only addresses in any blob are the synthetic ones and the public ZIP 320 test vector (`t1VmmGiy…`/`tex1s2rt…`), and the HEAD tree is byte-identical to the one before the rewrite. No image has ever been tracked; the README screenshots (`docs/img`) show only a synthetic demo address. |
| No `.env`, `data/` or design-study files tracked | PASS | `git ls-files` shows only `indexer/.env.example`; nothing under `data/`, `mockups/` or `docs/design/`, no `EchoWebLV-UI-Study.md` or `web3-ui.skill`. `.gitignore` covers `.env*` (except `.env.example`), `data/`, `node_modules`, `.next`. |
| No mentions of AI tools in code, comments, docs or commit messages | PASS | `git grep -i` for tool and vendor names and for "co-authored-by" / "generated with" across all tracked files, and the same over every commit message on all refs: the only hits are two ignore entries in `.gitignore` and `.dockerignore`, which the repository rules require so that local tool configuration is never committed. Every commit has a single author and committer (Adeolu05, GitHub noreply address). |
| LICENSE present | PASS | `LICENSE`: MIT, © 2026 David Peluola. |

## 7. Dependencies

Runtime dependencies (what runs in production):

| Package | Where | Phones home? |
|---|---|---|
| `next` 16.4.3 | web | Not at runtime. Its build/dev CLI has anonymous telemetry, switched off by `NEXT_TELEMETRY_DISABLED=1` in our scripts. In an interactive or agent shell, `next build` can also ask the npm registry for advisories on its own version (no project or visitor data); it skips this on CI such as Vercel. |
| `react`, `react-dom` 19.3 | web | No |
| `pg` 8.23 | web (server only), collector | No; connects only to our database |
| `server-only` | web | No (an import guard, no code) |
| `@ail/core` | web, collector | No; our own pure TypeScript, no network code |
| `dotenv` | collector | No; `quiet: true` also silences its console tips |
| `drizzle-orm` | collector | No |
| `tsx` | collector (runs the TypeScript) | No |

The whole lockfile, transitive packages included, contains no
analytics, telemetry or error-reporting package: no `@vercel/analytics`,
`@vercel/speed-insights`, Sentry, PostHog, Segment, Mixpanel, Datadog, New
Relic, OpenTelemetry exporters, Bugsnag, Rollbar, LogRocket, Amplitude or
`web-vitals` reporting. The client JavaScript the site ships contains no URL
it fetches from another origin; the only external URLs in it are documentation
links inside React and Next.js error messages and SVG namespace strings, and
the CSP would block a request to any of them.

## Known limitations

- **The host sees IP addresses and request times.** Vercel (website) sees each
  visitor's IP address, user agent, time and requested path, like any web host.
  We cannot turn that off. Use Tor or a trusted VPN if that matters to you; the
  tool works the same way.
- **On `/linked`, the bucket number is visible.** The CDN, the host and anyone
  who can read their logs see which bucket was requested: the address is one
  of about 1,200 (at least 1,186 today). Checking several addresses from the
  same IP could narrow that down. **Paranoid mode** downloads all 32 buckets
  (about 3.1 MB) and avoids even this.
- **30-day window.** Only the last 30 days of shielding activity are held.
  "Nothing found" says nothing about older activity, and a withdrawal is only
  compared with deposits inside the window.
- **Reliance on 3xpl.** All chain data comes from 3xpl's API and daily dumps.
  If 3xpl is wrong, late or unavailable, so are we; the collector does not
  verify blocks against a node of its own. 3xpl sees only our collector, never
  visitors.
- **A heuristic risk signal, not proof.** Results apply public amount and
  timing heuristics to public chain data. "Low risk" does not mean unlinkable
  (an adversary may hold exchange records or network data), and "may be
  linkable" does not mean anyone has linked you.
- **Inline scripts are allowed on Vercel for now.** Until the hash step works
  in Vercel's build, production allows inline scripts (`'self'
  'unsafe-inline'`). An injected inline script could run there, but it still
  could not load code from, or send data to, any other origin.
- **Inline styles are allowed.** `style-src` includes `'unsafe-inline'` for
  React's style attributes. This cannot run code or send data (every fetch is
  limited to this origin).
- **The browser keeps ordinary history.** Visits to `/check` and `/linked` (and
  the example words `#risky` / `#common`) appear in the browser's history, as
  for any site. What was typed never does.
