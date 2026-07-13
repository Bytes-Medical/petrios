# 01 — Architecture

## Scope and implementation baseline

Petrios is a multi-tenant teaching-programme application built with Next.js
App Router, React, TypeScript, Supabase Auth/Postgres, and server-rendered React
components. The application supports programme scheduling, attendance,
feedback, teaching evidence, communications, reporting, API integration, and an
optional AI-assisted operations layer.

This document describes the source and migrations through
`043_audio_recaps.sql`. It is an implementation specification, not a generic
Next.js architecture recommendation.

## Runtime stack

| Concern | Implementation |
|---|---|
| Web application | Next.js 16 App Router and React 19 |
| Language | TypeScript with server actions and route handlers |
| Identity | Supabase GoTrue; password, passwordless link, and Microsoft Entra OAuth |
| Primary storage | Supabase-hosted Postgres with RLS |
| Browser database client | Supabase browser client for auth-plane operations only |
| Server database clients | Request-scoped RLS client and service-role client, created by `lib/db/client.ts` |
| Email | `lib/email/adapter.ts`: SMTP first, then Resend, then development sink |
| AI | OpenAI-compatible Chat Completions through `lib/ai/llm.ts`; constrained Ops gateway and one sanctioned tool loop |
| Speech | OpenAI-compatible speech endpoint through `lib/ai/tts.ts` |
| Meetings | Jitsi iframe integration or stored Microsoft Teams link; in-person and hybrid locations also supported |
| Documents | React PDF for certificate, portfolio, dossier, audit, and member-report documents |
| Unit tests | Vitest, primarily pure library tests |
| Browser smoke tests | Playwright against the public surface |

## Request and dependency flow

The normal data-plane flow is:

```text
browser / server component
        |
        v
server action or route handler
        |
        +--> authorization helpers in lib/auth.ts
        |
        v
domain and validation library
        |
        v
lib/db/<subsystem>.ts
        |
        v
request-scoped RLS client or explicitly justified service-role client
        |
        v
Postgres constraints, triggers, and RLS
```

The data-access layer is not optional indirection. It gives table access one
searchable owner, prevents service credentials from leaking into presentation
code, centralizes tenant filters, and makes the RLS/service-role choice visible
in review.

### Enforced import boundary

`eslint.config.mjs` restricts imports of the Supabase clients and
`lib/db/client.ts`. New callers must add or extend a DAL function rather than
importing a client from a page, component, action, or route.

There are two intentional classes of exception:

1. `lib/auth.ts` directly reads memberships, departments, organizations, and
   super-admin records because it is the shared authorization seam. Treat any
   expansion of those reads as security-sensitive.
2. Allow-listed auth-plane modules may invoke `supabase.auth.*` for session,
   account, OAuth, magic-link, or metadata work. That exception does not permit
   arbitrary table reads.

`lib/db/` contains both user-scoped and system-scoped access. Merely moving a
query into the directory does not make it safe: every service-role function must
receive trusted tenant/record context and apply the appropriate scope itself.

### Mutation surfaces

Most interactive mutations are server actions in `app/actions/`. They require
authentication and authorization, call a DAL, trigger narrowly scoped side
effects, and revalidate affected paths.

Server actions are not the only write surface. The supported bearer API can:

- create a draft session with `POST /api/v1/sessions`; and
- publish a session with `POST /api/v1/sessions/:id/publish`.

Cron handlers, signup/callback flows, public invite and capability routes, and
webhook delivery records also write. Every such path must independently establish
its actor, tenant, and input boundary.

## Tenancy model

The root tenant is `organizations`. Operational data is organization-scoped
either directly through `org_id` or indirectly through a department/session
whose organization is constrained by foreign keys and application checks.

Within an organization:

- `organization_members` establishes the organization role;
- `departments` partition programme activity;
- `department_members` establishes department participation and department role;
- sessions, slots, contacts, reporting, Ops artifacts, API credentials, and
  webhooks belong to the organization or one of its departments.

An authenticated request does not carry a mutable “current organization” field.
`getCurrentOrgId()` reads the user's most recently created organization membership
(`created_at DESC`, first row) and caches the result within the request. The normal
onboarding transfer flow removes memberships in other organizations, so users
usually have one. Code must nevertheless not assume database-level uniqueness of
membership across all organizations.

Tenant identifiers supplied by the browser are selectors only. The server must
verify them against the authenticated membership. In bearer API requests, the
organization comes exclusively from the stored API token. In public invite and
claim requests, it comes from the resolved capability record.

## Identity and authorization

Authorization is composed rather than represented by a single role enum.

| Capability | Effective actors |
|---|---|
| Global administration | Row in `super_admins` |
| Organization administration | Super admin or `organization_members.role = org_admin` |
| Department moderation | Super admin, organization admin, or department member with `department_admin` |
| Organization management / Ops | Super admin, organization admin, or a department admin in that organization |
| Faculty activity | Department member with `faculty`, subject to action-specific checks |
| Trainee activity | Department member with `trainee`, subject to self-scope and action-specific checks |

