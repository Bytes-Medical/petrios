# Self-hosting Petrios

Run the whole platform on infrastructure you control — a useful option for NHS
trusts and anyone with data-residency requirements. Database, auth, email,
video, and AI can all be pointed at services in your network, but self-hosting
does not prove residency by itself: verify every configured provider, log,
backup, support flow, DNS/CDN, and onward transfer.

## Architecture

Two moving parts:

1. **The app** — a stateless Next.js server (this repo / the Docker image).
2. **Supabase** — Postgres + auth. Either a hosted Supabase project
   (simplest) or [Supabase's official self-host stack](https://supabase.com/docs/guides/self-hosting/docker)
   on your own server.

## Quickstart (Docker)

```bash
git clone https://github.com/Bytes-Medical/petrios.git
cd bytes-teaching
cp .env.example .env.production   # fill in values (see matrix below)
docker compose up -d --build
curl http://localhost:3000/api/health   # → {"status":"ok","db":"ok"}
```

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
| AI (optional) | OpenAI (`OPENAI_API_KEY`) | **`OPENAI_BASE_URL`** → Azure OpenAI, a gateway, or a locally hosted OpenAI-compatible model; unset the key to disable AI entirely |
| Audio recaps (optional) | OpenAI speech by default, or ElevenLabs when `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` are declared | Pin with `TTS_PROVIDER`; OpenAI-compatible endpoints require `/audio/speech`, while ElevenLabs receives only the draft recap script during explicit audio creation |
| Video (optional) | meet.jit.si | **`NEXT_PUBLIC_JITSI_DOMAIN`** → your own Jitsi server |
| AI agent kill switch | on | `OPS_ENABLED=false` halts every agent surface |
| Chat assistant | **off** | `OPS_ASSISTANT_ENABLED=true` opts a deployment in (needs its own safety review) |
| Public compliance facts | Required for production | `PRIVACY_CONTROLLER_NAME`, `PRIVACY_CONTROLLER_ADDRESS`, `PRIVACY_CONTACT_EMAIL`, `DATA_HOSTING_REGION`, `DATA_TRANSFER_SAFEGUARDS` |

All variables are documented in [`.env.example`](../.env.example).

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
