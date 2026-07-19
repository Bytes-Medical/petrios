# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Detailed subsystem specs live in `spec/`** (see `spec/README.md` for the index and the non-negotiable invariants). Read the relevant spec before changing a subsystem, and update it in the same change if behaviour shifts. This file stays the compact summary.

## Commands

```bash
npm run dev      # Dev server at localhost:3000
npm run build    # Production build (also serves as type-check)
npm run lint     # ESLint CLI (flat config in eslint.config.mjs)
npm test         # Vitest (pure-logic tests colocated as lib/**/*.test.ts)
s/commits --from origin/main --to HEAD  # Conventional Commit messages
```

Database migrations live in `supabase/migrations/` and are applied via `supabase db push` or manually in the Supabase SQL editor.

## Architecture

Next.js 16 App Router application — a teaching management platform for NHS trainees. Multi-tenant with organizations and departments.

### Backend Pattern

All data mutations use **Next.js Server Actions** in `app/actions/`. There is no ORM — actions do auth checks and orchestration, then delegate table access to the data-access layer in `lib/db/` (see `lib/db/README.md`), the only code allowed to import Supabase for data-plane queries:
- `lib/db/client.ts` — `getDb()` (RLS-honoring) vs `getServiceDb()` (service-role, bypasses RLS; functions using it carry a JSDoc justification)
- `lib/supabase/server.ts` / `lib/supabase/client.ts` — underlying clients; direct use outside `lib/db/` is reserved for auth-plane calls (`supabase.auth.*`)

### Auth & Middleware

- Supabase Auth. Sign-in methods: passwordless magic link (default; rate-limited via `lib/rate-limit.ts` + `login_link_requests`), Microsoft Entra ID SSO (`azure` provider, works with NHSmail), and email/password for admins. Session managed via cookies. See `spec/01-architecture.md` → "Sign-in methods".
- `proxy.ts` (Next 16 proxy convention, formerly middleware) — redirects unauthenticated users to `/login` using LOCAL JWT verification (`auth.getClaims()`, no network call; authorization stays in pages/actions/RLS — see spec/01). Public routes: `/`, `/login`, `/signup`, `/verify/*`, feedback pages, teacher RSVP pages.
- `lib/auth.ts` — helper functions: `getCurrentUser()`, `getCurrentOrgId()`, `requireAuth()`, `requireOrg()`, `isOrgAdmin()`, `isSuperAdmin()`, `isDepartmentModerator()`.
- Latency conventions (spec/07): pages fetch parallel-by-default (staged `Promise.all`), role checks are cached+concurrent, hot routes ship `loading.tsx` skeletons, mutations use `hooks/useActionWithRefresh` (pending spans action + refresh), heavy client libs load via dynamic wrappers (`SessionCalendarLazy`).

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

