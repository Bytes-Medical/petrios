# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Detailed subsystem specs live in `spec/`** (see `spec/README.md` for the index and the non-negotiable invariants). Read the relevant spec before changing a subsystem, and update it in the same change if behaviour shifts. This file stays the compact summary.

## Commands

```bash
npm run dev      # Dev server at localhost:3000
npm run build    # Production build (also serves as type-check)
npm run lint     # ESLint CLI (flat config in eslint.config.mjs)
npm test         # Vitest (pure-logic tests colocated as lib/**/*.test.ts, plus cfw/ and scripts/cloudflare/)
s/commits --from origin/main --to HEAD  # Conventional Commit messages
npm run cf:build           # Cloudflare Workers build: OpenNext + yoga wasm/fonts modules + .env scrub + secret guard
npm run cf:preview         # Serve the built Worker at localhost:8787 using only .dev.vars
npm run cf:deploy:staging  # APP_URL=https://petrios-staging.<sub>.workers.dev; top-level staging Worker only
```

Database migrations live in `supabase/migrations/` and are applied via `supabase db push` or manually in the Supabase SQL editor.

## Architecture

Next.js 16 App Router application — a teaching management platform for NHS trainees. Multi-tenant with organizations and departments.

### Backend Pattern

All data mutations use **Next.js Server Actions** in `app/actions/`. There is no ORM — actions do auth checks and orchestration, then delegate table access to the data-access layer in `lib/db/` (see `lib/db/README.md`), the only code allowed to import Supabase for data-plane queries:
- `lib/db/client.ts` — `getDb()` (RLS-honoring) vs `getServiceDb()` (service-role, bypasses RLS; functions using it carry a JSDoc justification)
- `lib/supabase/server.ts` / `lib/supabase/client.ts` — underlying clients; direct use outside `lib/db/` is reserved for auth-plane calls (`supabase.auth.*`)

Public/visitor-facing actions (`submitFeedback`, `respondToInvitation`, `claimSlotByCode`, and `claimSlotAsMember`, which shares its claim path) return expected failures as `{ ok: false, message }` and throw only for unexpected errors, because Next masks thrown Server Action errors in production (spec/07).

### Auth & Middleware

- Supabase Auth. Sign-in methods: passwordless magic link (default; rate-limited via `lib/rate-limit.ts` + `login_link_requests`), Microsoft Entra ID SSO (`azure` provider, works with NHSmail), and email/password for admins. Session managed via cookies. See `spec/01-architecture.md` → "Sign-in methods".
- `proxy.ts` (Next 16 proxy convention, formerly middleware) — redirects unauthenticated users to `/login` using LOCAL JWT verification (`auth.getClaims()`, no network call; authorization stays in pages/actions/RLS — see spec/01). Public routes: `/`, `/login`, `/signup`, `/verify/*`, feedback pages, teacher RSVP pages.
- `lib/auth.ts` — helper functions: `getCurrentUser()`, `getCurrentOrgId()`, `requireAuth()`, `requireOrg()`, `isOrgAdmin()`, `isSuperAdmin()`, `isDepartmentModerator()`.
- Latency conventions (spec/07): pages fetch parallel-by-default (staged `Promise.all`), role checks are cached+concurrent, hot routes ship `loading.tsx` skeletons, mutations use `hooks/useActionWithRefresh` (pending spans action + refresh), heavy client libs load via dynamic wrappers (`SessionCalendarLazy`).

### Deployment (dual runtime)

