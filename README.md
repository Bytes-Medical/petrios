# Byte Teaching

A teaching management platform for NHS training programmes — scheduling,
attendance, feedback, certificates, built-in video, and an AI operations
layer, with an ultra-simple UI. Multi-tenant across organizations and
departments; trainees need accounts, external teachers don't.

## Features

- **Multi-tenancy & roles**: organizations → departments, with
  `org_admin` > `department_admin` (moderator) > `faculty` > `trainee`
  (plus platform-level super admins). Trainees join with a 6-digit
  department code.
- **Session management**: create, edit, publish, and cancel teaching
  sessions (30 min–4 h, typed: STEPP / Clinical Skills / Simulation /
  Academic), with an org-wide calendar and a subscribable ICS feed.
- **Byte Meet video**: sessions can use a built-in Jitsi video room —
  auto-generated per session (nothing to paste), embedded on the session
  page, joinable by external guests via a plain link. Joining the embedded
  room records attendance automatically. Microsoft Teams links are equally
  supported for orgs that live in Teams.
- **Evidence-based attendance**: an append-only evidence pipeline
  (teacher marking > Teams > feedback > group code > self check-in) computes
  PRESENT/LATE/ABSENT with configurable windows, locking, CSV export, and a
  full audit trail. See [spec/03-attendance.md](./spec/03-attendance.md).
- **Anonymous feedback**: per-session QR-code feedback with customizable
  department forms, live stats, and optional AI summaries.
- **Teacher invitations & RSVP**: invite registered members (accept/decline
  from the dashboard) or external teachers by email (public RSVP link, no
  account needed), with automatic 24h reminders.
- **Teaching slots (Calendly-style)**: moderators publish open, claimable
  teaching slots to contact groups and/or all members; first come, first
  served — a claim creates a draft session with the claimer attached.
- **Address book**: org-scoped external contacts and contact groups,
  auto-captured from invitations and used as publishing audiences.
- **Certificates**: PDF generation for teachers and attendees with a public
  verification page (`/verify/[code]`).
- **In-app notifications**: bell with read tracking for invitations,
  responses, claims, and ops alerts.
- **Bytes Ops (AI agent layer)**: drafts speaker-chase emails, post-session
  thank-yous with feedback insights, and a weekly learning-points
  newsletter; watches curriculum coverage (RCPCH Progress+ domains) and low
  feedback scores; includes an organiser-only chat assistant that knows the
  platform. **Nothing sends without human approval** — every outbound email
  waits in an approval queue, all LLM calls go through one audited gateway
  (prompt hashes, never text), anonymisation and welfare-signal safety rails
  are built in, and `OPS_ENABLED=false` kills the whole layer.

## Tech stack

- Next.js 16 (App Router) + TypeScript + React 19, server actions for all mutations
- Supabase (Postgres + Row Level Security) and Supabase Auth
- Tailwind CSS with cva-based UI primitives (neo-brutalist design system)
- OpenAI Chat Completions (via `fetch`, no SDK) for the AI features —
  optional, degrades gracefully
- Jitsi Meet (`@jitsi/react-sdk`) for built-in video rooms
- Resend REST API for transactional email (console log-sink in dev)
- `@react-pdf/renderer` for certificates, Schedule-X for the calendar,
  Vitest for tests

## Setup

### Prerequisites

- Node.js 20.9+ and npm
- A Supabase project

### Installation

```bash
npm install
cp .env.example .env.local   # then fill in the values
```

All environment variables are documented in [`.env.example`](./.env.example).
The minimum for local development is the three Supabase values — email logs
to the console without a Resend key, and AI/video features are optional.

### Supabase setup

1. Create a project at https://supabase.com and enable Email authentication
   (Authentication → Providers).
2. In Authentication → URL Configuration, set the Site URL to
   `NEXT_PUBLIC_APP_URL` and add `<your-app-url>/join/callback` to Redirect
   URLs.
3. Apply the migrations in `supabase/migrations/` **in numeric order**
   (`000_…` through the latest):

```bash
supabase db push
# or paste each file into the Supabase SQL editor, in order
```

### Run

```bash
npm run dev    # http://localhost:3000
npm test       # Vitest (pure-logic tests, lib/**/*.test.ts)
npm run lint
npm run build
```

### Cron jobs (production)

Five idempotent routes under `/api/cron/`, each authenticated with
`?secret=CRON_SECRET` — schedule them with Vercel Cron or any scheduler:

| Route | Suggested schedule | What it does |
|---|---|---|
| `session-reminders` | hourly | Reminder emails ~24h before sessions |
| `post-session-reports` | hourly | Certificates + report emails after sessions |
| `ops-synthesis` | daily | AI feedback syntheses + thank-you drafts (approval-gated) |
| `ops-weekly` | weekly | Speaker-chase drafts, low-score alerts, curriculum gap watch |
| `ops-newsletter` | weekly (Mon) | Weekly learning-points newsletter draft (approval-gated) |

## Architecture notes

- **Server actions** in `app/actions/` do auth checks and orchestration, then
  delegate all table access to the data-access layer in `lib/db/` — the only
  code allowed to run data-plane Supabase queries (`lib/db/README.md`).
- Several tables are **deny-all RLS** by design (notifications, address book,
  teaching slots, all `ops_*` tables): they are reachable only through the
  service-role DAL, with authorization enforced in the calling actions.
- The **Bytes Ops** layer is strictly additive (`lib/ops/`, `/ops` routes,
  `ops_*` tables) with hard invariants documented in [CLAUDE.md](./CLAUDE.md):
  one inference gateway, one email send path, approval gate on everything
  outbound.
- Detailed subsystem specifications live in [`spec/`](./spec/README.md) —
  written for both contributors and AI coding assistants; `CLAUDE.md` is the
  compact entry point.

## Usage (first run)

1. Sign up, then create an organization via the Admin panel.
2. Create departments; share each department's 6-digit code with trainees.
3. Create and publish sessions (pick Byte Meet video, Teams, in person, or
   hybrid) — or publish open teaching slots and let teachers claim them.
4. During a session: attendees check in via QR/feedback/video join; after it,
   generate certificates and read the AI feedback summary.
5. Organisers: watch the approvals bell — Bytes Ops drafts, you decide.

## License

Copyright (C) 2026 Akanimoh Osutuk.

Byte Teaching is licensed under the **GNU Affero General Public License
v3.0 or later (AGPL-3.0-or-later)**. See [`LICENSE`](./LICENSE) for the
full license text and [`NOTICE`](./NOTICE) for attribution requirements.

**What this means in practice:**

- You are free to use, read, modify, self-host, and distribute this
  software, including for internal commercial use inside your
  organisation.
- If you modify it and either redistribute it **or run the modified
  version as a network service** (e.g. a SaaS offering), AGPL section 13
  requires you to make the complete corresponding source code available
  to users of that service under the same license.
- You must preserve copyright notices and the `NOTICE` file, and
  reasonably attribute the original project and author in any
  distribution or user-facing "about" surface.

### Commercial licensing

The AGPL terms may be incompatible with closed-source embedding,
proprietary derivative products, or operating a managed service without
sharing modifications. The copyright holder retains full rights to the
original work and can offer separate **commercial licenses** for these
use cases.

For commercial licensing inquiries, contact the copyright holder
(Akanimoh Osutuk).

### Contributing & security

Contributions are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md)
(DCO applies). Please report vulnerabilities privately as described in
[`SECURITY.md`](./SECURITY.md).
