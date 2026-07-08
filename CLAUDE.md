# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Dev server at localhost:3000
npm run build    # Production build (also serves as type-check)
npm run lint     # ESLint via next lint
npm test         # Vitest (pure-logic tests colocated as lib/**/*.test.ts)
```

Database migrations live in `supabase/migrations/` and are applied via `supabase db push` or manually in the Supabase SQL editor.

## Architecture

Next.js 14 App Router application — a teaching management platform for NHS trainees. Multi-tenant with organizations and departments.

### Backend Pattern

All data mutations use **Next.js Server Actions** in `app/actions/`. There is no ORM — actions do auth checks and orchestration, then delegate table access to the data-access layer in `lib/db/` (see `lib/db/README.md`), the only code allowed to import Supabase for data-plane queries:
- `lib/db/client.ts` — `getDb()` (RLS-honoring) vs `getServiceDb()` (service-role, bypasses RLS; functions using it carry a JSDoc justification)
- `lib/supabase/server.ts` / `lib/supabase/client.ts` — underlying clients; direct use outside `lib/db/` is reserved for auth-plane calls (`supabase.auth.*`)

### Auth & Middleware

- Supabase Auth with email/password. Session managed via cookies.
- `middleware.ts` — redirects unauthenticated users to `/login`. Public routes: `/`, `/login`, `/signup`, `/verify/*`, feedback pages, teacher RSVP pages.
- `lib/auth.ts` — helper functions: `getCurrentUser()`, `getCurrentOrgId()`, `requireAuth()`, `requireOrg()`, `isOrgAdmin()`, `isSuperAdmin()`, `isDepartmentModerator()`.

### Role Hierarchy

`super_admin` > `org_admin` > `department_admin` > `faculty` > `trainee`

Super admins are stored in a separate `super_admins` table. Other roles are in `organization_members.role`.

### Evidence-Based Attendance

The attendance system is an append-only evidence aggregation pipeline (documented in `EVIDENCE_ATTENDANCE.md`):
- Evidence sources with priority: `TEACHER` > `TEAMS` > `FEEDBACK` > `GROUP_CODE` > `SELF_CHECKIN`
- `attendance_evidence` table is immutable; `attendance` table is computed from it
- Attendance can be locked to prevent recomputation
- Pure computation (windows, priorities, LATE/ABSENT) lives in `lib/attendance/compute.ts` and is shared by the interactive pipeline (`app/actions/attendance-evidence.ts`) and the post-session cron

### Key Subsystems

- **Certificates**: PDF generation via `@react-pdf/renderer` in `lib/certificates/pdf.tsx`. Server action in `app/actions/certificates.ts`. Public verification at `/verify/[certificateId]`.
- **Email**: Resend REST API (`lib/email.ts`, a `getEmailClient()` adapter over `fetch`). Templates in `lib/email-templates.ts`. Used for teacher invitations, session reminders, and certificates.
- **Feedback**: Anonymous session feedback with QR code distribution. Stats endpoint at `/api/sessions/[id]/feedback/stats`. AI summaries via `summarizeSessionFeedback` in `app/actions/feedback.ts`.
- **AI (Claude)**: `lib/ai/claude.ts` wraps `@anthropic-ai/sdk` (Claude Fable 5 with a server-side fallback to Opus 4.8). Used by feedback summarization (`lib/ai/feedback-summary.ts`). Degrades gracefully when no key is configured.
- **Cron jobs**: `app/api/cron/post-session-reports` (certificates + report emails after sessions end) and `app/api/cron/session-reminders` (reminder emails ~24h before a session). Both are idempotent via watermark columns (`report_sent_at`, `reminder_sent_at`) and authenticated with `?secret=CRON_SECRET`.

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL      # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY # Supabase anon key
SUPABASE_SERVICE_ROLE_KEY     # Supabase service role key (server-only)
NEXT_PUBLIC_APP_URL           # Public app URL used in emailed sign-in/invite links
RESEND_API_KEY                # Resend API key (server-only)
MAIL_FROM                     # Default sender, "Name <email@verified-domain>" (server-only)
CRON_SECRET                   # Shared secret for /api/cron/* routes (server-only)
ANTHROPIC_API_KEY             # Claude API key for AI feedback summaries (server-only, optional)
```

### Database

PostgreSQL via Supabase with Row-Level Security on all tables. Migrations in `supabase/migrations/` (numbered files, applied in order). Core tables: `organizations`, `organization_members`, `departments`, `department_members`, `sessions`, `session_teachers`, `attendance_evidence`, `attendance`, `session_feedback`, `certificates`, `teacher_invitations`.

### Types

All shared TypeScript interfaces are in `lib/types.ts`. User roles defined in `lib/auth.ts` as `UserRole` type.