Production runs on Render (Docker, Node, `output: 'standalone'`). A Cloudflare Workers **staging** build uses `@opennextjs/cloudflare` + `wrangler.jsonc` (spec/09, `docs/cloudflare-workers.md`); `.dockerignore` keeps every Cloudflare file out of the image. Every change must work on both runtimes (spec/07):
- `cfw/worker.ts` is the custom entry: its first import `cfw/yoga-install.ts` answers react-pdf's runtime yoga `WebAssembly.instantiate` with the module precompiled at upload (`cfw/yoga-redirect.ts`, regenerated each build); `public/fonts/*.ttf` ship as Data modules so `node:fs` font reads work at `/bundle/public/fonts`; `scheduled()` maps Cron Triggers to `/api/cron/*` (`cfw/cron.ts`) and dispatches only when `CRON_ENABLED` is exactly `"true"`.
- The top-level (staging) Worker has no cron triggers, no routes, `CRON_ENABLED="false"` and `OUTBOUND_EMAIL_ENABLED="false"` (it serves the production database, so `lib/email.ts` refuses every send except to `OUTBOUND_EMAIL_ALLOWLIST` addresses); only `env.production` has triggers, and no script deploys it. Only one scheduler may run the crons against a database. `cf:deploy:staging` refuses a `--secrets-file` that names a `vars` key (wrangler would let it silently replace the var), a never-set name or an `APP_URL` fallback.
- `cf:build` overwrites OpenNext's compiled `.env` snapshot (`next-env.mjs`), patches OpenNext 4.1.9's bundled `cloudflare-node` response writer so streamed responses keep backpressure (fails if the code no longer matches; revisit on every OpenNext upgrade), and its guard fails if any local `.env*` secret value appears in the dry-run upload or static assets, or if the backpressure marker is missing. On Workers set `APP_URL`/`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`JITSI_DOMAIN` (runtime-read) and never the `*_INTERNAL_URL` variables.
- Server clocks are UTC (Workers ignore `TZ`): server code formats dates via `lib/datetime.ts` (`formatInAppTimeZone`/`formatAppDate`/`formatAppDateTime`/`appDayKey`/`appWallClockToIso`) in `APP_TIME_ZONE`, never `toLocale*String` without a `timeZone`; client components rendered during SSR show timestamps through `components/LocalSessionDateTime.tsx`, except panels that must match server text (slot descriptions, Ops action times), which take the server's `appTimeZone()` as a `timeZone` prop because `APP_TIME_ZONE` is server-only.
- No floating promises on server paths: request paths wrap follow-up work in `after()` from `next/server` (waitUntil on Workers); crons await. Don't buffer whole documents/audio/PDFs where a stream works (128 MB isolate).

### Role Hierarchy

`super_admin` > `org_admin` > `department_admin` > `faculty` > `trainee`

Super admins are stored in a separate `super_admins` table. Other roles are in `organization_members.role`.

A user may be `department_admin` for multiple departments in one organization,
but never across organizations. Migration 044 enforces this in Postgres: a grant
in a new organization demotes prior cross-organization moderator roles to
`faculty` while preserving ordinary membership.

### Evidence-Based Attendance

The attendance system is an append-only evidence aggregation pipeline (documented in `spec/03-attendance.md`):
- New sessions use policy v2 and source priority `MODERATOR_CONFIRMATION` > `TEACHER` > `TEAMS` > `GROUP_CODE` > `SELF_CHECKIN` > `RECALL`; feedback is excluded. `RECALL` is created only by the guarded Audio Recap mastery RPC and means transparent catch-up recognition, never physical presence
- `attendance_evidence` is append-only; policy-v2 insertion and recomputation are one transactional RPC
- Moderators finalize a complete roster into a numbered revision; reopening requires a reason and revokes canonical certificates
- Group codes are cryptographically random, stored as salted scrypt verifiers, rate-limited, and returned in clear only at generation
- Pure computation lives in `lib/attendance/compute.ts`; the database RPC mirrors it. The post-session cron consumes finalized results and never infers attendance

### Key Subsystems

- **Certificates**: Branded A4-landscape PDF generation via `@react-pdf/renderer` in `lib/certificates/pdf.tsx`. Departments configure up to four ordered teaching coordinators; names are snapshotted onto issued rows so later settings edits do not rewrite history. After an ended session's attendance governance is finalized, an accepted assignment is sufficient for a teaching certificate; attendee certificates still require current finalized `PRESENT`/`LATE` attendance. Registered recipients use `user_id`; accepted external teachers use invitation id + normalized email and receive the PDF by email attachment without an account. Teachers are excluded from duplicate attendee certificates. The moderator batch only inserts rows for registered recipients (their PDF renders on download); external teachers are its only batch-time render. Server action in `app/actions/certificates.ts`. Public verification at `/verify/[certificateId]`.
- **Email**: Resend REST API (`lib/email.ts`, a `getEmailClient()` adapter over `fetch`). Templates in `lib/email-templates.ts`. Used for teacher invitations, session reminders, and certificates.
- **Feedback**: Public/accountless but identified session feedback with QR code distribution. Name/email are stored, the server enforces the session window (one shared rule in `lib/feedback-window.ts`, also used by the public pages to show an open/closed notice), and one response per normalized email/session is allowed. Feedback never creates attendance or certificates. From the first response, moderators can generate an identity-field-omitted, name-stripped, welfare-screened AI teaching draft, edit/review it, and release the exact snapshotted narrative with question-level analytics. Reports based on fewer than five responses carry a prominent limited-evidence warning; only a zero-response report suppresses analytics. Teacher reports use a claimed delivery ledger; ordinary retries skip successful rows, while an explicit moderator resend may reacquire them and records a new audited attempt. The legacy “You said, we did” surface is inactive.
- **Session documents**: PDF/DOCX/PPTX up to 25 MiB in a private storage bucket, managed through `session_documents`. Moderators and accepted teachers upload; authorized session users view/download; moderators delete any document and uploaders delete their own (live object first, then metadata). Uploads go browser→Storage through a one-shot signed upload URL (`prepareSessionDocumentUpload` → PUT → `finalizeSessionDocumentUpload`, or `cancelSessionDocumentUpload` on a failed PUT); finalize stream-validates the stored object with bounded memory (size, SHA-256, magic bytes, marker scan, ZIP central directory) in `lib/session-documents-inspection.ts`. Downloads stream; no large Server Action body limit exists. Office files are basic-validated and downloaded rather than converted. This is not an antivirus/webviewer claim.
- **AI and speech**: `lib/ai/llm.ts` is the inference boundary; `lib/ai/provider.ts` resolves the provider and builds the Anthropic client (no calls); `lib/ai/anthropic-files.ts` handles Files API upload/delete/sweep (no inference). Provider: `LLM_PROVIDER` pin, else `ANTHROPIC_API_KEY` → **Anthropic Claude (default)** via the official `@anthropic-ai/sdk` (default model `claude-opus-5-5`, override `ANTHROPIC_MODEL`), else `OPENAI_API_KEY` → the optional OpenAI-compatible adapter (Chat Completions + Responses file inputs over `fetch`, `OPENAI_MODEL` default `gpt-5.5`, `OPENAI_BASE_URL`); both keys plus `OPENAI_BASE_URL` without a pin is a configuration error (AI off) so in-network traffic never silently moves. Anthropic calls always stream on the beta Messages endpoint with server-side refusal fallbacks (`fallbacks: 'default'`, `ANTHROPIC_FALLBACKS=off` to disable), never send `thinking`/sampling/prefill/forced `tool_choice`, and set `output_config.effort` explicitly per purpose. On an explicit moderator click, Audio Recap sends all currently available private session PDF/DOCX/PPTX sources (Anthropic: uploaded one at a time to the Files API — PDFs as bytes, DOCX/PPTX as bounded extracted text (`lib/ai/office-text.ts`) — with an opaque `petrios-ai-` name, 1-hour expiry, deletion in `finally`, and a daily orphan sweep in `ops-synthesis`), requires domain-limited hosted web research (`web_search_20260209`, direct, allow-listed; not forceable, so a post-check requires a completed search and an allow-listed source), and drafts a detailed ~5-minute recap (on Anthropic, the text after the last search result) whose primary evidence remains the documents. It stores source hashes plus clickable public research URL/title citations; document-set changes make the artifact unavailable, while later public-page changes do not automatically stale it. `lib/ai/tts.ts` is the one sanctioned text-to-speech boundary. Unless `TTS_PROVIDER` pins a provider, declaring either `ELEVENLABS_API_KEY` or `ELEVENLABS_VOICE_ID` selects ElevenLabs (both are required; one alone is an incomplete-configuration error with no OpenAI fallback), otherwise `OPENAI_API_KEY` selects OpenAI speech. With none of these, speech is unconfigured — an Anthropic + ElevenLabs deployment needs no OpenAI key. Only the draft recap script reaches the speech provider, and generated rows snapshot provider/model/voice. Moderators can recall approved audio to a private draft, preserving the existing preview while they re-synthesize, edit, or regenerate it; publication then requires approval again. Playback streams the `audio` column from PostgREST hex JSON (`lib/audio-hex-stream.ts`), pinned to the authorized `audio_revision`. Document inputs (Audio Recap, newsletter) are streamed from storage one at a time and verified against stored size/SHA-256 while streaming (`lib/ai/streaming-body.ts`): on Anthropic into one Files API upload per document, on the OpenAI-compatible adapter into a chunked Responses request — so a custom `OPENAI_BASE_URL` must accept chunked `/responses` file-input bodies without redirects and support `web_search` for document recaps, and a custom `ANTHROPIC_BASE_URL` must pass `anthropic-beta`, the Files API (chunked multipart `POST /v1/files` without redirects) and web search.
- **Petrios Meet (Jitsi video)**: `JITSI` location type whose room is DERIVED from the session id (`lib/jitsi.ts` — no stored URL) and embedded on the session page via `@jitsi/react-sdk` (`components/JitsiMeetingPanel.tsx`, client-only). Joining fires the normal `checkIn` self check-in. `sessionMeetingUrl()` in `lib/jitsi.ts` is the single join-URL resolver for ICS/reminders/teacher emails/RSVP — use it instead of reading `teams_meeting_url` directly. Backend swaps via `NEXT_PUBLIC_JITSI_DOMAIN` (default meet.jit.si).
- **Cron jobs**: `app/api/cron/post-session-reports` (canonical attendee certificates + claimed/retryable delivery after attendance finalization), `app/api/cron/session-reminders` (reminder emails ~24h before a session), `app/api/cron/recall-send` (published catch-up invites to finalized absentees), and `app/api/cron/recall-awards` (retry catch-up certificate/PDF email). They authenticate with `Authorization: Bearer CRON_SECRET`; exact idempotency/failure behavior is subsystem-specific. Long jobs take a per-run work budget (`lib/run-budget.ts`, ~8,000 estimated subrequests / 10 min; `post-session-reports` gives each session a capped slice so one session cannot starve the batch, and confirms a capped bulk-ledger miss with an exact lookup) and leave unreached recipients in a per-recipient `session_deliveries` ledger with the watermark open (reminders use `delivery_type = 'SESSION_REMINDER'`, related_id = session id); `recall-awards` takes 10 completions per run, two at a time (`lib/concurrency.ts`).
- **Evidence Engine (spec/08)**: trainee attendance evidence + reflections + ARCP portfolio packs (`app/actions/portfolio.ts`, `lib/portfolio/*`, `session_reflections` + `portfolio_packs` tables, public verify at `/verify/pack/[code]`) and teacher appraisal dossiers (Teaching tab). Curriculum mapping is retired from the active product; its historical tables remain migration-safe and unread by active flows.
- **Platform layer (spec/09)**: public API `/api/v1` (org-scoped `pt_` bearer tokens, hashed at rest, scoped; thin routes over `lib/db/api-reads.ts`; OpenAPI at `public/openapi.json`), signed webhooks (`lib/webhooks.ts` — one attempt, never rejects; request paths register it with `after()`, crons await it; HMAC `X-Petrios-Signature`, SSRF-guarded; events: session.published, attendance.computed, certificate.issued, slot.claimed), federation (`lib/federation.ts` Ed25519 signed teaching records, `/.well-known/petrios`, `/verify/record`), self-hosting (SMTP transport, LLM provider choice incl. `OPENAI_BASE_URL` for in-network OpenAI-compatible models, Docker + `/api/health` + `scripts/migrate.mjs`; `docs/self-hosting.md`). Federated benchmarking is specified (spec/10, petrios-benchmark/v1) but not implemented.
- **Public site (spec/07, spec/13)**: `components/hud/` Clinical HUD tokens and components scoped by `HudShell` (`data-hud-root`, one CSS module `hud.module.css`, `:where()` element rules); every public marketing/legal page renders inside it, and the signed-in app never imports it (`Button`, `Wordmark`, `Nav`, `globals.css` stay untouched). Day is the default; Night / Match device are stored in the first-party `petrios-display` cookie, read on the server (`lib/public-display.ts`) and disclosed on /privacy. The landing h1 is the CSS-only calibration strip (`CalibrationStrip` + chunked clip-path `Typewriter`, no canvas or script). Readouts and spec strips carry a never-rendered `source` and quote verified facts only.
- **Compliance boundary (spec/13)**: public `/privacy`, `/privacy/choices`, `/subprocessors`, and `/data-processing-agreement`; runtime disclosure config in `lib/compliance.ts`; security headers applied by `proxy.ts` via `lib/security-headers.ts` (static assets excluded); contrast-safe small-text tokens. Missing controller/region/transfer facts stay visibly missing and repository evidence/scanner scores are never presented as certification.
- **Petrios Recall (spec/08)**: Recap generation also drafts exactly five spoken-script-bound questions (gateway purpose `recall_questions`). A moderator edits and publishes an immutable revision only after the matching ~5-minute document-led/researched Audio Recap and attendance are approved/finalized. A token deep link requires the exact signed-in registered expected absentee; server-backed playback unlocks up to three attempts and only 5/5 calls the dedicated transaction that appends `RECALL`, changes same-revision ABSENT to transparent catch-up PRESENT, and queues an `AUDIO_RECAP_CATCH_UP` certificate/PDF email. Generic evidence paths cannot write RECALL. The Recall tab retains aggregate-only analytics (cohorts under five suppressed; no individual tool exposure).
- **Address book**: org-scoped `external_contacts` + `contact_groups` (deny-all RLS, service-role DAL `lib/db/external-contacts.ts`, managed in Settings). Contacts auto-captured from external teacher invitations/RSVPs; groups are the audience unit for slot publications.
- **Teaching slots (Calendly-style)**: moderators bulk-create open slots (`/departments/[id]/schedule`), publish them to contact groups and/or registered members, and invitees claim first-come-first-served (atomic CAS in `lib/db/teaching-slots.ts`). Claiming creates a DRAFT session with the claimer attached as teacher; externals claim via the public `/claim/[code]` page, members via the dashboard Teaching tab. Open slots render as "Available" events on `SessionCalendar` (`slots` prop). Bulk creation can split each day into 10–20-min lightning micro-slots (`splitSlotDraft`/`isLightningSlot` in `lib/slot-schedule.ts`). Chosen slot days/times are wall-clock times in `APP_TIME_ZONE`, converted to UTC on the server (`appWallClockToIso`).
- **Petrios Ops (AI agent layer)**: additive agent layer under `lib/ops/` + `/ops` routes + `ops_*` tables (migration 036 onward, all deny-all RLS, accessed only via `lib/db/ops.ts`; read-only core-table queries live in `lib/db/ops-reads.ts`). Hard invariants: (1) NO outbound email without an approved `ops_pending_actions` row — `lib/ops/executors.ts` is the only Ops send path; (2) all LLM calls go through `lib/ops/gateway.ts` (`opsInference`, purpose allow-list, audit steps store prompt HASHES + token counts, never text) — the one exception is the assistant tool loop in `lib/ops/agent-loop.ts`; never call an LLM provider API anywhere else besides `lib/ai/llm.ts` (`lib/ai/provider.ts` only builds the client; `lib/ai/anthropic-files.ts` only uploads/deletes files); (3) `OPS_ENABLED=false` kills every Ops surface; (4) feedback synthesis (`lib/ops/synthesis.ts`) strips names and routes welfare-signal content to humans (`requires_human_review`), and the layer never evaluates trainee performance. Crons: `ops-weekly` (speaker chases → approval queue and low-score alerts), `ops-synthesis` (feedback syntheses + thank-you drafts; with Anthropic, every run also sweeps orphaned Files API uploads). Newsletters are moderator-triggered, department-scoped, document-led, editable one-page drafts; explicit approval sends the reviewed revision through a per-recipient delivery ledger. Organiser-only chat assistant at `/ops/assistant` (tools in `lib/ops/tools.ts`, org scope always from the authenticated caller) — **disabled by default**: every chat action refuses and the page 404s unless `OPS_ASSISTANT_ENABLED=true` (deployment safety decision). Approvals surface: `ApprovalsBell` in the nav + `/ops` queue. Public unsubscribe at `/ops/unsubscribe/[token]` (HMAC token, `lib/ops/newsletter.ts`).

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL      # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY # Supabase anon key
SUPABASE_SERVICE_ROLE_KEY     # Supabase service role key (server-only)
ATTENDANCE_RATE_LIMIT_SECRET  # Optional HMAC key for pseudonymized group-code IP throttling; service key is server fallback
NEXT_PUBLIC_APP_URL           # Public app URL used in emailed sign-in/invite links
APP_TIME_ZONE                 # Optional IANA zone for server-rendered dates and teaching-slot wall times (default Europe/London; invalid values fall back with a logged error)
RESEND_API_KEY                # Resend API key (server-only; OR use SMTP_HOST/PORT/USER/PASS/SECURE for self-hosted SMTP)
MAIL_FROM                     # Default sender, "Name <email@verified-domain>" (server-only)
CRON_SECRET                   # Shared secret for /api/cron/* routes (server-only)
CRON_ENABLED                  # Workers (wrangler.jsonc): scheduled() dispatches only when "true"; exactly "false" also makes /api/cron/* answer 503 (unset on Render)
TRUSTED_CLIENT_IP_HEADER      # Optional client-IP header for rate limits ("cf-connecting-ip" on Workers); unset = first x-forwarded-for hop, then x-real-ip
OUTBOUND_EMAIL_ENABLED        # Exactly "false" makes lib/email.ts refuse every send (set on the Workers staging Worker; unset = email on)
OUTBOUND_EMAIL_ALLOWLIST      # Comma-separated addresses still served while OUTBOUND_EMAIL_ENABLED=false (staging test inboxes)
LLM_PROVIDER                  # Optional pin: anthropic | openai (other values disable AI). Needed when both keys AND OPENAI_BASE_URL are set
ANTHROPIC_API_KEY             # Anthropic API key — the default LLM provider (server-only, optional); use a dedicated workspace
ANTHROPIC_MODEL               # Optional model override (default claude-opus-5-5)
ANTHROPIC_BASE_URL            # Optional Anthropic-compatible gateway (must pass anthropic-beta, Files API uploads without redirects, web search)
ANTHROPIC_FALLBACKS           # "off" disables server-side refusal fallbacks (for gateways that reject the beta); default on
OPENAI_API_KEY                # Optional OpenAI-compatible adapter (used when it is the only LLM key or LLM_PROVIDER=openai) and OpenAI speech
OPENAI_MODEL                  # Optional OpenAI model override (default gpt-5.5)
OPENAI_BASE_URL               # Optional OpenAI-compatible endpoint (Azure/local models; default api.openai.com/v1); also used by OpenAI speech
OPENAI_TTS_MODEL              # Optional TTS model for audio recaps (default gpt-4o-mini-tts)
OPENAI_TTS_VOICE              # Optional TTS voice for audio recaps (default alloy)
TTS_PROVIDER                  # Optional speech-provider pin: openai | elevenlabs
ELEVENLABS_API_KEY            # Optional ElevenLabs speech key (server-only)
ELEVENLABS_VOICE_ID           # Required with ElevenLabs speech
ELEVENLABS_MODEL_ID           # Optional ElevenLabs model (default eleven_multilingual_v2)
DATABASE_URL                  # Optional: plain-Postgres migration runner (npm run db:migrate)
INSTANCE_SIGNING_KEY          # Optional: Ed25519 identity enabling signed teaching-record exports (federation)
NEXT_PUBLIC_JITSI_DOMAIN      # Jitsi domain for Petrios Meet rooms (optional, default meet.jit.si)
OPS_ENABLED                   # Petrios Ops kill switch: unset/anything = on, "false" = every ops surface halts
OPS_ASSISTANT_ENABLED         # Ops chat assistant opt-in: unset = OFF (default), "true" = enabled (still subject to OPS_ENABLED)
GOOGLE_SITE_VERIFICATION      # Optional Search Console HTML-tag token (renders the site-wide meta tag)
PRIVACY_CONTROLLER_NAME      # Public legal controller name (required production disclosure)
PRIVACY_CONTROLLER_ADDRESS   # Public controller address (required production disclosure)
PRIVACY_CONTACT_EMAIL        # Public monitored privacy/DPO inbox
DATA_HOSTING_REGION          # Public application/database/backup region summary
DATA_TRANSFER_SAFEGUARDS     # Public reviewed transfer-mechanism summary
HOSTING_PROVIDER             # "cloudflare-workers" (set in wrangler.jsonc vars) names Cloudflare Workers as host on /privacy and /subprocessors
```

### Database

PostgreSQL via Supabase with Row-Level Security on all tables. Migrations in `supabase/migrations/` (numbered files, applied in order). Core tables include `organizations`, memberships/departments, `sessions`, teacher assignments/invitations, attendance evidence/results/rosters/activity, identified feedback/report deliveries, certificates, and private session-document metadata.

### Types

All shared TypeScript interfaces are in `lib/types.ts`. User roles defined in `lib/auth.ts` as `UserRole` type.
