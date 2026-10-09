# Running Petrios on Cloudflare Workers

Petrios can also run on Cloudflare Workers through
[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare) (1.20.10) and
wrangler (4.149). The production host is **Render** (Docker, Node 24,
`output: 'standalone'`) until the owner runs the [Cutover](#cutover). Nothing in
this layer changes how the Docker image is built or run: the Cloudflare files
are excluded from the Docker context (`.dockerignore`), and the app code is the
same on both runtimes.

Two Workers are configured. The **staging** Worker (`petrios-staging`,
`npm run cf:deploy:staging`) uses its `workers.dev` URL and has no routes and
no cron triggers. The **production** Worker (`petrios`,
`npm run cf:deploy:production -- <phase>`) has a `preflight` phase on
`workers.dev` only and a `live` phase that serves `petrios.uk` through a Workers
route and runs every scheduled job; `rollback` returns the traffic to Render.

## Architecture

```
Browser ──► Cloudflare
              ├─ static asset match (.open-next/assets: /_next/static, public/) ─► served directly
              └─ otherwise ─► Worker  cfw/worker.ts
                                ├─ import './yoga-install'      (installed before anything else)
                                ├─ fetch     ─► OpenNext worker ─► proxy.ts ─► Next.js server
                                └─ scheduled ─► cfw/cron.ts ─► fetch(/api/cron/<job>, Bearer CRON_SECRET)
```

| File | Purpose |
|---|---|
| `wrangler.jsonc` | Worker config. The top level is the staging Worker (`petrios-staging`). `env.production` (live) and `env.production_preflight` are the two phases of the production Worker (`petrios`) |
| `open-next.config.ts` | `defineCloudflareConfig()` with no incremental cache. The root layout is `force-dynamic`, so pages are never served from an ISR/SSG cache |
| `cfw/worker.ts` | Custom entry. It re-exports OpenNext's `fetch` and adds `scheduled()` |
| `cfw/yoga-redirect.ts`, `cfw/yoga-install.ts` | Make react-pdf work on Workers (see [PDFs and fonts](#pdfs-and-fonts)) |
| `cfw/cron.ts` | Pure cron-expression → `/api/cron/*` mapping and the `scheduled()` handler, with tests |
| `scripts/cloudflare/*.mjs` | `cf:build`, `cf:preview`, `cf:deploy:staging`, `cf:deploy:production` and the secret guard |
| `scripts/cloudflare/production-secrets.template.json` | Every production secret name with an empty value; copied and filled **outside** the repository ([Cutover](#step-1-production-secrets-first-time)) |
| `.dev.vars.example` | Variable names and placeholders for local preview |

Generated, never committed: `.open-next/`, `.wrangler/`, `.dev.vars`,
`cfw/yoga.wasm`, `cfw/yoga-wasm.json` and `cfw/public/`.

## Prerequisites

- **Workers Paid plan.** The Free plan allows 10 ms of CPU per request and per
  Cron Trigger, and 50 subrequests per invocation. Plain SSR exceeds that, so
  does a group-code scrypt check (about 48 ms), and so does `post-session-reports`
  (about 11 subrequests per attendee). One Paid subscription covers every Worker
  on the account, staging and production alike.
- The account owner runs `npx wrangler login` themselves. None of the scripts log
  in, and only `cf:deploy:staging` and `cf:deploy:production` contact
  Cloudflare. Wrangler telemetry is off
  (`"send_metrics": false` and `WRANGLER_SEND_METRICS=false` in the scripts).
- Node 24, as on Render. The scripts need Node ≥ 20.12 for `util.parseEnv`.

## Build: `npm run cf:build`

1. `opennextjs-cloudflare build`, which runs `next build`.
2. Prepares the Worker-only modules from what is **installed**:
   - It decodes the base64 wasm embedded in the `yoga-layout` that
     `@react-pdf/layout` resolves, then writes `cfw/yoga.wasm` and
     `cfw/yoga-wasm.json` (byte length and SHA-256). The step fails loudly if
     yoga stops embedding exactly one base64 wasm that is instantiated from bytes.
   - It copies `public/fonts/*.ttf` to `cfw/public/fonts/`.
3. Overwrites `.open-next/cloudflare/next-env.mjs` with empty
   `production`/`development`/`test` exports (see [Secret-leak guard](#secret-leak-guard)).
4. Patches OpenNext's bundled response writer in
   `.open-next/server-functions/default/handler.mjs` so streamed responses
   keep backpressure (see [Streaming responses](#streaming-responses)). The
   step fails loudly unless it finds the expected OpenNext 4.1.9 code exactly once.
5. Runs the guard. Any failure exits non-zero.

`node scripts/cloudflare/guard.mjs` re-runs the guard on the current build.

## Local preview: `npm run cf:preview`

1. `cp .dev.vars.example .dev.vars`. Keep placeholders, or point `SUPABASE_*` at a
   **non-production** project. The example's dead port `127.0.0.1:59999` means
   nothing can reach a database.
2. `npm run cf:build`
3. `npm run cf:preview` serves the built Worker at `http://localhost:8787`.

The preview refuses to start if `.dev.vars` is missing, if the build is missing,
or if `next-env.mjs` is not scrubbed. It runs wrangler with
`CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false` (wrangler would otherwise fall back
to `.env`/`.env.local` when `.dev.vars` is absent) and
`CLOUDFLARE_INCLUDE_PROCESS_ENV=false`. It always targets the top level and
rejects `--env`, `--env-file` and `--config`.

Because `wrangler.jsonc` declares `secrets.required`, `wrangler dev` loads from
`.dev.vars` **only** names declared under `vars` or `secrets.required`. Other
names are ignored locally.

Cron dispatch, locally:

```bash
# .dev.vars: CRON_ENABLED=true
npm run cf:preview -- --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"
```

With `CRON_ENABLED=false` the log shows `CRON_ENABLED is not "true"; not dispatching`.

## Deploy staging: `npm run cf:deploy:staging`

```bash
APP_URL=https://petrios-staging.<account-subdomain>.workers.dev npm run cf:deploy:staging
```

The script refuses to deploy when:

- `APP_URL` is missing, is not `https`, has credentials, a port, a path, a query
  or a fragment, or is not exactly `https://petrios-staging.<subdomain>.workers.dev`.
  These are the `lib/app-url.ts` / `lib/runtime-config.ts` rules plus pinning to
  this Worker, so a production or localhost URL cannot ship to staging.
- the top level of `wrangler.jsonc` has cron triggers, routes,
  `workers_dev: false`, or `CRON_ENABLED` or `OUTBOUND_EMAIL_ENABLED` other
  than `"false"`.
- a `--secrets-file` fails the checks below.
- `cf:build` or its guard fails.

It then runs `wrangler deploy --var APP_URL:<origin>` against the top level
(`--env=`; `CLOUDFLARE_ENV` from your shell is ignored). `OPEN_NEXT_DEPLOY=true`
stops wrangler from re-delegating to `opennextjs-cloudflare deploy`. The only
extra argument accepted is `--secrets-file <path>`.

**First deploy.** The Worker does not exist yet, so `wrangler secret put` cannot
set its required secrets. Supply them once with a file kept **outside the
repository**:

```bash
APP_URL=https://petrios-staging.<sub>.workers.dev npm run cf:deploy:staging -- --secrets-file ../petrios-staging.secrets
```

The file (dotenv or a JSON object) should hold the four required secrets
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`CRON_SECRET`) and, if wanted, names from the optional-secrets row below.
Write it by hand: do not copy `.dev.vars` or Render's environment. Wrangler
binds the file *after* the config and `--var`, with no collision check, so a
same-named entry would silently replace a validated var. `cf:deploy:staging`
therefore reads the file's variable **names** (never values) and refuses it if
it names a `vars` key (`APP_URL`, `CRON_ENABLED`, `OUTBOUND_EMAIL_ENABLED`,
`TRUSTED_CLIENT_IP_HEADER`), a
name from the never-set row, or an `APP_URL` fallback (`NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_BASE_URL`, `NEXTAUTH_URL`, `VERCEL_*`, `RENDER_EXTERNAL_URL`).
It also refuses a file inside the repository or named like `.dev.vars*` or `.env*`.

Afterwards use `npx wrangler secret put <NAME> --env=""`. The empty `--env` pins the
top level even if `CLOUDFLARE_ENV` is set in your shell. Never store a secret
under a `vars` name. If one was ever stored, for example by an older deploy
with a copied file, delete it: `npx wrangler secret delete APP_URL --env=""`
(likewise `CRON_ENABLED`, `OUTBOUND_EMAIL_ENABLED`).

Deploys are config-as-source-of-truth (no `--keep-vars`). Plain variables set in
the dashboard are removed on the next deploy. Store every environment-specific
value as a secret, even a public one such as `MAIL_FROM`.

## Configuration and secrets

Public configuration is read at **runtime** by `lib/runtime-config.ts`, so the
build needs no real values. On Workers, use the unprefixed names (`APP_URL`,
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `JITSI_DOMAIN`). The `NEXT_PUBLIC_*` aliases
still work at runtime but are not declared for local preview. The Petrios Meet
variables are read at runtime, server-side only, by `lib/meeting/config.ts`
(see [Petrios Meet on Workers](#petrios-meet-on-workers)).

| Kind | Names |
|---|---|
| `vars` in `wrangler.jsonc` | `APP_URL` (staging: empty in config, set per deploy; production: `https://petrios.uk` in both phases), `CRON_ENABLED` (`"false"` at top level and in `env.production_preflight`, `"true"` only in `env.production`), `OUTBOUND_EMAIL_ENABLED` (`"false"` at top level and in preflight, `"true"` in `env.production`; see [Outbound email on staging](#outbound-email-on-staging)), `TRUSTED_CLIENT_IP_HEADER` (`"cf-connecting-ip"` everywhere: Cloudflare overwrites it, while the first `x-forwarded-for` hop is client-supplied, so the login-link and group-code rate limits must not use it), `HOSTING_PROVIDER` (`"cloudflare-workers"` everywhere, so `/privacy` and `/subprocessors` name Cloudflare Workers as the application host) |
| Required secrets: deploy fails without them | Staging: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`. Production (both phases) adds `RESEND_API_KEY`, `MAIL_FROM`, `PRIVACY_CONTROLLER_NAME`, `PRIVACY_CONTROLLER_ADDRESS`, `PRIVACY_CONTACT_EMAIL`, `DATA_HOSTING_REGION`, `DATA_TRANSFER_SAFEGUARDS` |
| Optional secrets (set when used) | `ATTENDANCE_RATE_LIMIT_SECRET`, `INSTANCE_SIGNING_KEY`, `RESEND_API_KEY` and `MAIL_FROM` (staging: only reach `OUTBOUND_EMAIL_ALLOWLIST` addresses), `OUTBOUND_EMAIL_ALLOWLIST` (staging only), `LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_FALLBACKS`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`, `TTS_PROVIDER`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`, `OPS_ENABLED`, `OPS_ASSISTANT_ENABLED`, Petrios Meet: `JAAS_APP_ID`, `JAAS_API_KEY_ID`, `JAAS_PRIVATE_KEY` (all three or none; the private key is a critical secret), or `JITSI_DOMAIN` with optional `JITSI_APP_ID` + `JITSI_APP_SECRET` (critical secret), `JITSI_JWT_AUDIENCE`, `JITSI_JWT_SUBJECT`, `TEACHER_INVITATIONS_RLS_LOCKED` (exactly `true` only after the spec 13 database fix), `GOOGLE_SITE_VERIFICATION`, `PRIVACY_CONTROLLER_NAME`, `PRIVACY_CONTROLLER_ADDRESS`, `PRIVACY_CONTACT_EMAIL`, `DATA_HOSTING_REGION`, `DATA_TRANSFER_SAFEGUARDS` |
| Not secret, usually unset | `APP_TIME_ZONE` (IANA zone for server-rendered dates and teaching-slot wall times; default `Europe/London`, so a UK deployment sets nothing). To change it, add it to `vars` in `wrangler.jsonc` at the top level **and** in both production environments (environments do not inherit `vars`; the production validator requires identical keys), which also lets `cf:preview` read it from `.dev.vars`; or store it as a secret like `MAIL_FROM` (the production secrets template lists it: copy it if Render sets it). `TZ` has no effect: the Workers clock is always UTC |
| Never set on Workers | `SUPABASE_INTERNAL_URL`, `AUTH_INTERNAL_URL`, `STORAGE_INTERNAL_URL`: Docker-network hostnames, which `global_fetch_strictly_public` blocks. Also `SELF_HOSTED_SETUP`/`SETUP_TOKEN` (self-host setup depends on unapplied migration 061), `DATABASE_URL`, and `NEXTJS_ENV` |
| Build-time only | `NODE_ENV` is inlined as `production` by `next build` |

SMTP (`SMTP_*`) has not been verified on Workers. Use Resend. `lib/email.ts`
switches to SMTP whenever `SMTP_HOST` is set, so `cf:deploy:production` refuses
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_SECURE` in the
secrets file and as stored secrets.

### Petrios Meet on Workers

The meeting mode (spec 04 "Petrios Meet") is resolved per request from the
Worker's environment, so it can differ between Render and the staging Worker.
Store every meeting variable as a secret, like `MAIL_FROM`, because deploys
remove dashboard-only plain variables:

```bash
npx wrangler secret put JAAS_APP_ID --env=""
npx wrangler secret put JAAS_API_KEY_ID --env=""
# Pipe the multi-line PEM from the downloaded file (the interactive prompt reads
# one line). A one-line value with literal \n escapes also works.
npx wrangler secret put JAAS_PRIVATE_KEY --env="" < /path/to/jaas-private-key.pem
# Only after the teacher_invitations policy fix (spec 13); same database as production.
echo true | npx wrangler secret put TEACHER_INVITATIONS_RLS_LOCKED --env=""
```

Full JaaS walkthrough (console, Render, verification): `docs/petrios-meet.md`.

- `JAAS_PRIVATE_KEY` and `JITSI_APP_SECRET` are critical secrets. Never put them
  in `wrangler.jsonc`, `.dev.vars`, or a repository file.
- With none set, the Worker runs in public mode: rooms open on meet.jit.si in a
  new tab and the CSP names no meeting origin. A partial JaaS set makes video
  unavailable on that host (the manage card shows the configuration message).
- Room passes are signed with WebCrypto (`crypto.subtle`), so no Node-only
  crypto is involved; PKCS#1 keys are wrapped to PKCS#8 in code.
- The staging Worker serves the **production** database. Configuring the same
  JaaS app on staging lets real sessions' rooms open from `workers.dev`, and
  JaaS monthly active users are counted across both hosts. Use a separate JaaS
  app for staging tests if you want separate usage, and remember that 8x8 then
  also processes data reached through staging (record it in the DPA register).
- Local preview (`cf:preview`) ignores these variables because `wrangler.jsonc`
  does not declare them; test embedded rooms with `npm run dev` or on staging.

### Outbound email on staging

The staging Worker serves the **production** database. Any email it sent would
carry the staging origin: sign-in and invitation links, and certificate PDFs
whose QR code and verify link point at `workers.dev`. A delivery it marked
`SENT` is never re-sent from Render, and external teachers have no other copy
of their certificate. So the top level sets `OUTBOUND_EMAIL_ENABLED="false"`,
which `cf:deploy:staging` requires, and `lib/email.ts` then refuses every send
before contacting any provider. A refusal is an ordinary send error, so a
ledger-backed delivery (certificates, reminders) records a retryable failure
that Render can send later with the production origin.

To test email on staging, set the `OUTBOUND_EMAIL_ALLOWLIST` secret to your own
address(es), comma-separated. Only a send whose every recipient is on the list
goes out. `OUTBOUND_EMAIL_ENABLED` unset, or any value other than exactly
`"false"`, leaves email unchanged, so Render, which never sets it, is unaffected.

Even with email off, staging writes to the production database. Do not run real
workflows there: generating certificates, inviting teachers, publishing slots
or approving Ops actions for real sessions creates production rows (with failed
deliveries for everyone not on the allowlist).

### Privacy register while staging serves production data

A Worker processes personal data: requests, IP addresses and auth cookies, the
application data it reads from and writes to the database, and Workers Logs
(`observability` is enabled), which keep console output, including error lines
that name recipient email addresses, for Cloudflare's plan-dependent retention
period. On the Worker itself, `/privacy` and `/subprocessors` name "Cloudflare
Workers" as the host. The register that Render serves cannot know a staging
Worker exists, so before deploying one that uses the production database:

1. add Cloudflare (Workers and Workers Logs, its region and retention) to the
   controller's recipient register, the DPIA (`docs/compliance/dpia-template.md`)
   and the executed DPA's subprocessor list;
2. cover it in `DATA_TRANSFER_SAFEGUARDS` on both Render and the Worker; and
3. remove those entries when the staging Worker is deleted, or keep them at
   cutover when the Worker becomes the production host.

### Parity with Render: copy, never rotate

`SUPABASE_SERVICE_ROLE_KEY` doubles as an HMAC key: calendar-feed URLs, Recall
deep links, newsletter unsubscribe links, and the rate-limit pseudonym when
`ATTENDANCE_RATE_LIMIT_SECRET` is unset. The auth cookie name
(`sb-<host prefix>-auth-token`) is derived from `SUPABASE_URL`. For any Worker
that serves the production database, copy these **byte for byte from Render**:

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`ATTENDANCE_RATE_LIMIT_SECRET` (if set on Render),
`INSTANCE_SIGNING_KEY` (if set on Render).

Do not rotate any of them as part of the move. That includes switching from the
legacy JWT service key to an `sb_secret_` key. A different value invalidates every
calendar feed, Recall link and unsubscribe link already issued. A different
`SUPABASE_URL` signs everyone out.

`CRON_SECRET` is the exception: it is only the bearer token of `/api/cron/*`
and nothing derives from it. Staging uses its own. The production Worker gets a
**new** value, so a forgotten external scheduler still holding Render's value is
refused at the Worker after the cutover (see [Cutover](#step-1-production-secrets-first-time)).

## Secret-leak guard

`opennextjs-cloudflare build` always compiles `.env`, `.env.production`,
`.env.local` and `.env.production.local` (plus the `.development`/`.test`
variants) into `.open-next/cloudflare/next-env.mjs`. At runtime that file fills
any variable Cloudflare does not set (`process.env[key] ??= value`). Built in a
folder with real `.env` files, the Worker would ship laptop secrets and silently
fall back to them. `.dockerignore` already keeps `.env*` out of the Render image.

`cf:build` therefore:

1. replaces `next-env.mjs` with empty objects; and
2. runs the guard, which fails if `next-env.mjs` has any key. It then runs
   `wrangler deploy --dry-run --outdir <tmp>` (no Cloudflare contact) and scans
   the exact upload, meaning the bundle, the additional modules and
   `.open-next/assets`. It looks for every value from local `.env*` files
   (except `.env.example`) that is at least 12 characters long and is neither a
   `NEXT_PUBLIC_*` value nor present in the committed `.env.example`. Matches
   are checked raw and JSON-escaped.

The guard prints variable **names only**, never values. A `NEXT_PUBLIC_*` value
found in the upload is reported as a warning: it was inlined by `next build`
(any literal `process.env.NEXT_PUBLIC_*` read in app code; none remain today).

OpenNext also leaves a copy of the local `.env` at
`.open-next/server-functions/default/.env`. It is gitignored, dockerignored and
not part of the upload, which the guard's dry-run scan confirms.

If the guard names a variable whose value is not secret but equals a code
default, remove that line from your local `.env*`, or build from a clean
checkout. A clean CI checkout has no `.env*` files, because `.gitignore` now
ignores every `.env*` except `.env.example`. That is the recommended place to build.

## PDFs and fonts

**Yoga WebAssembly.** `@react-pdf/renderer` lays out pages with `yoga-layout`
3.2.1. Yoga instantiates an embedded base64 wasm from bytes, and workerd rejects
that ("Wasm code generation disallowed by embedder"). `@react-pdf/layout` caches
the failed promise, so after the first failure every later PDF in the isolate
fails too. `cfw/yoga-install.ts` imports `cfw/yoga.wasm`, which wrangler
precompiles at upload. It then wraps `WebAssembly.instantiate`: a call whose
bytes have the recorded length and SHA-256 gets the precompiled module instead.
Every other call passes through unchanged. Nothing in `node_modules` is patched,
and the wasm is regenerated from the installed package on every build.

**Fonts.** `app/opengraph-image.tsx`, `lib/certificates/pdf.tsx` and
`lib/portfolio/pdf-shared.tsx` read `path.join(process.cwd(), 'public', 'fonts', …)`.
On Workers `process.cwd()` is `/bundle`, and `public/` exists only as static
assets. Because of `"base_dir": "cfw"`, `"find_additional_modules": true` and a
`Data` rule for `public/fonts/*.ttf`, the copied fonts are uploaded as modules at
`/bundle/public/fonts/`. The unchanged `node:fs` reads then work (`nodejs_compat`,
compatibility date ≥ 2025-09-01). `fallthrough: true` is required, because
without it wrangler drops its default `**/*.bin` Data rule that next/og needs.
Never set `base_dir` to the project root or `.open-next`: the default module
rules would then sweep `node_modules` and build output into the upload.

## Cron safety model

The six routes under `app/api/cron/` accept `GET` with
`Authorization: Bearer CRON_SECRET` (`lib/cron-auth.ts`). `scheduled()` calls
OpenNext's fetch handler with `${APP_URL}/api/cron/<job>` inside
`ctx.waitUntil` and logs the HTTP status. The response body is discarded, and
the secret and body are never logged. The self-host
`/api/internal/scheduler/tick` route is not used: it depends on migration 061,
which has not been applied.

| Job | Expression (UTC) | Intended cadence (docs/self-hosting.md, migration 061 defaults) |
|---|---|---|
| `session-reminders` | `0 * * * *` | hourly (reminders ~24 h before a session) |
| `post-session-reports` | `15 * * * *` | hourly |
| `recall-awards` | `5,20,35,50 * * * *` | every 15 minutes |
| `recall-send` | `0 8 * * *` | daily |
| `ops-synthesis` | `30 6 * * *` | daily |
| `ops-weekly` | `0 7 * * MON` | weekly |

Each job has its own expression, so each run is a separate invocation with its
own CPU budget. Triggers firing at least an hour apart get 15 min of CPU;
`recall-awards` gets 30 s. **How Render schedules these jobs today is not
recorded in the repository.** Before cutover, inventory Render's real schedule
and make `cfw/cron.ts` `CRON_SCHEDULE` and `env.production.triggers.crons` match
it. `cfw/cron.test.ts` fails if the two disagree.

Render runs these jobs against the **same database** until the cutover, and
the production Worker runs them after it. Running them from two schedulers
would double-send email (not every job has a
per-recipient ledger; for example, ops-weekly low-score notifications have no
dedupe). The defences are layered:

1. The top level (staging) and `env.production_preflight` declare
   `"triggers": { "crons": [] }` (which clears any schedule) and no routes.
   This is enforced by `cfw/cron.test.ts`, `scripts/cloudflare/lib.test.ts`,
   `cf:deploy:staging` and `cf:deploy:production`.
2. `scheduled()` dispatches nothing unless `CRON_ENABLED` is exactly `"true"`.
   That value is set only in `env.production`; the top level and preflight set
   `"false"`. A same-named entry in a `--secrets-file` silently replaces the
   var, so `cf:deploy:staging` refuses a secrets file that names any `vars`
   key. A stored secret and a var of the same name replace each other: a
   deploy overwrites the secret with the var (wrangler warns and asks, and
   answers yes by itself when not interactive), and a later `wrangler secret
   put` overwrites the var until the next deploy. `cf:deploy:production`
   therefore refuses to deploy while a stored secret has a var's name. Never
   store a secret named `CRON_ENABLED`.
3. The routes themselves refuse: with `CRON_ENABLED` exactly `"false"`,
   `lib/cron-auth.ts` answers every authenticated `/api/cron/*` request with
   503, so nobody holding `CRON_SECRET` can run a job on staging over HTTP.
   Render leaves `CRON_ENABLED` unset, so its routes are unaffected.
4. `cf:deploy:production -- live` refuses without `--render-crons-disabled`,
   the operator's attestation that Render's scheduled jobs are suspended, and
   rollback clears the Worker's schedules before telling the operator to
   resume Render's. After the cutover the production Worker has a new
   `CRON_SECRET`, so an external caller still using Render's is refused.

## Cutover

Moving production (`petrios.uk`, today Render behind Cloudflare-proxied DNS) to
the Worker `petrios`, together with **all** scheduled jobs. Only the account
owner runs these steps. The move is reversible and changes **no DNS record**:
the proxied `petrios.uk` record stays exactly as it is (and the email records
are never touched). A Workers **route**, `petrios.uk/*`, makes the Worker
answer instead of Render; deleting the route hands the traffic straight back to
Render.

`www.petrios.uk` gets no route. Today Cloudflare itself answers it with a 301
to `https://petrios.uk/...` (the response has `cf-ray` but no Render `rndr-id`;
checked 2026-10-09), so the redirect does not depend on Render or on the
Worker, and the cutover leaves it as it is. Before Render is decommissioned,
check again that the `www` 301 carries no `rndr-id`.

### Phases

`wrangler.jsonc` has two environments for **one** Worker: both are named
`petrios` and pin the same `account_id` (the account that owns `petrios.uk`),
so they share its secrets, every step targets the same account, and each deploy
replaces the other's shape. The script refuses a different
`CLOUDFLARE_ACCOUNT_ID` in the shell and passes the pinned one to every wrangler
call and API request. `scripts/cloudflare/lib.mjs` `productionConfigProblems()` (unit-tested)
refuses any other difference.

| | `preflight` | `live` | `rollback` |
|---|---|---|---|
| Command | `npm run cf:deploy:production -- preflight` | `npm run cf:deploy:production -- live --render-crons-disabled` | `npm run cf:deploy:production -- rollback` |
| wrangler env | `production_preflight` | `production` | Cloudflare API, then `production_preflight` |
| Routes | none | `petrios.uk/*` (zone `petrios.uk`) | deleted |
| `workers.dev` | on (`petrios.<account-subdomain>.workers.dev`) | off | off until the preflight redeploy |
| Cron schedules | cleared (`[]`) | the six in `cfw/cron.ts` | cleared |
| `CRON_ENABLED` / `OUTBOUND_EMAIL_ENABLED` | `"false"` / `"false"` | `"true"` / `"true"` | preflight values after the redeploy |
| `APP_URL` | `https://petrios.uk` | `https://petrios.uk` | unchanged |

Preflight serves the production database but no production traffic, runs no
jobs and sends no email (except to `OUTBOUND_EMAIL_ALLOWLIST` addresses). Links
it would put in email point at `petrios.uk`.

### Wrangler behaviour this relies on (verified in wrangler 4.149.0 source)

- **Routes are only ever replaced, never cleared, by `wrangler deploy`.**
  `triggersDeploy()` (`deploy-helpers/src/triggers/deploy.ts`) calls
  `publishRoutes()`, which `PUT`s the configured list to
  `/accounts/<id>/workers/scripts/<name>/routes` and so replaces the Worker's
  routes, but only `if (routesOnly.length > 0)`. A deploy with no routes leaves
  every existing route attached. Therefore `preflight` refuses while the Worker
  has routes, and `rollback` deletes them through the zone API
  (`DELETE /zones/<zone>/workers/routes/<id>`). With an API token that lacks
  "All zones", wrangler's zone fallback (`publishRoutesFallback`) also leaves
  routes it cannot see.
- **Routes and schedules are updated concurrently, after the upload.**
  `triggersDeploy()` collects the route `PUT` and the schedules `PUT` and awaits
  them together, then fails the deploy if either failed. A failed `live`
  deploy can therefore leave the route without the schedules, or the
  schedules without the route. The script reads both back after every deploy
  and, on a first go-live, removes whatever was attached (see step 5).
- **Wrangler can exit 0 without deploying.** `preUploadApiChecks()` asks
  "Would you like to continue?" when the Worker was last changed through the
  API or dashboard, or when a var would overwrite a stored secret; answering no
  returns `{ versionId: null }` with exit code 0. The script runs the deploy
  with `WRANGLER_OUTPUT_FILE_PATH` and requires the `deploy` entry's
  `version_id`, as well as the routes and schedules the API reports.
- **An explicit empty cron list clears schedules; an absent one keeps them.**
  `triggers.crons` is passed through as `config.triggers?.crons`; `[]` is
  truthy, so wrangler `PUT`s `[]` to `.../schedules`. With no `triggers` key the
  normalised default is `{ crons: undefined }` and the schedules are left alone.
  Both production environments declare the key.
- **Required secrets.** `addRequiredSecretsInheritBindings()`
  (`deploy-helpers/src/deploy/helpers/secrets-validation.ts`) binds each name in
  `secrets.required` as an `inherit` binding; the API rejects the upload if one
  is missing. For a Worker that does not exist yet, `wrangler deploy` refuses
  unless `--secrets-file` supplies them. `wrangler secret bulk` and
  `wrangler secret put` against a missing Worker ask (default yes) to create an
  empty one (`createDraftWorker()`, `src/secret/index.ts`: a stub
  `fetch() {}` with no routes) and then store the secrets. Deploys keep stored
  secrets (`keep_bindings: secret_text`).
- **vars, services and secrets are not inherited** by environments
  (`notInheritable`), so each environment declares them in full, including
  `WORKER_SELF_REFERENCE -> petrios`. `--var` and `--secrets-file` override a
  config var of the same name with no warning; the production script passes
  neither and takes `APP_URL` only from `wrangler.jsonc`. A deploy overwrites a
  stored secret that has a var's name (`checkRemoteSecretsOverride()`: a
  warning and a prompt), and a later `secret put` overwrites the var until the
  next deploy, so the script refuses to deploy while such a secret exists.

### What does not change

- **DNS.** No record is created, edited or deleted. Keep `petrios.uk`
  **proxied** (orange cloud): a DNS-only record bypasses the Worker.
- **`www.petrios.uk`.** No route; Cloudflare keeps answering it with its 301 to
  the apex.
- **Supabase.** Same project. The Site URL and redirect URLs stay as they are,
  because the public origin is still `https://petrios.uk`. No migration is part
  of the cutover. The RLS security migration in `docs/security/rls-lockdown.md`
  is independent and recommended first.
- **Render.** The web service keeps running, unchanged, as the warm fallback.

### Prerequisites

1. The [staging checklist](#staging-validation-checklist) has passed.
2. Workers Paid, `npx wrangler login` as the account owner, Node 24.
3. Inventory Render's schedule (step 4 says where to look). If it differs from
   `CRON_SCHEDULE` in `cfw/cron.ts`, change `cfw/cron.ts` and
   `env.production.triggers.crons` together (the tests compare them).
4. Add Cloudflare to the privacy register, DPIA and DPA subprocessor list
   ([Privacy register](#privacy-register-while-staging-serves-production-data)),
   and write the new `DATA_HOSTING_REGION` / `DATA_TRANSFER_SAFEGUARDS` texts.
5. Pick a window away from the daily and weekly jobs (06:30, 07:00 Monday and
   08:00 UTC), for example a weekday between 10:00 and 15:00 UK time. A job tick
   missed during the switch runs on the next tick; the jobs are idempotent.
6. Deploy from a clean git checkout of the commit to ship (normally `main`).
   The script refuses tracked or untracked changes, and a directory that is
   not a git checkout of its own (an export or copy could hold any code), and
   prints the commit it deploys. A separate worktree keeps your working copy
   out of the way:

   ```bash
   git fetch origin && git worktree add --detach ../petrios-deploy origin/main && cd ../petrios-deploy && npm ci
   ```

   Run every `cf:deploy:production` command from there (the secrets file still
   lives outside the repository).
7. `wrangler.jsonc` pins `account_id` in both production environments. Check it
   is the account that owns `petrios.uk` (`npx wrangler whoami`); with a
   different `CLOUDFLARE_ACCOUNT_ID` in your shell the script refuses.

### Step 1: production secrets (first time)

Production secrets are **separate** from staging's. Prepare them from
`scripts/cloudflare/production-secrets.template.json`, always outside the
repository:

```bash
cp scripts/cloudflare/production-secrets.template.json ~/petrios-production-secrets.json
chmod 600 ~/petrios-production-secrets.json
# fill it (table below), deleting every key you leave empty
npm run cf:deploy:production -- check-secrets ~/petrios-production-secrets.json
npm run cf:deploy:production -- secrets ~/petrios-production-secrets.json
rm ~/petrios-production-secrets.json
```

`check-secrets` contacts nothing. It reads the file in memory and prints names
only. It refuses a file inside the repository, a missing required name, an empty
or non-string value (wrangler would store `""`, or delete a secret given
`null`), a `vars` name, a never-set name, an `APP_URL` fallback, half of an
all-or-none group (ElevenLabs key + voice, the three JaaS values, Jitsi app id +
secret), both LLM keys plus `OPENAI_BASE_URL` without `LLM_PROVIDER`, and any
`SMTP_*` name (`SMTP_HOST` would switch email from Resend to SMTP). It warns
about names Petrios does not read. `secrets` repeats the check and runs
`wrangler secret bulk <file> --env production_preflight` (the equivalent raw
command is `npx wrangler secret bulk ~/petrios-production-secrets.json --env production_preflight`).
The first time, wrangler asks whether to create the Worker `petrios`: answer
yes. It creates an empty Worker with no routes, which serves nothing.

Copy values **byte for byte** from the Render web service's Environment tab
(see [Parity](#parity-with-render-copy-never-rotate)). Multi-line values, such as
the JaaS PEM, are JSON strings with `\n` escapes.

| Name | Value |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Render's `SUPABASE_URL`/`SUPABASE_ANON_KEY`, or their `NEXT_PUBLIC_*` names. A different URL signs everyone out |
| `SUPABASE_SERVICE_ROLE_KEY` | Copy. Never rotate (feeds, Recall and unsubscribe links are HMACs of it) |
| `CRON_SECRET` | **New** random value: `openssl rand -hex 32`. See below |
| `RESEND_API_KEY`, `MAIL_FROM` | Copy (`MAIL_FROM`, or the legacy `RESEND_FROM_EMAIL` value). Required: production email cannot send without them |
| `PRIVACY_CONTROLLER_NAME`, `PRIVACY_CONTROLLER_ADDRESS`, `PRIVACY_CONTACT_EMAIL` | Copy. Required here: they are public disclosures (`lib/compliance.ts`); if Render lacks them, decide them now |
| `DATA_HOSTING_REGION`, `DATA_TRANSFER_SAFEGUARDS` | **New text**: requests are now processed on Cloudflare's global network (Workers and Workers Logs), the database stays in its Supabase region. Required |
| `ATTENDANCE_RATE_LIMIT_SECRET`, `INSTANCE_SIGNING_KEY` | Copy if set on Render; never generate new ones |
| `GOOGLE_SITE_VERIFICATION`, `OPS_ENABLED`, `OPS_ASSISTANT_ENABLED` | Copy if set on Render |
| `TEACHER_INVITATIONS_RLS_LOCKED` | `true` only after the database fix (spec 13), as on Render |
| `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_FALLBACKS`), `LLM_PROVIDER`, `OPENAI_*` | Optional. Render may not have the Anthropic key yet; add it here to enable AI on the Worker |
| `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` (+ `ELEVENLABS_MODEL_ID`), `TTS_PROVIDER` | Optional; both or neither |
| `JAAS_APP_ID` + `JAAS_API_KEY_ID` + `JAAS_PRIVATE_KEY`, or `JITSI_DOMAIN` (Render's `NEXT_PUBLIC_JITSI_DOMAIN`) with `JITSI_APP_ID` + `JITSI_APP_SECRET`, `JITSI_JWT_*` | Optional; as on Render (`docs/petrios-meet.md`) |
| `OUTBOUND_EMAIL_ALLOWLIST` | Optional, preflight testing only (ignored once email is on). Delete it after the cutover |
| `APP_TIME_ZONE` | Copy if set on Render (default `Europe/London`) |

Never store `APP_URL`, `CRON_ENABLED`, `OUTBOUND_EMAIL_ENABLED`,
`TRUSTED_CLIENT_IP_HEADER`, `HOSTING_PROVIDER` (vars), `NEXT_PUBLIC_APP_URL` or
other `APP_URL` fallbacks, `*_INTERNAL_URL`, `DATABASE_URL`, `NEXTJS_ENV`,
`NODE_ENV`, `RENDER*` or `SMTP_*` (unverified on Workers; refused).

**Why a new `CRON_SECRET`.** Only `lib/cron-auth.ts` reads it: it is the bearer
token for `/api/cron/*`, and nothing is derived from it. After the cutover the
only legitimate caller is the Worker's own `scheduled()`, which reads the same
secret. A new value therefore locks out, by construction, any forgotten
external scheduler that still sends Render's value to `https://petrios.uk/api/cron/*`:
it gets 401 instead of running a job twice. Render keeps its own value, so its
suspended jobs work unchanged after a rollback.

Later changes: `npx wrangler secret put <NAME> --env production` (the secrets
belong to the Worker, so either environment name works; each change deploys a
new version at once).

### Step 2: deploy preflight

```bash
npm run cf:deploy:production -- preflight
```

The script refuses, with a fix for each case, unless all of the following hold:

- `wrangler.jsonc` passes `productionConfigProblems()` and `APP_URL` in your
  shell is unset or equal to `https://petrios.uk`.
- The checkout is clean (it prints the commit).
- `wrangler secret list --env production_preflight` (read-only, names only)
  shows every required secret, and no secret shadows a var or uses a never-set
  or fallback name.
- The Worker has **no routes** in `petrios.uk` and **no custom domains**. The
  check reads the zone's routes, the account's Worker custom domains and the
  Worker's cron schedules with your wrangler login (`wrangler auth token
  --json`, never printed). An API token needs Zone Read, Workers Routes Edit
  and Workers Scripts Edit.
- `cf:build` and its guard pass (the dry run uses `--env production_preflight`).

It then runs `wrangler deploy --env production_preflight` with
`--message "petrios preflight <commit>"`. If wrangler asks "Would you like to
continue?" (the Worker was last changed through the API, for example by
`secret bulk`, or in the dashboard), answer yes. The script then confirms the
deploy: wrangler must report a version id, and the API must show no route, no
custom domain and no cron schedule. Only then does it print the checklist.

### Step 3: preflight smoke tests

At `https://petrios.<account-subdomain>.workers.dev`, against the **production
database** with email off. Sign-in links and Microsoft SSO return to
`petrios.uk` (Render), because that is the app URL and Supabase's redirect
target, so test signed-in pages with a password sign-in. Do not create real
rows.

- [ ] `curl -s https://petrios.<sub>.workers.dev/api/health` returns `{"status":"ok","db":"ok"}`.
- [ ] `/`, `/login`, `/privacy` return 200. `/privacy` and `/subprocessors` name Cloudflare Workers and show the new region and transfer texts, and no disclosure is shown as missing.
- [ ] `/dashboard` signed out returns 307 to `/login`; CSP and HSTS headers are present.
- [ ] A password sign-in (an admin) reaches the dashboard; an existing certificate PDF downloads with IBM Plex Mono; `/opengraph-image` renders.
- [ ] `curl -s -o /dev/null -w '%{http_code}' https://petrios.<sub>.workers.dev/api/cron/session-reminders` prints 401.
- [ ] `npx wrangler tail --env production_preflight --format pretty` shows your requests and no scheduled events.

### Step 4: find and disable Render's scheduled jobs

Only one scheduler may run the jobs against the database, and live starts the
Worker's. Before going live:

1. **Render dashboard → the service list.** Every service of type *Cron Job*
   whose command calls `/api/cron/*` (or runs `scripts/self-hosting/scheduler.mjs`):
   write down its schedule and command, then **Suspend** it (do not delete it;
   rollback resumes it). Also check for a *Background Worker* running the
   self-host scheduler. The web service's Docker image runs no scheduler
   (`scripts/self-hosting/start.mjs` starts only migrations and the server).
2. **Outside Render:** anything else that calls `https://petrios.uk/api/cron/*`
   or `https://byte-teaching.onrender.com/api/cron/*`, such as cron-job.org, an
   uptime monitor, a personal crontab, or Supabase `pg_cron`
   (`select jobname, schedule, command from cron.job;` in the SQL editor). The
   repository itself defines none: no GitHub workflow or migration calls these
   routes. Disable each one.
3. Wait until no Render cron run is in progress.
4. Recommended: keep Render's certificate renewable. While the Worker serves
   `petrios.uk/*`, a certificate authority's HTTP challenge to
   `petrios.uk/.well-known/acme-challenge/*` would reach the Worker (404)
   instead of Render, so Render may fail to renew its `petrios.uk` certificate,
   and a later rollback would then fail with 526 (SSL Full (strict)). Whether
   Render renews over HTTP here is not confirmed. In the dashboard, add a
   Workers route `petrios.uk/.well-known/acme-challenge/*` with Worker
   **None**: the more specific route keeps those requests on Render. It belongs
   to no Worker, so the script's route checks, rollback and wrangler's
   per-Worker route update all leave it alone.
5. Optional hardening: give Render's web service a new `CRON_SECRET` as well,
   so nothing can run a job through `byte-teaching.onrender.com`. If you do,
   the suspended Cron Jobs need that value before they are resumed on rollback.

### Step 5: go live

```bash
npm run cf:deploy:production -- live --render-crons-disabled
```

The flag is your attestation that step 4 is done; without it the script
refuses. It repeats the step 2 checks (a route is allowed: that is a redeploy
of a Worker already live) and runs `wrangler deploy --env production`.
Wrangler then attaches the route, sets the six cron schedules and disables
`workers.dev`. Traffic moves within seconds. Answer yes if wrangler asks
"Would you like to continue?".

The script confirms the result: a version id from wrangler, exactly the
`petrios.uk/*` route, exactly the six schedules and no custom domain. If any of
that fails:

- **First go-live** (the Worker had no route before): it immediately deletes
  whatever was attached and clears the schedules, so Render keeps serving, and
  prints `NOT LIVE`. Render's jobs are still suspended and nothing runs the
  jobs: fix the problem and rerun `live`, or resume Render's jobs at the time it
  prints (straight away if the Worker never had a schedule during the attempt).
- **Redeploy** (already live): if wrangler rejected the upload or a prompt was
  declined, the previous version keeps serving and running the jobs; check
  `/api/health` and run `rollback` only if the site is unhealthy. If the route
  is gone, it tells you to run `rollback` now.
- A refusal before the deploy (a failed build or guard, a missing secret)
  changes nothing on Cloudflare; on a first go-live it reminds you that
  Render's jobs are suspended.

**The first cron runs on the Workers runtime happen here, in production.**
Staging and preflight set `CRON_ENABLED="false"`, so neither `scheduled()` nor
any `/api/cron/*` job (for example `post-session-reports` rendering
certificate PDFs and sending email) has run on Workers before. Step 6 and the
first hours exist to catch that; rollback is the fallback.

### Step 6: verify

- **Who answers.** Render responses carry `rndr-id` (and
  `x-render-origin-server: Render`); Worker responses do not. Both carry
  `cf-ray`:

  ```bash
  curl -sI https://petrios.uk/login | grep -iE '^(rndr-id|x-render-origin-server|cf-ray):'
  ```

  Only `cf-ray` means the Worker answered. The same request also appears in
  `npx wrangler tail --env production --format pretty`.
- **`www` is unchanged.** It has no route, so it must still be Cloudflare's
  301 (the `cf-ray`-only test above would pass for it even before the
  cutover, so it proves nothing there):

  ```bash
  curl -sI https://www.petrios.uk/login | grep -iE '^(HTTP|location|rndr-id)'
  ```

  Expect `301`, `location: https://petrios.uk/login` and no `rndr-id`.
- `curl -s https://petrios.uk/api/health` returns `{"status":"ok","db":"ok"}`.
- Real sign-ins: magic link, Microsoft SSO and password. Existing sessions stay
  signed in (same `SUPABASE_URL`, same cookie name).
- **Crons.** In the tail, scheduled events print as
  `"5,20,35,50 * * * *" @ <time> - Ok` with a log line
  `[cron] ... -> /api/cron/recall-awards: HTTP 200`. Watch the first
  `recall-awards`, `session-reminders` (:00) and `post-session-reports` (:15)
  ticks, then the next morning's daily jobs.
- **No external callers.** `scheduled()` calls the app in-process, so a
  *request* event for `/api/cron/*` can only come from outside:

  ```bash
  npx wrangler tail --env production --format pretty | grep -E '^(GET|POST|HEAD) .*/api/cron/'
  ```

  Keep this running through the next hour and past 08:00 UTC. Each match is a
  scheduler you missed in step 4: it got 401, so it ran nothing, but find and
  disable it. Render's own logs should show no `/api/cron` requests.

### Step 7: the first hours

- Workers Observability: errors, exceeded CPU limits, Error 1102 (memory), and
  `npx wrangler tail --env production --status error`.
- Email volume in Resend matches a normal day, and `session_deliveries` gains no
  new `FAILED` rows.
- Every cron line reports HTTP 200; check 06:30 and 08:00 UTC the next day and
  07:00 UTC on Monday.
- Supabase auth logs show no wave of sign-outs or refresh failures; calendar
  feeds, Recall and unsubscribe links already issued still work.

### Rollback (seconds)

```bash
npm run cf:deploy:production -- rollback
```

1. Deletes every route of `petrios` in `petrios.uk` through the Cloudflare API
   with your wrangler login. The proxied DNS record never changed, so Render
   answers at once.
2. Clears the Worker's cron schedules (`PUT .../schedules []`), then reads the
   routes, custom domains and schedules back and checks that none remains. The
   Worker is now unreachable: no routes, no `workers.dev`. Custom domains are
   reported, never deleted (deleting one deletes its DNS record): remove them
   by hand.
3. Prints **when to resume Render's scheduled jobs**: 15 minutes after the
   schedules were cleared, rounded up to the minute. Clearing the schedules
   stops future triggers, not a run already in progress, and a Worker cron run
   can last up to 15 minutes (`ops-weekly` low-score notifications have no
   dedupe). Then resume the Cron Jobs suspended in step 4 (and anything else
   you disabled).
4. Redeploys the preflight shape (a rebuild, not urgent; `--skip-redeploy`
   stops before it).

If the API step fails, the script prints the manual steps: Cloudflare
dashboard → `petrios.uk` → Workers Routes → delete the routes whose Worker is
`petrios`; Workers & Pages → `petrios` → Settings → Trigger Events → delete
every Cron Trigger. Do not edit DNS records. Resume Render's jobs no sooner
than 15 minutes after the last Cron Trigger is deleted.

`npx wrangler rollback --env production` is **not** a rollback to Render. It
only swaps the Worker's code version while the routes stay; use it for a bad
Worker release when staying on Workers.

### Warm fallback

Keep the Render web service running, unchanged and with its scheduled jobs
suspended, for at least a week. Rollback is only a route removal while it is
there. Before relying on it after a long time, confirm in Render that its
`petrios.uk` custom domain still shows a valid certificate, because Render no
longer receives that domain's traffic (the ACME route in step 4 is meant to
keep renewal working). Once the week has passed without a
rollback, decommission Render deliberately, and update `CLAUDE.md`, spec 01 and
spec 09, which still describe Render as production until then.

## proxy.ts on Workers

Adapter 1.20.10 bundles Next 16's Node `proxy.ts` only experimentally. The build
warns: "Node.js middleware support is experimental in cloudflare". `proxy.ts`
stays as it is: it imports only edge-safe modules, and in local workerd
`/dashboard` correctly answered 307 to `/login` with the security headers present.

Verified fallback, if staging shows proxy problems: rename `proxy.ts` to
`middleware.ts` and export `middleware` (same body and `matcher`) so it runs on
the edge runtime. Smoke behaviour was identical, the warning disappeared, and
the middleware bundle shrank from about 5.5 MB to about 0.7 MB. The cost is
Next 16's deprecation warning. The change must update `CLAUDE.md` and
`spec/01-architecture.md` in the same commit. Either way, keep
`SUPABASE_INTERNAL_URL`, `AUTH_INTERNAL_URL` and `STORAGE_INTERNAL_URL` unset on Workers.

## Streaming responses

OpenNext 4.1.9's `cloudflare-node` wrapper hands Next a writer that completes
every write at once and enqueues into a response stream with no `pull()`.
`res.write()` therefore never reports backpressure, and Next reads a streamed
body (session documents up to 25 MiB, recap and Recall audio) from upstream as
fast as it arrives. Whatever a slow client has not read yet would queue in the
isolate, against the 128 MB limit shared by concurrent requests. Render's Node
response honours `drain` and is unaffected.

`cf:build` rewrites that writer in the bundled
`.open-next/server-functions/default/handler.mjs`
(`patchOpenNextStreamingBackpressure` in `scripts/cloudflare/lib.mjs`): the
response stream gets a 64 KiB byte-sized queue, a write completes only while
the queue is below it, and the client reading (`pull`) or leaving (`cancel`)
releases a withheld write. A stalled client then holds about the queue plus
Node's stream buffers, not the whole object. Nothing in `node_modules` changes.
The build fails if OpenNext's code no longer matches exactly once (revisit the
patch on every OpenNext upgrade, and drop it once upstream applies
backpressure). The guard fails if the marker `petrios-opennext-backpressure` is
missing from the dry-run upload, and `cf:preview` refuses an unpatched build.

## Limits

| Limit (Workers Paid) | Value | Notes |
|---|---|---|
| Memory | 128 MB per isolate, shared by its concurrent requests | Not enforced by local `wrangler dev` |
| CPU per HTTP request | 30 s default (up to 300 s via `limits.cpu_ms`) | Left at the default. SSR, scrypt (~48 ms) and PDF renders (10–144 ms) are far below it; Audio Recap is I/O wait, which does not count. Office text extraction for Anthropic document requests is bounded (see Known limitations). |
| CPU per Cron Trigger | 30 s below an hourly interval, 15 min at hourly or longer | Wall time capped at 15 min |
| Subrequests | 10,000 per invocation by default | `post-session-reports` makes about 11 per attendee |
| After the response | Work not awaited or registered via `waitUntil`/`after()` may be cancelled | `ctx.waitUntil` allows about 30 s more |
| Filesystem | Only bundled modules under `/bundle` | |
| WebAssembly | Only modules precompiled at upload | |

## Known limitations

- **Audio Recap memory is unproven on a deployed isolate.** With Anthropic,
  documents are uploaded to the Files API one at a time as a streamed body (a few
  chunks live); DOCX/PPTX text extraction keeps at most its 1,000,000-character
  text plus slide-order/notes relationships (crafted packages measured at a few
  MiB). Each upload attempt releases its source when it ends. On the
  OpenAI-compatible adapter a 50 MiB request still creates about 117 MiB of
  short-lived garbage (storage chunks plus base64 output). Local workerd does not
  enforce the 128 MB limit, so confirm on the Paid staging Worker, including two
  recaps at once.
- **Streamed downloads depend on a build-time patch** of OpenNext's response
  writer ([Streaming responses](#streaming-responses)). It is verified in Node
  and local workerd; how much Cloudflare's edge buffers between the isolate and
  a slow client is not measured, so run the slow-download checklist item.
- **Custom `OPENAI_BASE_URL` endpoints** must accept chunked request bodies and
  must not redirect: document requests now stream, so a 307/308 fails instead of
  being followed.
- **Custom `ANTHROPIC_BASE_URL` gateways** must pass the `anthropic-beta`
  header, accept chunked multipart `POST /v1/files` without redirecting, and
  support web search; otherwise recaps/newsletters fail.
- **Office text extraction CPU.** DOCX/PPTX are inflated and scanned in the
  Worker. Inflation stops at 64 MiB per document and once 1,000,000 characters
  are extracted (measured on Node: about 0.5 s for a markup-only document at the
  cap), so a 50-document newsletter stays under the 30 s default; confirm on
  staging.
- **SDK bundling.** `@anthropic-ai/sdk` bundles under OpenNext with
  `nodejs_compat` (`npm run cf:build` passes); its Node-only credential discovery
  is never reached because the key is passed explicitly.
- **Abandoned uploads.** If a tab closes between prepare and finalize, the
  `UPLOADING` row (never listed) and possibly its storage object remain. There
  is no sweeper yet.
- **Security headers.** On Render, `proxy.ts` skips `_next/static`,
  `_next/image`, `favicon.ico` and image files, so those never carry the
  security headers. On Workers, every file under `public/` is also served by the
  assets layer without running the Worker, so `public/fonts/*.ttf` and
  `/openapi.json` additionally lack CSP, X-Content-Type-Options, Referrer-Policy
  and X-Frame-Options. HTML and route-handler responses carry them on both hosts.
- **No image optimisation binding.** `next/image` is imported in two pages but
  no `<Image>` is rendered. Add an `IMAGES` binding if optimisation is adopted.
- **No incremental cache** (R2/KV). Revisit only if a route stops being dynamic.

## Staging validation checklist

Run against the staging Worker on Workers Paid. The move plan points staging at
the **production** database, so outbound email is off (see
[Outbound email on staging](#outbound-email-on-staging)) and every action you
take writes production rows. Use test sessions only, and send email only to
`OUTBOUND_EMAIL_ALLOWLIST` addresses.

- [ ] `/`, `/login`, `/privacy` return 200. `/dashboard` while signed out returns 307 to `/login`, and the CSP/HSTS headers are present.
- [ ] Sign-in end to end: magic link (to an allowlisted address), Microsoft SSO and password. The proxy refreshes the session cookie.
- [ ] `/opengraph-image` returns 200 `image/png`, rendered in IBM Plex Mono.
- [ ] Certificate download and preview return `%PDF-` with IBM Plex Mono. Also check a portfolio pack, a teaching dossier and an audit report.
- [ ] A 25 MiB session-document upload (PDF and DOCX/PPTX) at exactly 25 MiB, plus two concurrent uploads. Watch for Error 1102 (memory).
- [ ] Several concurrent 25 MiB document downloads and audio playbacks over a throttled (slow) connection. Memory stays flat (backpressure patch).
- [ ] Audio Recap generation with a realistic PDF + DOCX + PPTX set, then playback. Watch memory and wall time, check `audio_recaps.model` shows the serving model and the research sources are allow-listed, and confirm `client.files.list()` (Anthropic Console → Files) shows no `petrios-ai-` files afterwards, also after a forced failure.
- [ ] One newsletter with 10+ documents, and (if `OPS_ASSISTANT_ENABLED=true`) one assistant chat that calls a tool.
- [ ] Server-rendered times are UK local time, not UTC: during BST a certificate PDF date, a teaching-slot offer and the public feedback page's opening/closing notice match the session's UK wall-clock time.
- [ ] Webhooks: in a test organization whose only webhook endpoint is one you control, publish a test session and confirm `webhook_deliveries` rows and receipt with a valid `X-Petrios-Signature`.
- [ ] Email to a non-allowlisted address is refused (ledger row `FAILED`, nothing sent). Email to an allowlisted address arrives, and its links use the staging `APP_URL`.
- [ ] Cron routes return 401 without the bearer secret. No scheduled invocations appear in the staging Worker's logs.
- [ ] Workers Observability shows no unexpected errors or CPU-limit exceedances.

## Rollback

DNS, the database and Render's scheduler are untouched by a staging deploy or
by the production preflight. Render remains the origin until `live`.

- **Staging:** `npx wrangler rollback --env=""` restores the previous version.
  Deleting the `petrios-staging` Worker does not undo anything it wrote to the
  production database, and links in any email it sent (only to allowlisted
  addresses) stop working. Nothing else depends on it.
- **Production after the cutover:** `npm run cf:deploy:production -- rollback`
  removes the Worker's route and cron schedules in seconds (DNS is never
  changed), then you re-enable Render's scheduled jobs at the time it prints.
  See
  [Rollback (seconds)](#rollback-seconds).
