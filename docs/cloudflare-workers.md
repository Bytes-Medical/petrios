# Running Petrios on Cloudflare Workers

Petrios runs on Cloudflare Workers through
[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare) (1.20.10) and
wrangler (4.149). **Production is the Worker `petrios`**, served since
2026-10-11 through the Workers Custom Domains `petrios.uk` and
`app.petrios.uk` ([Production](#production)). Render, the previous host, is
retired. The Docker/Node build (`output: 'standalone'`,
[self-hosting](self-hosting.md)) stays supported for self-hosting and is
unchanged by this layer: the Cloudflare files are excluded from the Docker
context (`.dockerignore`), and the app code is the same on both runtimes.

Two Workers are configured. The **staging** Worker (`petrios-staging`,
`npm run cf:deploy:staging`) uses its `workers.dev` URL and has no routes and
no cron triggers. The **production** Worker (`petrios`,
`npm run cf:deploy:production -- deploy`) serves the two custom domains, runs
every scheduled job and is the only host that emails real users; `rollback`
restores an earlier version of its code and vars.

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
| `wrangler.jsonc` | Worker config. The top level is the staging Worker (`petrios-staging`); `env.production` is the production Worker (`petrios`) and its only other environment |
| `open-next.config.ts` | `defineCloudflareConfig()` with no incremental cache. The root layout is `force-dynamic`, so pages are never served from an ISR/SSG cache |
| `cfw/worker.ts` | Custom entry. It re-exports OpenNext's `fetch` and adds `scheduled()` |
| `cfw/yoga-redirect.ts`, `cfw/yoga-install.ts` | Make react-pdf work on Workers (see [PDFs and fonts](#pdfs-and-fonts)) |
| `cfw/cron.ts` | Pure cron-expression → `/api/cron/*` mapping and the `scheduled()` handler, with tests |
| `scripts/cloudflare/*.mjs` | `cf:build`, `cf:preview`, `cf:deploy:staging`, `cf:deploy:production` and the secret guard |
| `scripts/cloudflare/production-secrets.template.json` | Every production secret name with an empty value; copied and filled **outside** the repository ([Secrets](#secrets)) |
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
- Node 24. The scripts need Node ≥ 20.12 for `util.parseEnv`.

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
  `workers_dev: false`, or `CRON_ENABLED`, `OUTBOUND_EMAIL_ENABLED` or
  `ROTA_INTEGRATION_ENABLED` other than `"false"`. The rota pin keeps the
  staging Worker from ever writing trainee rota data to the production database
  (`docs/rota.md`, spec 14).
- the top-level `name` is the production Worker's (`petrios`, or whatever
  `env.production.name` says), or `services` is not exactly the
  `WORKER_SELF_REFERENCE` binding to the top-level name. Custom domains persist
  across deploys, so the staging config deployed as `petrios` would put an
  email-off version on `petrios.uk` and clear its cron schedules.
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
Write it by hand: do not copy `.dev.vars` or the production secrets. Wrangler
binds the file *after* the config and `--var`, with no collision check, so a
same-named entry would silently replace a validated var. `cf:deploy:staging`
therefore reads the file's variable **names** (never values) and refuses it if
it names a `vars` key (`APP_URL`, `CRON_ENABLED`, `OUTBOUND_EMAIL_ENABLED`,
`ROTA_INTEGRATION_ENABLED`, `TRUSTED_CLIENT_IP_HEADER`), a
name from the never-set row, or an `APP_URL` fallback (`NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_BASE_URL`, `NEXTAUTH_URL`, `VERCEL_*`, `RENDER_EXTERNAL_URL`).
It also refuses a file inside the repository or named like `.dev.vars*` or `.env*`.

Afterwards use `npx wrangler secret put <NAME> --env=""`. The empty `--env` pins the
top level even if `CLOUDFLARE_ENV` is set in your shell. Never store a secret
under a `vars` name. If one was ever stored, for example by an older deploy
with a copied file, delete it: `npx wrangler secret delete APP_URL --env=""`
(likewise `CRON_ENABLED`, `OUTBOUND_EMAIL_ENABLED`, `ROTA_INTEGRATION_ENABLED`).

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
| `vars` in `wrangler.jsonc` | `APP_URL` (staging: empty in config, set per deploy; production: `https://petrios.uk`), `CRON_ENABLED` (`"false"` at top level, `"true"` only in `env.production`), `OUTBOUND_EMAIL_ENABLED` (`"false"` at top level, `"true"` in `env.production`; see [Outbound email on staging](#outbound-email-on-staging)), `TRUSTED_CLIENT_IP_HEADER` (`"cf-connecting-ip"` everywhere: Cloudflare overwrites it, while the first `x-forwarded-for` hop is client-supplied, so the login-link and group-code rate limits must not use it), `HOSTING_PROVIDER` (`"cloudflare-workers"` everywhere, so `/privacy` and `/subprocessors` name Cloudflare Workers as the application host), `ROTA_INTEGRATION_ENABLED` (`"false"` at top level, enforced by the validators; declared `"false"` in `env.production` too until the owner's rota go-live, when only that value becomes `"true"`; see [Rota availability on Workers](#rota-availability-on-workers)) |
| Required secrets: deploy fails without them | Staging: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`. Production adds `RESEND_API_KEY`, `MAIL_FROM`, `PRIVACY_CONTROLLER_NAME`, `PRIVACY_CONTACT_EMAIL` (`PRIVACY_CONTROLLER_ADDRESS`, `DATA_HOSTING_REGION` and `DATA_TRANSFER_SAFEGUARDS` are optional and show as not declared until set) |
| Optional secrets (set when used) | `ATTENDANCE_RATE_LIMIT_SECRET`, `INSTANCE_SIGNING_KEY`, `RESEND_API_KEY` and `MAIL_FROM` (staging: only reach `OUTBOUND_EMAIL_ALLOWLIST` addresses), `OUTBOUND_EMAIL_ALLOWLIST` (staging only), `LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_FALLBACKS`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`, `TTS_PROVIDER`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`, `OPS_ENABLED`, `OPS_ASSISTANT_ENABLED`, `ROTA_IDENTITY_SECRET` (production only, at least 32 random bytes; never needed on staging, where rota is pinned off), Petrios Meet: `JAAS_APP_ID`, `JAAS_API_KEY_ID`, `JAAS_PRIVATE_KEY` (all three or none; the private key is a critical secret), or `JITSI_DOMAIN` with optional `JITSI_APP_ID` + `JITSI_APP_SECRET` (critical secret), `JITSI_JWT_AUDIENCE`, `JITSI_JWT_SUBJECT`, `TEACHER_INVITATIONS_RLS_LOCKED` (exactly `true` only after the spec 13 database fix), `GOOGLE_SITE_VERIFICATION`, `PRIVACY_CONTROLLER_NAME`, `PRIVACY_CONTROLLER_ADDRESS`, `PRIVACY_CONTACT_EMAIL`, `DATA_HOSTING_REGION`, `DATA_TRANSFER_SAFEGUARDS` |
| Not secret, usually unset | `APP_TIME_ZONE` (IANA zone for server-rendered dates and teaching-slot wall times; default `Europe/London`, so a UK deployment sets nothing). To change it, add it to `vars` in `wrangler.jsonc` at the top level **and** in `env.production` (environments do not inherit `vars`), which also lets `cf:preview` read it from `.dev.vars`; or store it as a secret like `MAIL_FROM` (the production secrets template lists it). `TZ` has no effect: the Workers clock is always UTC |
| Never set on Workers | `SUPABASE_INTERNAL_URL`, `AUTH_INTERNAL_URL`, `STORAGE_INTERNAL_URL`: Docker-network hostnames, which `global_fetch_strictly_public` blocks. Also `SELF_HOSTED_SETUP`/`SETUP_TOKEN` (self-host setup depends on unapplied migration 061), `DATABASE_URL`, and `NEXTJS_ENV` |
| Build-time only | `NODE_ENV` is inlined as `production` by `next build` |

SMTP (`SMTP_*`) has not been verified on Workers. Use Resend. `lib/email.ts`
switches to SMTP whenever `SMTP_HOST` is set, so `cf:deploy:production` refuses
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_SECURE` in the
secrets file and as stored secrets.

### Petrios Meet on Workers

The meeting mode (spec 04 "Petrios Meet") is resolved per request from the
Worker's environment, so it can differ between the production and staging
Workers. Store every meeting variable as a secret, like `MAIL_FROM`, because
deploys remove dashboard-only plain variables. The commands below set them on
staging (`--env=""`); for production use `--env production` instead:

```bash
npx wrangler secret put JAAS_APP_ID --env=""
npx wrangler secret put JAAS_API_KEY_ID --env=""
# Pipe the multi-line PEM from the downloaded file (the interactive prompt reads
# one line). A one-line value with literal \n escapes also works.
npx wrangler secret put JAAS_PRIVATE_KEY --env="" < /path/to/jaas-private-key.pem
# Only after the teacher_invitations policy fix (spec 13); same database as production.
echo true | npx wrangler secret put TEACHER_INVITATIONS_RLS_LOCKED --env=""
```

Full JaaS walkthrough (console, Worker secrets, verification): `docs/petrios-meet.md`.

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
`SENT` is never re-sent from production, and external teachers have no other copy
of their certificate. So the top level sets `OUTBOUND_EMAIL_ENABLED="false"`,
which `cf:deploy:staging` requires, and `lib/email.ts` then refuses every send
before contacting any provider. A refusal is an ordinary send error, so a
ledger-backed delivery (certificates, reminders) records a retryable failure
that the production Worker can send later with the production origin.

To test email on staging, set the `OUTBOUND_EMAIL_ALLOWLIST` secret to your own
address(es), comma-separated. Only a send whose every recipient is on the list
goes out. `OUTBOUND_EMAIL_ENABLED` unset, or any value other than exactly
`"false"`, leaves email unchanged: production sets `"true"`, and Docker or
self-hosted deployments never set it.

Even with email off, staging writes to the production database. Do not run real
workflows there: generating certificates, inviting teachers, publishing slots
or approving Ops actions for real sessions creates production rows (with failed
deliveries for everyone not on the allowlist).

### Rota availability on Workers

Rota availability (spec 14, [docs/rota.md](rota.md)) is off unless
`ROTA_INTEGRATION_ENABLED` is exactly `"true"`. The staging Worker serves the
production database, so `wrangler.jsonc` pins it to `"false"` in the top-level
`vars`; `stagingConfigProblems` (`scripts/cloudflare/lib.mjs`) refuses a
staging deploy with any other value, and the secrets checks refuse a secret
named like the var. `env.production.vars` declares it too (`"false"` today);
`productionConfigProblems` requires it to be declared as `"false"` or
`"true"`, and a stored secret of that name would shadow it, so the deploy
refuses one.

**Rota go-live on Workers** (owner only, after migrations 063 and 064 are
applied and the pilot's DPIA reference exists):

1. Set the `ROTA_IDENTITY_SECRET` Worker secret, at least 32 random bytes
   (`openssl rand -base64 48`), with
   `npx wrangler secret put ROTA_IDENTITY_SECRET --env production`. If one was
   ever set on Render, reuse that value byte for byte: a new value orphans
   every identity link made with the old one.
2. Edit only `env.production.vars.ROTA_INTEGRATION_ENABLED` in `wrangler.jsonc`
   from `"false"` to `"true"`. Leave the top-level value at `"false"`.
3. Deploy with `npm run cf:deploy:production -- deploy --dry-run`, then
   `npm run cf:deploy:production -- deploy`; the validators run first.

To switch it off again, set the value back to `"false"` and deploy (disable
each organisation in Settings first, `docs/rota.md` section 7). Leave
`ROTA_IDENTITY_SECRET` unset on staging. A `rollback` restores the target
version's value of the switch and says so when it differs.

Even with the switch off, the deletion-only rota purge runs inside every
`post-session-reports` cron run of the production Worker. Staging has no crons,
so it never runs there; on staging only check that the feature is inert (the
rota pages return 404 and the actions refuse).

### Privacy register

A Worker processes personal data: requests, IP addresses and auth cookies, the
application data it reads from and writes to the database, and Workers Logs
(`observability` is enabled), which keep console output, including error lines
that name recipient email addresses, for Cloudflare's plan-dependent retention
period. On every Worker, `/privacy` and `/subprocessors` name "Cloudflare
Workers" as the host (`HOSTING_PROVIDER`). Production runs on Cloudflare, so:

1. record Cloudflare (Workers, Workers Logs and the custom domains' edge, its
   regions and retention) in the controller's recipient register, the DPIA
   (`docs/compliance/dpia-template.md`) and the executed DPA's subprocessor
   list, and close Render's entry once the retired service and its logs are
   deleted;
2. make the production Worker's `DATA_HOSTING_REGION` and
   `DATA_TRANSFER_SAFEGUARDS` secrets describe Cloudflare's network as well as
   the Supabase region; and
3. keep the staging Worker in the register while it exists: it serves the same
   database, and the production pages cannot name it separately.

### Values that must stay stable

`SUPABASE_SERVICE_ROLE_KEY` doubles as an HMAC key: calendar-feed URLs, Recall
deep links, newsletter unsubscribe links, and the rate-limit pseudonym when
`ATTENDANCE_RATE_LIMIT_SECRET` is unset. The auth cookie name
(`sb-<host prefix>-auth-token`) is derived from `SUPABASE_URL`. Every Worker
that serves the production database must therefore hold the **same** values of
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`ATTENDANCE_RATE_LIMIT_SECRET` (if set) and `INSTANCE_SIGNING_KEY` (if set);
the cutover runbook had them copied byte for byte from Render to the
production Worker. A different value invalidates every calendar feed, Recall link and
unsubscribe link already issued, and a different `SUPABASE_URL` signs everyone
out. Rotate the service-role key only deliberately, with
[the procedure](#rotating-the-supabase-service-role-key).

`CRON_SECRET` is the exception: it is only the bearer token of `/api/cron/*`
and nothing derives from it. Each Worker has its own (the cutover runbook gave
the production Worker a new value, so a forgotten external scheduler still
holding Render's is refused with 401).

## Secret-leak guard

`opennextjs-cloudflare build` always compiles `.env`, `.env.production`,
`.env.local` and `.env.production.local` (plus the `.development`/`.test`
variants) into `.open-next/cloudflare/next-env.mjs`. At runtime that file fills
any variable Cloudflare does not set (`process.env[key] ??= value`). Built in a
folder with real `.env` files, the Worker would ship laptop secrets and silently
fall back to them. `.dockerignore` already keeps `.env*` out of the Docker image.

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
`recall-awards` gets 30 s. These six expressions are the production Worker's
Cron Triggers (`env.production.triggers.crons`, scheduled since 2026-10-11);
change `cfw/cron.ts` `CRON_SCHEDULE` and `env.production.triggers.crons`
together. `cfw/cron.test.ts` and `scripts/cloudflare/lib.test.ts` fail if the
two disagree.

The production Worker is the **only** scheduler of these jobs against the
production database ([One scheduler](#one-scheduler)); running them from two
schedulers would double-send email (not every job has a per-recipient ledger;
for example, ops-weekly low-score notifications have no dedupe). The defences
are layered:

1. The top level (staging) declares `"triggers": { "crons": [] }` (which
   clears any schedule) and no routes, and `env.production` is the only other
   environment. This is enforced by `cfw/cron.test.ts`,
   `scripts/cloudflare/lib.test.ts`, `cf:deploy:staging` and
   `cf:deploy:production` (which also refuses a reintroduced
   `env.production_preflight`).
2. `scheduled()` dispatches nothing unless `CRON_ENABLED` is exactly `"true"`.
   That value is set only in `env.production`; the top level sets `"false"`.
   A same-named entry in a `--secrets-file` silently replaces the var, so
   `cf:deploy:staging` refuses a secrets file that names any `vars` key. A
   stored secret and a var of the same name replace each other: a deploy
   overwrites the secret with the var (wrangler warns and asks, and answers
   yes by itself when not interactive), and a later `wrangler secret put`
   overwrites the var until the next deploy. `cf:deploy:production`
   therefore refuses to deploy while a stored secret has a var's name. Never
   store a secret named `CRON_ENABLED`.
3. The routes themselves refuse: with `CRON_ENABLED` exactly `"false"`,
   `lib/cron-auth.ts` answers every authenticated `/api/cron/*` request with
   503, so nobody holding `CRON_SECRET` can run a job on staging over HTTP.
   Docker and self-hosted deployments leave it unset, so their routes run.
4. `cf:deploy:production -- deploy` publishes exactly the six schedules and
   confirms them from the API; `rollback` never touches them. The production
   `CRON_SECRET` is the Worker's own, so any external caller is refused.

## Production

Production is the Worker `petrios` (wrangler environment `env.production`,
account `610371b5de9811b7d258c7622c23849b`, zone `petrios.uk`). It is the only
production host, the only scheduler of the cron jobs and the only host that
emails real users. Only the account owner deploys it, always with
`npm run cf:deploy:production` (`scripts/cloudflare/deploy-production.mjs`);
`productionConfigProblems()` in `scripts/cloudflare/lib.mjs` (unit-tested in
`lib.test.ts` and `cfw/cron.test.ts`) refuses any other shape of
`env.production`, and a reintroduced `env.production_preflight`.

### Domains

| Hostname | How it is served |
|---|---|
| `petrios.uk` | Workers Custom Domain of `petrios`. `APP_URL` is `https://petrios.uk`: every emailed link, certificate QR code and cron dispatch uses it |
| `app.petrios.uk` | Workers Custom Domain of `petrios`, the same app |
| `www.petrios.uk` | A zone-level Cloudflare 301 to `https://petrios.uk/`, not the Worker. Leave it alone |
| `petrios.<account-subdomain>.workers.dev`, preview URLs | Off (`workers_dev: false`, `preview_urls: false`) |

The Worker has **no plain Workers routes**. Cloudflare creates and manages the
DNS records of custom domains: never edit or delete them by hand, and keep the
email records of the zone untouched.

`env.production.routes` is the **complete** set of custom domains, exactly
`PRODUCTION_CUSTOM_DOMAINS` in `scripts/cloudflare/lib.mjs`
(`[{ "pattern": "petrios.uk", "custom_domain": true }, { "pattern": "app.petrios.uk", "custom_domain": true }]`).
Wrangler publishes custom domains as a replacement of the Worker's set, so a
hostname left out of the list is detached on the next deploy and its DNS
record deleted. To add or remove a hostname, change the list and the constant
together (the tests compare them), and expect the deploy preview to report the
change: a removal is refused, so detach a hostname deliberately in the
dashboard first.

### Commands

| Command | What it does |
|---|---|
| `npm run cf:deploy:production -- check-secrets <file>` | Validates a filled secrets file by name and emptiness; contacts nothing |
| `npm run cf:deploy:production -- secrets <file>` | `check-secrets`, then `wrangler secret bulk --env production`: a new version with those values goes live at once |
| `npm run cf:deploy:production -- deploy --dry-run` | Every deploy check, the Cloudflare reads and the custom-domain preview, `cf:build` and its guard, then `wrangler deploy --dry-run --env production`. Uploads nothing and changes nothing |
| `npm run cf:deploy:production -- deploy` | The same, then `wrangler deploy --env production`, confirmed from the Cloudflare API |
| `npm run cf:deploy:production -- rollback [<version-id>]` | Restores an earlier version's code and vars (default: the previous one) with the deployment request `wrangler rollback` sends, never forced, so Cloudflare refuses it across a secret change. Never touches custom domains, routes or cron schedules |
| `preflight`, `live` | Retired: refuse at once, before contacting anything |

### Wrangler behaviour this relies on (verified in wrangler 4.149.0 source)

- **Custom domains are published as a complete set.** When the config lists at
  least one custom domain, `triggersDeploy()` calls `publishCustomDomains()`
  (`deploy-helpers/src/triggers/publish-routes.ts`): first
  `POST /accounts/<id>/workers/scripts/<name>/domains/changeset?replace_state=true`
  with the configured hostnames, which computes `added`, `removed`, `updated`
  and `conflicting` and applies nothing, then `PUT .../domains/records` with
  the same list. With `replace_state`, a hostname of the Worker that is not in
  the list is detached and its DNS record deleted. A config with no custom
  domain skips both calls (`if (customDomainsOnly.length > 0)`) and leaves
  existing custom domains alone; production always lists both.
- **Not interactive means no questions.** When stdout is not a terminal,
  wrangler sets `override_existing_dns_record` and `override_existing_origin`
  to true without prompting: a conflicting DNS record is replaced and a
  hostname attached to another Worker is moved to this one. If the changeset
  request itself fails, it carries on with an empty changeset. Interactively
  it asks before either override, and throws if the changeset fails. So the
  script sends the same changeset request itself first and refuses on any
  removal, conflict or foreign hostname before building. A deploy run without
  a terminal (an agent or a pipe) relies on that preview, taken seconds before
  the upload, and says so; from a terminal wrangler still asks.
- **A CI variable also means no questions.** Every wrangler prompt
  (`confirm()` in `src/dialogs.ts`) takes its fallback answer, yes, when
  ci-info detects CI, even in a terminal: `CI`, `BUILD_ID`, `BUILD_NUMBER`,
  `RUN_ID`, `CONTINUOUS_INTEGRATION`, `CI_NAME` or a CI vendor's variable.
  `CI=false` disables every one of those checks, so the script runs
  `wrangler deploy` with `CI=false` and its custom-domain questions reach the
  operator.
- **Routes are replaced only when listed, never removed.** `publishRoutes()`
  runs only `if (routesOnly.length > 0)`, so a deploy without plain routes
  leaves any existing one attached. Production has none, and the script
  refuses while one points at the Worker.
- **Schedules follow `triggers.crons` on every deploy.** The list is `PUT` to
  `.../schedules` (an explicit `[]` clears them; an absent key keeps them).
- **The version goes live before the triggers are published.** `deploy()`
  uploads and deploys the new version, then calls `triggersDeploy()`, which
  publishes custom domains, routes and schedules concurrently and fails the
  deploy if any of them failed ("Trigger configuration … was only partially
  updated. Successful trigger changes were not rolled back."). So the script
  reads all three back after every deploy, and a failure at that stage leaves
  the new version serving.
- **Wrangler can exit 0 without deploying.** `preUploadApiChecks()` asks
  "Would you like to continue?" when the Worker was last changed through the
  API or dashboard, or when a var would overwrite a stored secret; answering
  no returns `{ versionId: null }` with exit code 0. The script runs the
  deploy with `WRANGLER_OUTPUT_FILE_PATH` and requires the `deploy` entry's
  `version_id`.
- **Required secrets.** `secrets.required` names are bound as `inherit`
  bindings and the API rejects an upload that lacks one. Deploys keep stored
  secrets.
- **vars, services and secrets are not inherited** by environments, so
  `env.production` declares them in full, including
  `WORKER_SELF_REFERENCE -> petrios`. `--var` and `--secrets-file` would
  override a config var of the same name without a warning; the production
  script passes neither and takes `APP_URL` only from `wrangler.jsonc`. A
  deploy overwrites a stored secret that has a var's name (a warning and a
  prompt), and a later `secret put` overwrites the var until the next deploy,
  so the script refuses to deploy while such a secret exists.
- **Rollback changes only which version is deployed.** `wrangler rollback`
  (`src/versions/rollback/index.ts`) creates a deployment
  (`POST .../workers/scripts/<name>/deployments`) that sends 100% of traffic
  to the chosen version; it makes no route, custom-domain or schedule call, so
  those stay as they are. Without a version id it takes the 100% version of
  the newest earlier deployment. `--message` becomes the default of its
  message prompt. `--yes` is accepted but not read by the 4.149 handler: when
  stdin or stdout is not a terminal (or `CI` is set), every prompt takes its
  fallback answer, yes. If secrets changed since the chosen version, the API
  refuses (code 10220); wrangler then asks "The following secrets have changed
  since version … was deployed. Please confirm you wish to continue with the
  rollback" and retries with `force=true`, without asking when it is not
  interactive. Wrangler also warns that a rollback does not roll back bound
  resources. So the script does not run `wrangler rollback`: it sends the same
  `POST .../deployments` itself (100% to the target, a `workers/message`
  annotation) and never `force=true`, and stops on code 10220. Cloudflare
  compares the secrets themselves, which the deployment history cannot show
  (a secret changed with `versions secret put` + `versions deploy`, or in the
  dashboard, leaves no "Secret Change" deployment).
- **Secret changes deploy at once, and are refused after a rollback.**
  `wrangler secret put` and `secret bulk` (`src/secret/index.ts`) write to the
  Worker, which deploys a new version with the new value. While the newest
  version is not the deployed one (after a rollback), the API refuses (codes
  10214/10215) and wrangler suggests `wrangler versions secret put`, or
  deploying the latest version first. **Never follow either after a
  rollback:** `versions secret put`/`bulk` send
  `PATCH .../workers/<name>/versions/latest`, which copies the newest
  *uploaded* version (the code just rolled back from) with the new secret, and
  deploying that copy, or "the latest version", puts the bad code back on both
  hostnames.

### Deploy

1. Apply any database migration the release needs first (the script does not
   check). Migrations only move forward, so the code must also work on the
   schema it finds.
2. Work from a clean git checkout of the commit to ship (normally `main`),
   logged in with `npx wrangler login` as the account owner. A terminal is
   preferred (wrangler then asks before any override; a `CI` variable in your
   shell is overridden, wrangler runs with `CI=false`); without one, the deploy
   relies on the script's custom-domain preview:

   ```bash
   git fetch origin && git worktree add --detach ../petrios-deploy origin/main && cd ../petrios-deploy && npm ci
   npm run cf:deploy:production -- deploy --dry-run
   npm run cf:deploy:production -- deploy
   ```

Both runs refuse, with a fix for each case, unless all of the following hold:

- `wrangler.jsonc` passes `productionConfigProblems()` (the shape described in
  [Domains](#domains), the six crons of `cfw/cron.ts`, `CRON_ENABLED`,
  `OUTBOUND_EMAIL_ENABLED`, `TRUSTED_CLIENT_IP_HEADER`, `HOSTING_PROVIDER` and
  `ROTA_INTEGRATION_ENABLED` declared, the required secrets, no other
  environment); `APP_URL` in your shell is unset or `https://petrios.uk`; and
  `CLOUDFLARE_ACCOUNT_ID`, if set, is the pinned account.
- The checkout is clean (it prints the commit, and warns if it is not `main`).
- `wrangler secret list --env production` (read-only, names only) shows every
  required secret and no secret that shadows a var, uses a never-set or
  fallback name, or is `SMTP_*`.
- The Cloudflare reads succeed, with your wrangler login (`wrangler auth token
  --json`, never printed): the zone `petrios.uk`, the Worker's plain routes in
  it, the account's custom domains and the Worker's cron schedules, plus the
  custom-domain changeset preview (compute-only).
- The preview shows no hostname that would be **detached**, no configured
  hostname with a **conflicting DNS record**, and none that is a custom domain
  of **another Worker**; and no plain route points at the Worker. A hostname
  that would be attached (configured but missing) or a settings update is
  reported, not refused, and so is any drift in the current schedules.
- `cf:build` and its guard pass (the guard's dry run uses `--env production`).

With `--dry-run` the script then runs `wrangler deploy --dry-run --env
production`, which bundles and lists the bindings, and stops: nothing is
uploaded and nothing on Cloudflare changes. Without it, it runs
`wrangler deploy --env production --message "petrios deploy <commit>"`. If
wrangler asks "Would you like to continue?" (the Worker was last changed
through the API, for example by a secret change, or in the dashboard), answer
yes. If it asks to point a custom domain or a DNS record at this Worker,
answer **no**: the preview found no conflict, so something changed in between.

The deploy is confirmed only when wrangler reported a version id and the API
shows exactly the two custom domains, no plain route and exactly the six cron
schedules. The script then prints the checklist:

- `curl -s https://petrios.uk/api/health` and `curl -s https://app.petrios.uk/api/health`
  each return `{"status":"ok","db":"ok"}`.
- `npx wrangler tail --env production --format pretty` shows requests and no
  new errors.
- The next cron runs log `"<expression>" @ <time> - Ok` and
  `[cron] ... -> /api/cron/<job>: HTTP 200`: `recall-awards` (:05, :20, :35,
  :50), `session-reminders` (:00), `post-session-reports` (:15), then the
  daily jobs (06:30, 08:00 UTC) and `ops-weekly` (Monday 07:00 UTC).

**If the deploy is not confirmed**, the script lists what failed. Custom
domains and cron schedules persist across deploys, so unless the listed state
says otherwise the Worker still serves both hostnames and runs the jobs. A
rejected upload or a declined "Would you like to continue?" deploys nothing
and the previous version keeps serving; a failure while publishing custom
domains or schedules happens after the new version went live. Check which
version serves with `npx wrangler deployments status --env production`, and
`/api/health` on both hosts. A missing custom domain or wrong schedules: rerun
`deploy` (it publishes both from `wrangler.jsonc`) or fix them in Workers &
Pages → `petrios` → Settings (Domains & Routes, Trigger Events). A new version
that serves and misbehaves: `rollback`.

### Rolling back production

```bash
npm run cf:deploy:production -- rollback                 # the previous version
npm run cf:deploy:production -- rollback <version-id>    # npx wrangler deployments list --env production lists them
```

A rollback restores an earlier version's **code and vars** on the live
custom domains in seconds, with no rebuild. Custom domains, DNS records, routes
and cron schedules are not part of a version and are never touched. There is
no other host to hand traffic to.

Before rolling back, the script reads the deployment history and both versions
through the Cloudflare API (read-only) and refuses, changing nothing, when:

- the target is already deployed, or served 100% of traffic in none of the
  deployments the API returns (it is not a known production version);
- the target has a different set of secret names from the current version;
- the target's vars are not production's (`APP_URL` `https://petrios.uk`,
  `CRON_ENABLED` and `OUTBOUND_EMAIL_ENABLED` `"true"`,
  `TRUSTED_CLIENT_IP_HEADER`, `HOSTING_PROVIDER`, `ROTA_INTEGRATION_ENABLED`
  declared). This catches the versions of the retired preflight phase (crons
  and email off) and the empty stub Worker `secret bulk` once created.

It then sends the deployment request `wrangler rollback` sends
(`POST .../workers/scripts/petrios/deployments`: the target at 100%, message
"petrios rollback to <target> from <current>"), **never with `force=true`**.
If any secret changed since the target served, however it was changed,
Cloudflare refuses (code 10220, naming the secrets) and nothing changes: the
target would run with the old values, which may have been revoked. The script
does not run `wrangler rollback`, which would answer its own "secrets have
changed" prompt with yes and retry forced whenever it is not interactive.

It confirms from the API that the target now serves 100% of traffic and that
the custom domains and schedules are unchanged, and prints what a rollback
does **not** undo: database migrations (the old code runs on the current
schema); cron triggers, custom domains and routes (unchanged); secrets (see
[After a rollback](#after-a-rollback)); data written and email sent by the
bad version; and the next `deploy`, which ships `HEAD` again, so revert or fix
the bad commit on `main` first.

To restore a version **and** the old values of secrets changed since (only if
every old value is still valid), run
`npx wrangler rollback <version-id> --env production` yourself in an
interactive terminal with `CI` unset: it lists the changed secrets and asks
first. If the API cannot be reached, roll back by hand: Cloudflare dashboard →
Workers & Pages → `petrios` → Deployments → pick the last good version under
Version History → Rollback. Leave Settings → Domains & Routes and Trigger
Events alone.

#### After a rollback

While a rolled-back version serves, the newest uploaded version is the bad one
rolled back from, so:

- `wrangler secret put`/`bulk` and the `secrets` command refuse ("the latest
  version of your Worker isn't currently deployed").
- **Never** use `npx wrangler versions secret put`/`bulk` followed by
  `npx wrangler versions deploy` to get around that, and never "deploy the
  latest version first" as wrangler suggests: both copy or deploy the newest
  uploaded version, which puts the rolled-back code back on `petrios.uk` and
  `app.petrios.uk`.
- Revert or fix the bad commit on `main`, ship it with
  `npm run cf:deploy:production -- deploy` (it uploads that commit), and only
  then change secrets with `npx wrangler secret put <NAME> --env production`
  or `npm run cf:deploy:production -- secrets <file>`. When a secret must
  change urgently, `git revert` the bad commit on `main` and deploy that
  rather than wait for a fix.

### Secrets

Production secrets belong to the Worker `petrios`, separate from staging's.
`scripts/cloudflare/production-secrets.template.json` lists every name
Petrios reads. Every secret change deploys a new version with the new value at
once, so a wrong value breaks the live site immediately: check
`/api/health` on both hosts afterwards.

- **One secret:** `npx wrangler secret put <NAME> --env production` (hidden
  prompt, or `< file` from a file outside the repository). Delete one with
  `npx wrangler secret delete <NAME> --env production`.
- **Several at once:** copy the template outside the repository, fill it,
  delete every key you leave empty, then:

  ```bash
  cp scripts/cloudflare/production-secrets.template.json ~/petrios-production-secrets.json
  chmod 600 ~/petrios-production-secrets.json
  npm run cf:deploy:production -- check-secrets ~/petrios-production-secrets.json
  npm run cf:deploy:production -- secrets ~/petrios-production-secrets.json
  rm ~/petrios-production-secrets.json
  ```

  `check-secrets` contacts nothing. It reads the file in memory and prints
  names only. It refuses a file inside the repository, a missing required
  name, an empty or non-string value (wrangler would store `""`, or delete a
  secret given `null`), a `vars` name, a never-set name, an `APP_URL`
  fallback, half of an all-or-none group (ElevenLabs key + voice, the three
  JaaS values, Jitsi app id + secret), both LLM keys plus `OPENAI_BASE_URL`
  without `LLM_PROVIDER`, and any `SMTP_*` name (`SMTP_HOST` would switch email
  from Resend to SMTP). It warns about names Petrios does not read. `secrets`
  repeats the check, confirms the Worker exists (read-only
  `wrangler secret list`; it never lets wrangler create an empty `petrios`),
  prints which names it replaces and adds, and runs
  `wrangler secret bulk <file> --env production`.
- **After a rollback** both commands are refused until a fixed `main` is
  deployed; never work around that with `wrangler versions secret put` or
  `versions deploy`, which would redeploy the rolled-back code
  ([After a rollback](#after-a-rollback)).
- Never store `APP_URL`, `CRON_ENABLED`, `OUTBOUND_EMAIL_ENABLED`,
  `ROTA_INTEGRATION_ENABLED`, `TRUSTED_CLIENT_IP_HEADER`, `HOSTING_PROVIDER`
  (vars), `NEXT_PUBLIC_APP_URL` or other `APP_URL` fallbacks,
  `*_INTERNAL_URL`, `DATABASE_URL`, `NEXTJS_ENV`, `NODE_ENV`, `RENDER*` or
  `SMTP_*` (unverified on Workers; refused).

| Name | Value |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | The production project's URL and anon key. Changing `SUPABASE_URL` signs everyone out (the auth cookie name derives from it) |
| `SUPABASE_SERVICE_ROLE_KEY` | The service-role key. Rotating it has consequences: see below |
| `CRON_SECRET` | Random (`openssl rand -hex 32`). Only the bearer token of `/api/cron/*`; the Worker's `scheduled()` reads the same secret, so a new value needs nothing else |
| `RESEND_API_KEY`, `MAIL_FROM` | Required: production email cannot send without them |
| `PRIVACY_CONTROLLER_NAME`, `PRIVACY_CONTROLLER_ADDRESS`, `PRIVACY_CONTACT_EMAIL` | Name and contact are required (public disclosures, `lib/compliance.ts`); the address is optional |
| `DATA_HOSTING_REGION`, `DATA_TRANSFER_SAFEGUARDS` | Must describe Cloudflare's global network (Workers, Workers Logs) as well as the Supabase region. Optional until the controller has reviewed the wording; shown as not declared until set |
| `ATTENDANCE_RATE_LIMIT_SECRET`, `INSTANCE_SIGNING_KEY` | Optional. Once set, never replace them (rate-limit pseudonyms, signed teaching records) |
| `GOOGLE_SITE_VERIFICATION`, `OPS_ENABLED`, `OPS_ASSISTANT_ENABLED` | Optional |
| `TEACHER_INVITATIONS_RLS_LOCKED` | `true` only after migration 062 is applied and verified (spec 13) |
| `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_FALLBACKS`), `LLM_PROVIDER`, `OPENAI_*` | Optional; AI is off without a key |
| `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` (+ `ELEVENLABS_MODEL_ID`), `TTS_PROVIDER` | Optional; both or neither |
| `JAAS_APP_ID` + `JAAS_API_KEY_ID` + `JAAS_PRIVATE_KEY`, or `JITSI_DOMAIN` with `JITSI_APP_ID` + `JITSI_APP_SECRET`, `JITSI_JWT_*` | Optional (`docs/petrios-meet.md`). Multi-line values, such as the JaaS PEM, are JSON strings with `\n` escapes in the secrets file |
| `OUTBOUND_EMAIL_ALLOWLIST` | Staging only; it has no effect while production email is on. Do not set it |
| `APP_TIME_ZONE` | Optional (default `Europe/London`) |
| `ROTA_IDENTITY_SECRET` | Set once at rota go-live ([Rota availability on Workers](#rota-availability-on-workers)); never rotate it |

#### Rotating the Supabase service-role key

`SUPABASE_SERVICE_ROLE_KEY` is also the HMAC key of calendar-feed URLs, Recall
deep links and newsletter unsubscribe links, and of the group-code rate-limit
pseudonym while `ATTENDANCE_RATE_LIMIT_SECRET` is unset. A new value
invalidates every feed URL, Recall link and unsubscribe link already issued:
members must re-subscribe their calendars, and unsubscribe requests from
newsletters already sent must be handled by hand. Rotate it after a suspected
leak, not routinely.

1. In Supabase (Project Settings → API Keys), create the new secret key and
   keep the old one valid until step 5. A legacy JWT `service_role` key cannot
   be replaced on its own: that means rotating the project's JWT secret, which
   also replaces the anon key; plan it as a separate change that updates
   `SUPABASE_ANON_KEY` in the same window.
2. Store it on the production Worker (a new version goes live at once):

   ```bash
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production
   ```

   Paste it at the hidden prompt; never put it in a repository file or the
   shell history. If it is refused because production runs a rolled-back
   version, deploy a fixed `main` first ([After a rollback](#after-a-rollback));
   never use `wrangler versions secret put` here.
3. Store it on every other deployment that serves this database, so its
   service-role calls keep working: the staging Worker
   (`npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env=""`).
4. Verify: `/api/health` on both hosts, a sign-in, a certificate PDF download,
   a newly issued calendar feed, and `npx wrangler tail --env production
   --status error` staying quiet through the next `post-session-reports` run
   (:15).
5. Revoke the old key in Supabase.

Afterwards Cloudflare refuses a `rollback` to any version from before the
rotation (code 10220, secrets changed since), because such a version would run
with the revoked key; the script never forces it. Do not use
`npx wrangler rollback` for those versions either: it would offer to restore
the revoked key.

### Monitoring

- Live logs: `npx wrangler tail --env production --format pretty`; errors only:
  add `--status error`. Workers Observability (Workers & Pages → `petrios` →
  Observability) keeps the console output, errors, exceeded CPU limits and
  Error 1102 (memory) for its retention period.
- Health: `curl -s https://petrios.uk/api/health` and the same on
  `app.petrios.uk`. An uptime monitor may poll `/api/health`, never
  `/api/cron/*`.
- Crons: each run prints `"<expression>" @ <time> - Ok` and
  `[cron] ... -> /api/cron/<job>: HTTP <status>`; anything other than 200 is a
  failed job. Check 06:30 and 08:00 UTC daily and 07:00 UTC on Monday.
- Stray schedulers: `scheduled()` calls the app in-process, so a *request*
  event for `/api/cron/*` comes from outside:

  ```bash
  npx wrangler tail --env production --format pretty | grep -E '^(GET|POST|HEAD) .*/api/cron/'
  ```

  Each match got 401 (the production `CRON_SECRET` is the Worker's own), so it
  ran nothing, but find and disable it.
- Email volume in Resend matches a normal day, and `session_deliveries` gains no
  new `FAILED` rows.

### One scheduler

Only one scheduler may run the cron jobs against the production database:
the production Worker. Running them twice would double-send email (not every
job has a per-recipient ledger; `ops-weekly` low-score notifications have no
dedupe).

- Render is retired (its service was suspended on 2026-10-11 and will not be
  resumed). Never re-enable a Render Cron Job or add an external caller of
  `/api/cron/*`.
- The staging Worker has no cron triggers and `CRON_ENABLED="false"`, so its
  `/api/cron/*` routes answer 503 ([Cron safety model](#cron-safety-model)).
- A Docker or self-hosted copy pointed at the production database must set
  `CRON_ENABLED=false` and `OUTBOUND_EMAIL_ENABLED=false`, and must not run the
  self-host scheduler.
- `deploy` publishes exactly the six schedules of `cfw/cron.ts`; `rollback`
  never changes them. To pause every job in an emergency, remove the Cron
  Triggers in Workers & Pages → `petrios` → Settings → Trigger Events (the
  next `deploy` restores them).

### API token permissions

With an API token instead of `npx wrangler login`, the token needs, for this
script and the wrangler commands it runs: **Account**: Workers Scripts Edit
(upload, deployments, versions, schedules, custom domains, secrets);
**Zone `petrios.uk`**: Zone Read (the zone lookup) and Workers Routes Read (the
plain-route check). No DNS permission: Workers Custom Domains manage their own
DNS records, and the deploy writes no plain route.

### Cutover history

- **2026-10-09/10.** The tooling prepared a reversible move from Render: a
  plain Workers route `petrios.uk/*` on the existing proxied DNS record, a
  `preflight` phase on `workers.dev` with crons and email off, `live
  --render-crons-disabled`, and a `rollback` that deleted the route and the
  crons to hand traffic and jobs back to Render.
- **2026-10-11.** Production moved instead to Workers Custom Domains
  `petrios.uk` and `app.petrios.uk` on the Worker `petrios` (version
  `0bc8e8b8-ec9c-47f1-9ae6-dc1e3f81c35e`, built from commit `f6cb184` with
  those custom domains in `env.production.routes`). Cloudflare manages their
  DNS records; the proxied A record `petrios.uk → 216.24.57.1` (Render) is
  gone, and `www.petrios.uk` stayed a zone-level 301. The owner suspended the
  Render service the same day and will not resume it: Cloudflare is the only
  scheduler and there is no warm fallback host. The tooling was then aligned:
  `env.production_preflight` and the `preflight`/`live`/Render `rollback`
  commands were removed (on the live custom domains they would have deployed
  an email-off, cron-less version, or deleted the crons), and replaced by
  `deploy` and a code-only `rollback`.

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
isolate, against the 128 MB limit shared by concurrent requests. The Node
response (Docker, self-hosting) honours `drain` and is unaffected.

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
- **Security headers.** On Node (Docker), `proxy.ts` skips `_next/static`,
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
- [ ] Rota availability is inert: `/rota` and `/departments/<id>/rota` return 404, Settings has no Rota availability section, and no rota action succeeds. Do no functional rota testing on staging.
- [ ] Workers Observability shows no unexpected errors or CPU-limit exceedances.

## Rollback

- **Staging:** `npx wrangler rollback --env=""` restores the previous version.
  Deleting the `petrios-staging` Worker does not undo anything it wrote to the
  production database, and links in any email it sent (only to allowlisted
  addresses) stop working. Nothing else depends on it.
- **Production:** `npm run cf:deploy:production -- rollback [<version-id>]`
  restores an earlier version's code and vars in seconds; custom domains, DNS
  and cron schedules stay as they are, and there is no other host to fall
  back to. See [Rolling back production](#rolling-back-production).
