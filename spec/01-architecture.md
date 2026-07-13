# 01 — Architecture

## Stack

- **Next.js 16 App Router** + TypeScript + React 19. All mutations are **server
  actions** in `app/actions/*`; API routes exist only for cron jobs
  (`app/api/cron/*`), the ICS feed, and feedback stats.
- **Supabase**: Postgres with Row Level Security + Supabase Auth (email
  magic links / password). No ORM.
- **Tailwind** with cva-based primitives (see 07-conventions).
- **Vitest** for pure-logic tests, colocated as `lib/**/*.test.ts`.

## Layering (the most important rule in the repo)

```
UI (app/ pages, components/)          — rendering + client state only
  → server actions (app/actions/)     — auth checks, orchestration, revalidation
    → data-access layer (lib/db/)     — the ONLY code that queries Supabase
      → Postgres (RLS)
```

- `lib/db/client.ts` exposes two clients:
  - `getDb()` — request-scoped, honours RLS and the signed-in user.
  - `getServiceDb()` — service role, bypasses RLS. Any function using it
    carries a JSDoc justification, and its **caller** must have already
    authorized the operation (e.g. `requireDepartmentModerator`).
- Entity modules (`lib/db/sessions.ts`, `lib/db/ops.ts`, …) return plain
  domain types from `lib/types.ts` and normalise driver errors through
  `toDbError` (`lib/db/errors.ts`). Nothing outside `lib/db/` may import a
  Supabase client for data queries; `supabase.auth.*` (auth-plane) is the
  sole sanctioned direct use.
- Why: swapping the database layer must only ever touch `lib/db/`.
- **Enforced by lint**: `no-restricted-imports` in `eslint.config.mjs` bans
  `@/lib/supabase/*` and `@/lib/db/client` outside `lib/db/`; the explicit
  allow-list covers `lib/auth.ts` (the authorization layer) and files whose
  direct use is auth-plane only. Adding to the list is a review decision.

## Multi-tenancy & roles

- `organizations` → `departments`. Users belong to an org via
  `organization_members.role` and to departments via
  `department_members.role`.
- Hierarchy: `super_admin` (separate `super_admins` table, platform-wide) >
  `org_admin` > `department_admin` ("moderator") > `faculty` > `trainee`.
- Trainee grades: `Level 1 Trainee` (FY1–ST3), `Level 2 Trainee` (ST4–ST8),
  `Consultant`.
- **External people (teachers, guests) do not need accounts** — they are
  reached by email (invitations, RSVP links, claim links, address book).
- Helpers in `lib/auth.ts`: `getCurrentUser/OrgId`, `requireAuth`,
  `requireOrg`, `isOrgAdmin`, `isOrgManager` (org admin OR any department
  admin), `isSuperAdmin`, `isDepartmentModerator(departmentId)`, and the
  `require*` variants that throw. `lib/ops/auth.ts` adds
  `requireOpsManager()` for the ops layer.
- Personal workspaces: `organizations.is_personal` marks auto-provisioned
  single-user orgs (individual sign-up is feature-flagged via
  `INDIVIDUAL_SIGNUP_ENABLED` in `lib/flags.ts`); enterprise-only surfaces
  (audit, ops, admin) are hidden for them.

## Sign-in methods

- **Passwordless magic link (default)**: `sendPasswordlessLoginLink`
  (`app/actions/member-onboarding.ts`) generates the link via the
  service-role admin API (auto-creating the account for a new email) and
  sends it through the normal email adapter. Because this bypasses
  GoTrue's built-in throttles, the action enforces its own rate limit:
  per-email and per-IP windows decided by the pure policy in
  `lib/rate-limit.ts`, backed by the deny-all `login_link_requests` table
  (migration 041, DAL `lib/db/login-links.ts`, rows pruned after 24h).
  Expected failures (rate limit, missing MAIL_FROM, provider errors)
  return `{ success: false, message }` rather than throwing — thrown
  server-action errors are masked in production builds.
- **Microsoft Entra ID SSO** ("Continue with Microsoft", covers NHSmail):
  `getMicrosoftSignInUrl` (`app/actions/auth.ts`) calls Supabase's `azure`
  OAuth provider and returns the redirect URL; `/join/callback` completes
  the PKCE code exchange. Requires the Azure provider to be configured in
  Supabase Auth (see `docs/self-hosting.md`); the button degrades to a
  readable error when it isn't.
- **Email + password**: admin-oriented toggle on the login card.
- **No account at all**: externals act through HMAC capability URLs (RSVP,
  claim, recall, feedback) — see the roles section above.

## Middleware & public routes

`proxy.ts` (the Next 16 proxy convention, formerly middleware.ts) redirects
unauthenticated users to `/login`. Public
surfaces (each a capability URL or genuinely public page): `/`, `/login`,
`/signup`, `/verify/*` (certificates), `/join/*`, session + department
feedback pages, teacher RSVP (`/sessions/[id]/teacher-rsvp/[code]`), slot
claiming (`/claim/[code]`), newsletter unsubscribe
(`/ops/unsubscribe/[token]`), recall answers (`/recall/[token]`),
federation identity (`/.well-known/*`), and the project pages
(`/features`, `/open-source`, `/contributors`, `/news` — announcements
are curated in `lib/news-data.ts`, newest entry doubles as the landing
announcement strip). `/api/*` routes self-authenticate
(CRON_SECRET or tokens).

## Environment

Documented in `.env.example`. Server-only values never reach the client;
only `NEXT_PUBLIC_*` do. Every optional integration degrades gracefully when
unset — dev works with just the Supabase values (email logs to console).
Provider adapters make self-hosting first-class: email is SMTP or Resend
behind one interface, AI honours `OPENAI_BASE_URL`, video honours
`NEXT_PUBLIC_JITSI_DOMAIN`; `/api/health` reports liveness + db. Deployment
and the public API/webhooks/federation layer: spec/09.
