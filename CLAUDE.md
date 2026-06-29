# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Dev server at localhost:3000
npm run build    # Production build (also serves as type-check)
npm run lint     # ESLint via next lint
```

No test framework is configured. There is no `npm test` command.

Database migrations live in `supabase/migrations/` and are applied via `supabase db push` or manually in the Supabase SQL editor.

## Architecture

Next.js 14 App Router application — a teaching management platform for NHS trainees. Multi-tenant with organizations and departments.

### Backend Pattern

All data mutations use **Next.js Server Actions** in `app/actions/`. There is no ORM — database access is direct via Supabase client:
- `lib/supabase/server.ts` — server-side client (used in server actions, API routes, server components)
- `lib/supabase/client.ts` — browser client (used in client components)
- Service role client (`createSupabaseServiceClient`) for privileged operations that bypass RLS

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
- Business logic concentrated in `app/actions/attendance-evidence.ts`

### Key Subsystems

- **Certificates**: PDF generation via `@react-pdf/renderer` in `lib/certificates/pdf.tsx`. Server action in `app/actions/certificates.ts`. Public verification at `/verify/[certificateId]`.
- **Email**: MailerSend REST API (`lib/email.ts`, a Resend-shaped `getEmailClient()` adapter over `fetch`). Templates in `lib/email-templates.ts`. Used for teacher invitations.
- **Feedback**: Anonymous session feedback with QR code distribution. Stats endpoint at `/api/sessions/[id]/feedback/stats`.

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL      # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY # Supabase anon key
SUPABASE_SERVICE_ROLE_KEY     # Supabase service role key (server-only)
NEXT_PUBLIC_APP_URL           # Public app URL used in emailed sign-in/invite links
MAILERSEND_API_TOKEN          # MailerSend API token (server-only)
MAIL_FROM                     # Default sender, "Name <email@verified-domain>" (server-only)
```

### Database

PostgreSQL via Supabase with Row-Level Security on all tables. Migrations in `supabase/migrations/` (files 000-019, applied in order). Core tables: `organizations`, `organization_members`, `departments`, `department_members`, `sessions`, `session_teachers`, `attendance_evidence`, `attendance`, `session_feedback`, `certificates`, `teacher_invitations`.

### Types

All shared TypeScript interfaces are in `lib/types.ts`. User roles defined in `lib/auth.ts` as `UserRole` type.
