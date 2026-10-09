---
name: new-subsystem
description: Conventions checklist for adding or changing a Petrios feature, table, or subsystem — data-access boundary, RLS, migrations, auth patterns, latency conventions, and the same-commit documentation sync. Use when implementing any behaviour change beyond a trivial fix.
---

# Adding or changing a subsystem

Work through this checklist for any behaviour change. Skipping the
documentation sync or the data-access boundary is the most common review
failure in this repo.

## Before writing code

- Read the relevant `spec/` file first (`spec/README.md` is the index and lists
  the non-negotiable invariants). If your change shifts behaviour, the spec
  update ships **in the same commit**.

## Database

- New tables get a **numbered migration** in `supabase/migrations/` — next
  number in sequence. Existing migration files are **never renamed or edited**
  once pushed; write a new migration instead.
- Default posture for new tables: **deny-all RLS** + a service-role DAL module
  in `lib/db/`. Any function using `getServiceDb()` carries a JSDoc comment
  justifying why it bypasses RLS.
- Migrations are applied via `supabase db push` or the Supabase SQL editor —
  the app never auto-migrates.

## Data access & actions

- Only `lib/db/` may import Supabase for data-plane queries (ESLint enforces
  this). Server actions in `app/actions/` do auth checks and orchestration,
  then delegate to the DAL. Auth-plane calls (`supabase.auth.*`) are the only
  sanctioned direct use outside `lib/db/`.
- Auth ladder: `requireAuth()` → `requireOrg()` →
  `requireDepartmentModerator(departmentId)` / `isOrgAdmin()` etc. from
  `lib/auth.ts`. Role checks use the cached concurrent variants.
- User-facing failures **return** `{ success: false, message }` — thrown errors
  are masked into digests in production and tell the user nothing.
- Shared types go in `lib/types.ts`.

## Latency conventions (spec/07)

- Pages fetch parallel-by-default: staged `Promise.all` (identity first, then
  the fan-out). No sequential await chains.
- Mutations use `hooks/useActionWithRefresh` so the pending state spans both
  the action and the refresh; buttons take the `pending` prop.
- Hot routes ship a `loading.tsx` skeleton (`components/Skeleton.tsx`).
- Heavy client libraries load through a `next/dynamic` `ssr:false` wrapper
  (`SessionCalendarLazy` is the pattern).

## Special boundaries

- **AI**: all ordinary LLM calls go through `lib/ai/llm.ts`; Ops calls go
  through `lib/ops/gateway.ts` with a purpose allow-list. Never call the
  OpenAI API anywhere else. TTS only via `lib/ai/tts.ts`.
- **Email**: `lib/email.ts` adapter only. Ops email additionally requires an
  approved `ops_pending_actions` row — `lib/ops/executors.ts` is the only Ops
  send path.
- **Jitsi/meeting URLs**: resolve via `sessionMeetingUrl()` in `lib/jitsi.ts`,
  never read `teams_meeting_url` directly.
- **Deletes must compensate linked state**: before deleting an entity, ask what
  points at it (slots, invitations, certificates, ledgers) and either block
  with guidance or compensate in the same transaction. See
  `deleteSession`/`deleteTeacherInvitation` for the pattern.

## Same-commit documentation sync

Every behaviour change updates, in the **same commit**:

1. the relevant `spec/` file,
2. `lib/ops/knowledge.ts` (if the assistant should know about it),
3. `CLAUDE.md` (compact summary only, if the architecture summary shifts),
4. `.env.example` + the CLAUDE.md env list + `docs/self-hosting.md` for any new
   environment variable.

## Public-repo rules

- Never name competitor products in user-facing copy, docs, or marketing
  surfaces.
- Commit messages follow Conventional Commits (`s/commits` to verify). Never
  push unless explicitly asked.

## Done means

All gates green — invoke the `gates` skill for the exact sequence and its
Next 16 footguns.
