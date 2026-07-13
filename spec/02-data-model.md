# 02 — Data model & migrations

## Migration conventions

- Files live in `supabase/migrations/`, named `NNN_snake_case.sql`, applied
  strictly in numeric order (`supabase db push` or the SQL editor). CI
  (`.github/workflows/ci.yml`) enforces numbering and uniqueness.
- **Never edit an applied migration**; correct forward with a new one.
- Additive bias: features add tables/columns; they don't repurpose existing
  ones. The Petrios Ops layer (036) is the extreme case — `ops_*` tables only,
  droppable without touching the core app.
- UUIDs via `uuid_generate_v4()`, timestamps `TIMESTAMPTZ DEFAULT NOW()`,
  org scoping via `org_id UUID REFERENCES organizations ON DELETE CASCADE`.
- Enum-ish columns are TEXT + CHECK constraints (see 037 for the pattern of
  widening one: DROP CONSTRAINT IF EXISTS + re-ADD).

## RLS strategies (three tiers)

1. **User/org-scoped policies** — core tables (`sessions`, `departments`,
   `attendance`, `session_feedback`, …): members read what their org/role
   allows; helper functions like `get_user_org_id()` avoid policy recursion.
2. **Self-only** — `notifications`: SELECT/UPDATE restricted to
   `user_id = auth.uid()`; INSERT only via service role.
3. **Deny-all** — RLS enabled with **no policies**; rows exist only through
   the service-role DAL, authorization enforced in server actions/cron
   routes. Used where row access rules don't map onto the signed-in user:
   `external_contacts`, `contact_groups(_members)`, `slot_publications`,
   `slot_publication_slots`, `slot_claim_links`, and **every `ops_*` table**.
   (`teaching_slots` itself allows org SELECT so calendars can show open
   slots.)

## Core tables (roughly in dependency order)

`organizations`, `organization_members`, `super_admins`, `departments`,
`department_members`, `profiles` (auto-synced from auth users; email NOT
NULL), department invite links + onboarding requests, `sessions`,
`session_teachers` (+ `status` PENDING/ACCEPTED/DECLINED, `invited_by`,
`responded_at`), `teacher_invitations` (externals; `invite_code` capability
token), `teacher_emails` (send log), `attendance_evidence` (append-only) →
`attendance` (computed; lockable), `session_feedback` (anonymous;
`answers` JSONB of `SubmittedFeedbackAnswer[]`), `certificates`
(public `certificate_code`), `notifications`, `external_contacts` +
`contact_groups` + `contact_group_members`, `teaching_slots` +
`slot_publications` + `slot_publication_slots` + `slot_claim_links`,
`login_link_requests` (deny-all; sign-in rate-limit log, pruned after
24h — spec/01 "Sign-in methods").
Also `feedback_actions` (deny-all; moderator-authored "you said, we did"
entries rendered on public feedback pages — spec/05).

Idempotency watermarks on `sessions`: `report_sent_at`, `reminder_sent_at`.

## Petrios Ops tables (migration 036; all deny-all)

- `ops_pending_actions` — the approval gate. `type` CHECK:
  SPEAKER_CHASE_EMAIL / THANK_YOU_EMAIL / NEWSLETTER_ISSUE / CUSTOM_EMAIL;
  `status`: pending → approved → executed | failed, or rejected. Approval is
  a compare-and-set on `status='pending'` (double-click safe).
- `ops_agent_runs` + `ops_agent_run_steps` — audit trail. LLM steps store
  purpose, model, **sha256 prompt hash**, token counts — never prompt text.
- `ops_feedback_syntheses` — one per session (UNIQUE), safety-railed.
- `ops_curriculum_domains` (seeded RCPCH Progress+ reference data, editable)
  + `ops_curriculum_map` (UNIQUE(session, domain), confidence tier:
  deterministic / llm_high / llm_low).
- `ops_speaker_chases` (chase_count cap bookkeeping), `ops_memory`
  (org-scoped key/value), `ops_newsletter_issues`
  (UNIQUE(org, week_start)) + `ops_newsletter_optouts`,
  `ops_chat_threads` + `ops_chat_messages`.

## Type mirror

Every table row has a TypeScript interface in `lib/types.ts` (snake_case
fields mirroring columns). Label maps (`LOCATION_TYPE_LABELS`,
`SESSION_TYPE_LABELS`, `OPS_ACTION_TYPE_LABELS`, …) live beside the types —
UI must render from these maps, never hardcode label strings.
