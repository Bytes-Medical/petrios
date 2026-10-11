# Self-hosting Petrios

Run the whole platform on infrastructure you control — a useful option for NHS
trusts and anyone with data-residency requirements. Database, auth, email,
video, and AI can all be pointed at services in your network, but self-hosting
does not prove residency by itself: verify every configured provider, log,
backup, support flow, DNS/CDN, and onward transfer.

## Architecture

Two moving parts:

1. **The app** — a stateless Next.js server (this repo / the Docker image). Outside Docker it needs Node.js 20.12 or later (Office text extraction uses `DecompressionStream('deflate-raw')`); the image uses Node 22.
2. **Supabase** — Postgres + auth. Either a hosted Supabase project
   (simplest) or [Supabase's official self-host stack](https://supabase.com/docs/guides/self-hosting/docker)
   on your own server.

The same app also builds for Cloudflare Workers, which is how the Petrios
production service runs (the Worker `petrios` on `petrios.uk` and
`app.petrios.uk`); see [cloudflare-workers.md](./cloudflare-workers.md),
"Production". The Docker image remains the supported self-hosting build.

## Quickstart (Docker)

```bash
git clone https://github.com/Bytes-Medical/petrios.git
cd petrios
cp .env.example .env.production   # fill in values (see matrix below)
docker compose --env-file .env.production up -d --build
curl http://localhost:3000/api/health   # → {"status":"ok","db":"ok"}
```

> **NEXT_PUBLIC_\* values are build-time.** They are inlined into the
> browser bundle (and the CSP) when the image builds — compose passes them
> as build args from `.env.production`. Changing the Supabase URL/anon key or
> app URL requires rebuilding the image
> (`docker compose --env-file .env.production up -d --build`); editing the env file alone is not enough.
> The Petrios Meet variables (`JITSI_DOMAIN`, `JAAS_*`, `JITSI_APP_*`,
> `JITSI_JWT_*`) are different: the server reads them at request time and never
> sends them to the browser, so recreating the container
> (`docker compose --env-file .env.production up -d`) is enough.

Apply database migrations (one of):

```bash
# a) plain Postgres connection (no Supabase CLI needed)
DATABASE_URL=postgres://postgres:...@your-db:5432/postgres npm run db:migrate

# b) Supabase CLI
supabase db push
```

## Environment matrix

| Concern | Cloud default | Self-hosted option |
|---|---|---|
| Database + auth | Hosted Supabase project | Supabase self-host stack (`SUPABASE_*` vars point at it) |
| Email | `RESEND_API_KEY` | **`SMTP_HOST`** (+ `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`) — any relay; takes priority over Resend |
| AI (optional) | Anthropic Claude (`ANTHROPIC_API_KEY`; dedicated workspace and key; Files API and web search enabled, and the Console web-search domain list must allow the Audio Recap domains) | **`LLM_PROVIDER=openai`** + `OPENAI_API_KEY` + **`OPENAI_BASE_URL`** → Azure OpenAI, a gateway, or a locally hosted OpenAI-compatible model. Always pin with `LLM_PROVIDER`: with both keys and a custom `OPENAI_BASE_URL`, AI stays off until you choose. Unset every LLM key to disable AI entirely |
| Audio recaps (optional) | Declaring either `ELEVENLABS_API_KEY` or `ELEVENLABS_VOICE_ID` selects ElevenLabs (both are required for it to work; one alone is reported as an incomplete configuration and never falls back to OpenAI); otherwise `OPENAI_API_KEY` selects OpenAI speech; otherwise speech is off (Anthropic has no speech API) | Pin with `TTS_PROVIDER`; OpenAI-compatible endpoints require `/audio/speech`, while ElevenLabs receives only the draft recap script during explicit audio creation |
| Video (optional) | meet.jit.si, opened in a new tab (never embedded: meet.jit.si cuts embedded calls after 5 minutes, and the first person in must sign in to Jitsi). For embedded rooms set **`JAAS_APP_ID`**, **`JAAS_API_KEY_ID`** and **`JAAS_PRIVATE_KEY`** (8x8 Jitsi as a Service; all three or none; step by step in [docs/petrios-meet.md](petrios-meet.md)). External teachers get room passes only with **`TEACHER_INVITATIONS_RLS_LOCKED=true`**, set after the database fix in spec/13 | **`JITSI_DOMAIN`** → your own Jitsi server, embedded; add **`JITSI_APP_ID`** + **`JITSI_APP_SECRET`** so only Petrios room passes can join (see [Self-hosted Jitsi](#self-hosted-jitsi)). `NEXT_PUBLIC_JITSI_DOMAIN` is a legacy alias |
| AI agent kill switch | on | `OPS_ENABLED=false` halts every agent surface |
| Chat assistant | **off** | `OPS_ASSISTANT_ENABLED=true` opts a deployment in (needs its own safety review) |
| Rota availability | **off** | **`ROTA_INTEGRATION_ENABLED=true`** (exactly) plus **`ROTA_IDENTITY_SECRET`** (≥ 32 random bytes, server-only; rotating it means re-linking every trainee), after migrations 063/064 are applied. Each organisation then enables it in Settings with a DPIA reference. See [docs/rota.md](rota.md) |
| Time zone (optional) | `Europe/London` | **`APP_TIME_ZONE`** (IANA name) for dates the server renders (emails, certificate/audit/portfolio PDFs, server pages, cron and Ops drafts) and for teaching-slot wall times. The container's `TZ` is not needed: these paths ignore the server clock's zone. Client panels that show teaching-slot or Ops times receive the server's value, so every surface uses the same zone |
| Public compliance facts | Required for production | `PRIVACY_CONTROLLER_NAME`, `PRIVACY_CONTROLLER_ADDRESS`, `PRIVACY_CONTACT_EMAIL`, `DATA_HOSTING_REGION`, `DATA_TRANSFER_SAFEGUARDS` |

With Anthropic, each recap/newsletter document is uploaded to the provider's Files API for one generation only (opaque `petrios-ai-` name, one-hour expiry, deleted when the generation ends; the daily `ops-synthesis` job deletes anything an interrupted request left). Files are workspace-scoped, so give Petrios its own Anthropic workspace and key.

All variables are documented in [`.env.example`](../.env.example).

## Self-hosted Jitsi

Point `JITSI_DOMAIN` at your Jitsi web host (`host` or `host:port`, no scheme or
path). Petrios embeds rooms named `Petrios-<session id>` from that origin, and
the CSP and Permissions-Policy delegate camera, microphone and screen sharing to
exactly that origin.

Without token authentication the room is **open**: anyone who learns the room
URL can join, and the room stays usable outside the Petrios room window. For
token-protected rooms enable Prosody token auth and give Petrios the same app
id and secret:

| Jitsi side (docker-jitsi-meet `.env`) | Petrios |
|---|---|
| `ENABLE_AUTH=1`, `AUTH_TYPE=jwt` | — |
| `JWT_APP_ID=petrios` | `JITSI_APP_ID=petrios` (JWT `iss`) |
| `JWT_APP_SECRET=<long random secret>` | `JITSI_APP_SECRET=<same secret>` (HS256) |
| `JWT_ACCEPTED_AUDIENCES` (if you restrict it) | `JITSI_JWT_AUDIENCE` (default `jitsi`) |
| XMPP domain (`XMPP_DOMAIN`, default `meet.jitsi`) | `JITSI_JWT_SUBJECT=meet.jitsi` (default is the `JITSI_DOMAIN` host, which suits a non-docker install whose XMPP domain is the public host) |

Petrios then mints a short-lived room pass for each participant: members get
one on the session page, accepted external teachers on their invitation (RSVP)
page. Passes are restricted to one room, expire no later than 30 minutes after
the session ends (and within 4 hours), carry `context.user.moderator` as the
string `"true"` for department moderators and accepted teachers (`"false"` for
everyone else), and carry a display name and a per-session pseudonymous id but
never an email address. The `features` claims ask for recording, live
streaming, transcription and dial-out to be off; your server enforces that only
if its own configuration does.

**Your Jitsi server decides whether those guarantees hold.** A stock
docker-jitsi-meet JWT install ignores the `moderator` claim, and Jicofo's
auto-owner makes the first person to join (possibly a trainee) a moderator.
For "only Petrios room-pass holders join, and only hosts moderate" you must
also:

1. Keep guest access off (`ENABLE_GUESTS` unset or `0`). With guests enabled,
   people without a pass can wait in the lobby or join the guest domain.
2. Turn Jicofo auto-owner off (`jicofo.conference.enable-auto-owner = false`;
   `ENABLE_AUTO_OWNER=false` in docker-jitsi-meet).
3. Load a Prosody MUC module that maps the token's moderator claim to room
   ownership (for example a community `token_moderation` or
   `token_affiliation` module via `XMPP_MUC_MODULES`), and check that it
   accepts the string value `"true"` that Petrios sends (the JaaS format).
   Note that setting `XMPP_MUC_MODULES` may replace the image's default list.

Then test with two browsers: a trainee must join as a participant, and a
department moderator or accepted teacher as a moderator. Without step 2 and 3
the moderator flag is advisory only; the session's manage card and the
installation page say so. JaaS (8x8) honours the claim itself and needs none of
this.

Set both `JITSI_APP_ID` and `JITSI_APP_SECRET` or neither. A partial or
malformed configuration makes video unavailable (the session's manage card
shows the reason) instead of silently using another service. Keep
`JITSI_APP_SECRET` out of the image and the repository like any other secret.

## Cron jobs

Schedule with any scheduler (cron, systemd timers, Kubernetes CronJobs) —
each route is idempotent and authenticated with an `Authorization: Bearer $CRON_SECRET` header:

| Route | Schedule |
|---|---|
| `/api/cron/session-reminders` | hourly |
| `/api/cron/post-session-reports` | hourly |
| `/api/cron/recall-send` | daily |
| `/api/cron/recall-awards` | every 5–15 minutes, or hourly |
| `/api/cron/ops-synthesis` | daily |
| `/api/cron/ops-weekly` | weekly |

`post-session-reports` also runs the deletion-only rota retention purge on every
run, even when rota availability is switched off, so keep it scheduled hourly
(spec/14).

Example crontab entry:

```
0 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://teaching.your-trust.nhs.uk/api/cron/session-reminders"
```

## Operations

- **Health**: `GET /api/health` → `{status, db}`; 503 when the database is
  unreachable (wired as the Docker HEALTHCHECK).
- **Backups**: all state lives in Postgres — back up the database; the app
  container is disposable.
- **Upgrades**: pull the new version, run `npm run db:migrate` (or
  `supabase db push`), rebuild the image. Migrations are strictly additive
  and numbered; never edit an applied one.
- **Federation identity** (optional): set `INSTANCE_SIGNING_KEY` (generate
  with `node scripts/generate-instance-key.mjs`) to enable signed, portable
  teaching-record exports that other instances can verify.

## Microsoft Entra SSO (NHSmail)

The login card offers "Continue with Microsoft" alongside the email
sign-in link. It uses Supabase Auth's `azure` OAuth provider, so no
Petrios environment variables are involved — configuration lives in your
identity provider and Supabase:

1. **Entra ID** (portal.azure.com → App registrations → New):
   - Redirect URI (Web): `https://<your-supabase-project>.supabase.co/auth/v1/callback`
     (self-hosted GoTrue: `https://<auth-host>/auth/v1/callback`).
   - Create a client secret; note the Application (client) ID.
   - Under *API permissions*, `email openid profile` delegated Microsoft
     Graph permissions (granted by default for new registrations).
2. **Supabase** (Dashboard → Authentication → Providers → Azure):
   - Enable, paste the client ID + secret.
   - Set *Azure Tenant URL* to your tenant (or leave multi-tenant to
     accept any Microsoft account, including all NHSmail tenants).
3. No app redeploy needed. Until the provider is enabled, the button
   returns a readable "not available on this deployment" message.

Accounts created via SSO follow the same onboarding as magic-link users:
membership comes from department codes/invitations, not from the identity
provider.

## Compliance

For NHS deployments see the [`DTAC evidence workbook`](./compliance/dtac.md),
[`DPIA template`](./compliance/dpia-template.md), and
[`privacy/security compliance specification`](../spec/13-privacy-security-and-compliance.md).
They are assessment inputs, not certification. Before release, fetch the public
privacy, privacy-choice, subprocessor and DPA pages from the production origin
and resolve every deployment fact that is shown as not declared.