- **Certificates**: Branded A4-landscape PDF generation via `@react-pdf/renderer` in `lib/certificates/pdf.tsx`. Departments configure up to four ordered teaching coordinators; names are snapshotted onto issued rows so later settings edits do not rewrite history. After an ended session's attendance governance is finalized, an accepted assignment is sufficient for a teaching certificate; attendee certificates still require current finalized `PRESENT`/`LATE` attendance. Registered recipients use `user_id`; accepted external teachers use invitation id + normalized email and receive the PDF by email attachment without an account. Teachers are excluded from duplicate attendee certificates. Server action in `app/actions/certificates.ts`. Public verification at `/verify/[certificateId]`.
- **Email**: Resend REST API (`lib/email.ts`, a `getEmailClient()` adapter over `fetch`). Templates in `lib/email-templates.ts`. Used for teacher invitations, session reminders, and certificates.
- **Feedback**: Public/accountless but identified session feedback with QR code distribution. Name/email are stored, the server enforces the session window, and one response per normalized email/session is allowed. Feedback never creates attendance or certificates. From the first response, moderators can generate an identity-field-omitted, name-stripped, welfare-screened AI teaching draft, edit/review it, and release the exact snapshotted narrative with question-level analytics. Reports based on fewer than five responses carry a prominent limited-evidence warning; only a zero-response report suppresses analytics. Teacher reports use a claimed delivery ledger; ordinary retries skip successful rows, while an explicit moderator resend may reacquire them and records a new audited attempt. The legacy “You said, we did” surface is inactive.
- **Session documents**: PDF/DOCX/PPTX up to 25 MiB in a private storage bucket, managed through `session_documents`. Moderators and accepted teachers upload; authorized session users view/download; moderators delete any document and uploaders delete their own (live object first, then metadata). Office files are basic-validated and downloaded rather than converted. This is not an antivirus/webviewer claim.
- **AI and speech**: `lib/ai/llm.ts` calls Chat Completions for ordinary text inference and the Responses file-input API for Audio Recap generation (no SDK; default model `gpt-5.5`, override with `OPENAI_MODEL`). On an explicit moderator click, Audio Recap sends all currently available private session PDF/DOCX/PPTX sources, requires domain-limited hosted web research, and drafts a detailed ~5-minute recap whose primary evidence remains the documents. It stores source hashes plus clickable public research URL/title citations; document-set changes make the artifact unavailable, while later public-page changes do not automatically stale it. `lib/ai/tts.ts` is the one sanctioned text-to-speech boundary. OpenAI remains the default; declaring `ELEVENLABS_API_KEY` plus `ELEVENLABS_VOICE_ID` selects ElevenLabs unless `TTS_PROVIDER` explicitly pins a provider. Only the draft recap script reaches the speech provider, and generated rows snapshot provider/model/voice. Moderators can recall approved audio to a private draft, preserving the existing preview while they re-synthesize, edit, or regenerate it; publication then requires approval again. A custom LLM base URL must support `/responses` file inputs and `web_search` for document recaps.
- **Petrios Meet (Jitsi video)**: `JITSI` location type whose room is DERIVED from the session id (`lib/jitsi.ts` — no stored URL) and embedded on the session page via `@jitsi/react-sdk` (`components/JitsiMeetingPanel.tsx`, client-only). Joining fires the normal `checkIn` self check-in. `sessionMeetingUrl()` in `lib/jitsi.ts` is the single join-URL resolver for ICS/reminders/teacher emails/RSVP — use it instead of reading `teams_meeting_url` directly. Backend swaps via `NEXT_PUBLIC_JITSI_DOMAIN` (default meet.jit.si).
- **Cron jobs**: `app/api/cron/post-session-reports` (canonical attendee certificates + claimed/retryable delivery after attendance finalization), `app/api/cron/session-reminders` (reminder emails ~24h before a session), `app/api/cron/recall-send` (published catch-up invites to finalized absentees), and `app/api/cron/recall-awards` (retry catch-up certificate/PDF email). They authenticate with `Authorization: Bearer CRON_SECRET`; exact idempotency/failure behavior is subsystem-specific.
- **Evidence Engine (spec/08)**: trainee attendance evidence + reflections + ARCP portfolio packs (`app/actions/portfolio.ts`, `lib/portfolio/*`, `session_reflections` + `portfolio_packs` tables, public verify at `/verify/pack/[code]`) and teacher appraisal dossiers (Teaching tab). Curriculum mapping is retired from the active product; its historical tables remain migration-safe and unread by active flows.
- **Platform layer (spec/09)**: public API `/api/v1` (org-scoped `pt_` bearer tokens, hashed at rest, scoped; thin routes over `lib/db/api-reads.ts`; OpenAPI at `public/openapi.json`), signed webhooks (`lib/webhooks.ts` — fire-and-forget, HMAC `X-Petrios-Signature`, SSRF-guarded; events: session.published, attendance.computed, certificate.issued, slot.claimed), federation (`lib/federation.ts` Ed25519 signed teaching records, `/.well-known/petrios`, `/verify/record`), self-hosting (SMTP transport, `OPENAI_BASE_URL`, Docker + `/api/health` + `scripts/migrate.mjs`; `docs/self-hosting.md`). Federated benchmarking is specified (spec/10, petrios-benchmark/v1) but not implemented.
- **Compliance boundary (spec/13)**: public `/privacy`, `/privacy/choices`, `/subprocessors`, and `/data-processing-agreement`; runtime disclosure config in `lib/compliance.ts`; global security headers in `next.config.js`; contrast-safe small-text tokens. Missing controller/region/transfer facts stay visibly missing and repository evidence/scanner scores are never presented as certification.
- **Petrios Recall (spec/08)**: Recap generation also drafts exactly five spoken-script-bound questions (gateway purpose `recall_questions`). A moderator edits and publishes an immutable revision only after the matching ~5-minute document-led/researched Audio Recap and attendance are approved/finalized. A token deep link requires the exact signed-in registered expected absentee; server-backed playback unlocks up to three attempts and only 5/5 calls the dedicated transaction that appends `RECALL`, changes same-revision ABSENT to transparent catch-up PRESENT, and queues an `AUDIO_RECAP_CATCH_UP` certificate/PDF email. Generic evidence paths cannot write RECALL. The Recall tab retains aggregate-only analytics (cohorts under five suppressed; no individual tool exposure).
- **Address book**: org-scoped `external_contacts` + `contact_groups` (deny-all RLS, service-role DAL `lib/db/external-contacts.ts`, managed in Settings). Contacts auto-captured from external teacher invitations/RSVPs; groups are the audience unit for slot publications.
- **Teaching slots (Calendly-style)**: moderators bulk-create open slots (`/departments/[id]/schedule`), publish them to contact groups and/or registered members, and invitees claim first-come-first-served (atomic CAS in `lib/db/teaching-slots.ts`). Claiming creates a DRAFT session with the claimer attached as teacher; externals claim via the public `/claim/[code]` page, members via the dashboard Teaching tab. Open slots render as "Available" events on `SessionCalendar` (`slots` prop). Bulk creation can split each day into 10–20-min lightning micro-slots (`splitSlotDraft`/`isLightningSlot` in `lib/slot-schedule.ts`).
- **Petrios Ops (AI agent layer)**: additive agent layer under `lib/ops/` + `/ops` routes + `ops_*` tables (migration 036 onward, all deny-all RLS, accessed only via `lib/db/ops.ts`; read-only core-table queries live in `lib/db/ops-reads.ts`). Hard invariants: (1) NO outbound email without an approved `ops_pending_actions` row — `lib/ops/executors.ts` is the only Ops send path; (2) all LLM calls go through `lib/ops/gateway.ts` (`opsInference`, purpose allow-list, audit steps store prompt HASHES + token counts, never text) — the one exception is the assistant tool loop in `lib/ops/agent-loop.ts`; never call the OpenAI API anywhere else besides `lib/ai/llm.ts`; (3) `OPS_ENABLED=false` kills every Ops surface; (4) feedback synthesis (`lib/ops/synthesis.ts`) strips names and routes welfare-signal content to humans (`requires_human_review`), and the layer never evaluates trainee performance. Crons: `ops-weekly` (speaker chases → approval queue and low-score alerts), `ops-synthesis` (feedback syntheses + thank-you drafts). Newsletters are moderator-triggered, department-scoped, document-led, editable one-page drafts; explicit approval sends the reviewed revision through a per-recipient delivery ledger. Organiser-only chat assistant at `/ops/assistant` (tools in `lib/ops/tools.ts`, org scope always from the authenticated caller) — **disabled by default**: every chat action refuses and the page 404s unless `OPS_ASSISTANT_ENABLED=true` (deployment safety decision). Approvals surface: `ApprovalsBell` in the nav + `/ops` queue. Public unsubscribe at `/ops/unsubscribe/[token]` (HMAC token, `lib/ops/newsletter.ts`).

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL      # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY # Supabase anon key
SUPABASE_SERVICE_ROLE_KEY     # Supabase service role key (server-only)
ATTENDANCE_RATE_LIMIT_SECRET  # Optional HMAC key for pseudonymized group-code IP throttling; service key is server fallback
NEXT_PUBLIC_APP_URL           # Public app URL used in emailed sign-in/invite links
RESEND_API_KEY                # Resend API key (server-only; OR use SMTP_HOST/PORT/USER/PASS/SECURE for self-hosted SMTP)
MAIL_FROM                     # Default sender, "Name <email@verified-domain>" (server-only)
CRON_SECRET                   # Shared secret for /api/cron/* routes (server-only)
OPENAI_API_KEY                # OpenAI API key for AI feedback summaries + Petrios Ops (server-only, optional)
OPENAI_MODEL                  # Optional model override (default gpt-5.5)
OPENAI_BASE_URL               # Optional OpenAI-compatible endpoint (Azure/local models; default api.openai.com/v1)
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
```

### Database

PostgreSQL via Supabase with Row-Level Security on all tables. Migrations in `supabase/migrations/` (numbered files, applied in order). Core tables include `organizations`, memberships/departments, `sessions`, teacher assignments/invitations, attendance evidence/results/rosters/activity, identified feedback/report deliveries, certificates, and private session-document metadata.

### Types

All shared TypeScript interfaces are in `lib/types.ts`. User roles defined in `lib/auth.ts` as `UserRole` type.
