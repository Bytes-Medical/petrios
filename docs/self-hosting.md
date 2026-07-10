# Self-hosting Byte Teaching

Run the whole platform on your own infrastructure — the recommended path for
NHS trusts and anyone with data-residency requirements. Nothing needs to
leave your network: database, auth, email, video, and even the AI layer can
all be pointed at services you control.

## Architecture

Two moving parts:

1. **The app** — a stateless Next.js server (this repo / the Docker image).
2. **Supabase** — Postgres + auth. Either a hosted Supabase project
   (simplest) or [Supabase's official self-host stack](https://supabase.com/docs/guides/self-hosting/docker)
   on your own server.

## Quickstart (Docker)

```bash
git clone https://github.com/Bytes-Medical/bytes-teaching.git
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
| Video (optional) | meet.jit.si | **`NEXT_PUBLIC_JITSI_DOMAIN`** → your own Jitsi server |
| AI agent kill switch | on | `OPS_ENABLED=false` halts every agent surface |

All variables are documented in [`.env.example`](../.env.example).

## Cron jobs

Schedule with any scheduler (cron, systemd timers, Kubernetes CronJobs) —
each route is idempotent and authenticated with `?secret=$CRON_SECRET`:

| Route | Schedule |
|---|---|
| `/api/cron/session-reminders` | hourly |
| `/api/cron/post-session-reports` | hourly |
| `/api/cron/recall-send` | daily |
| `/api/cron/ops-synthesis` | daily |
| `/api/cron/ops-weekly` | weekly |
| `/api/cron/ops-newsletter` | weekly (Monday) |

Example crontab entry:

```
0 * * * * curl -fsS "https://teaching.your-trust.nhs.uk/api/cron/session-reminders?secret=$CRON_SECRET"
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

## Compliance

For NHS deployments see [`docs/compliance/dtac.md`](./compliance/dtac.md)
(DTAC self-assessment) and
[`docs/compliance/dpia-template.md`](./compliance/dpia-template.md).