Important helper semantics:

- `isDepartmentModerator` elevates super admins and organization admins over all
  departments in scope.
- `isOrgManager` also accepts any department admin within the organization; this
  is the organizer boundary used by Petrios Ops.
- `requireOpsManager` adds the Ops kill-switch requirement.
- RLS is defense in depth, not a replacement for action-level role checks. The
  service-role client bypasses RLS entirely.

The detailed account, join, profile, and administrative lifecycle is specified
in [11 — Identity and administration](./11-identity-and-administration.md).

## Routing and authentication boundary

`proxy.ts` refreshes browser auth and redirects unauthenticated page requests.
It treats the marketing/auth/onboarding pages, public verification and capability
pages, feedback/RSVP/Recall pages, and well-known metadata as public.

The proxy deliberately allows **every `/api/*` path through without a browser
auth decision**. Therefore route handlers must enforce one of these models:

- browser session plus organization and role checks;
- bearer API token plus explicit scope;
- `Authorization: Bearer CRON_SECRET` for scheduled jobs;
- signed/capability input with record-specific checks; or
- intentionally public, read-only output such as health or ICS capability feeds.

Adding a handler under `/api` without an explicit model is a security defect.
Internal API handlers that call server actions inherit those actions' browser
session requirements, but should still translate authorization failures into
appropriate HTTP responses.

### Public page families

The public surface includes:

- marketing, project, privacy, news, and authentication pages;
- signup, verification, department join, and join-status pages;
- session and department feedback entry points;
- registered-teacher invite response and external-teacher RSVP;
- certificate, portfolio-pack, and portable-record verification;
- Recall answer links;
- Ops newsletter unsubscribe links;
- `/.well-known/petrios`, OpenAPI documentation, sitemap, robots, and images.

“Public” means no login cookie is required. Invite codes, HMACs, record codes,
and feed tokens are bearer capabilities and must not be logged or exposed more
widely than necessary.

## Personal workspaces and account posture

Personal organization auto-provisioning is controlled by the compile-time
constant `INDIVIDUAL_SIGNUP_ENABLED` and is currently disabled. This is not an
environment-variable toggle.

With the flag disabled:

- `/login/individual` redirects away;
- an authenticated account with no organization is sent to the join wall; and
- `/signup` can still create an auth account, but the account has no useful
  workspace until it joins a department/organization.

When enabled, the dashboard may provision a personal organization and default
department. Code that assumes personal organizations exist must be guarded by the
same feature posture. Ops newsletter generation excludes personal organizations.

## Rendering, caching, and time

Application pages are server-rendered unless a client component is needed for
interaction, browser APIs, local state, Schedule-X, Jitsi, or PDF download
orchestration. Mutations call `revalidatePath` for affected pages; there is no
general event-sourced client cache.

Persisted times are ISO timestamps in Postgres. Server comparisons use current
UTC instants. Calendar/display formatting occurs in the viewer's browser or with
explicit locale formatting. Specs use half-open or inclusive notation where it
matters; do not replace exact boundary rules with phrases such as “around the
session.”

Scheduled routes are at-least-once invocation surfaces. Idempotency comes from
watermark columns, unique constraints, compare-and-set updates, or explicit
“already exists” reads—not from an assumption that the scheduler invokes once.

## Side-effect boundaries

Database writes and side effects are not globally transactional.

- Email is frequently best-effort after a durable row is written. Individual
  email failures may be logged or counted while the underlying operation remains
  successful.
- Webhooks are fire-and-forget, one attempt, and never fail the initiating action.
- Notifications are internal database records and may be created independently
  from email.
- Certificate PDFs are generated from stored certificate/session data; the file
  is not generally stored as a blob.
- Audio recaps are an exception: approved MP3 bytes are stored in Postgres.

Every workflow spec lists its own ordering and failure semantics. Callers must not
infer all-or-nothing behavior from a single success response.

## Configuration layers

Configuration falls into five trust classes:

1. Browser-safe values prefixed `NEXT_PUBLIC_`.
2. Auth/database secrets, especially `SUPABASE_SERVICE_ROLE_KEY`.
3. Delivery secrets for SMTP/Resend and public application URL construction.
4. AI/Ops secrets and model selection.
5. Integration identities such as `CRON_SECRET` and `INSTANCE_SIGNING_KEY`.

The complete variable contract and precedence are in spec 09. Secrets must never
be imported by client components, serialized into props, included in prompt logs,
or returned after their one-time display.

## Architectural review checklist

A change is incomplete until reviewers can answer:

- Which actor initiates it, and where is authentication performed?
- How is `org_id` derived and checked?
- Does it query through an existing or new DAL function?
- Does the DAL use RLS or service role, and why?
- Which database constraint backs concurrency and idempotency?
- Which public capabilities or personal data are exposed?
- What happens when email, LLM, TTS, PDF, or webhook work fails?
- Can a cron or double click repeat it safely?
- Does it alter an invariant, status machine, window, denominator, or privacy
  claim that must be updated in another spec?
