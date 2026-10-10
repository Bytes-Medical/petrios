# 02 — Data model, migrations, and row security

## Authority and ownership

The database contract is defined by the ordered SQL files in
`supabase/migrations/`. TypeScript interfaces describe application projections;
they are not a substitute for the SQL constraints, defaults, triggers, indexes,
or RLS policies. This document groups the schema by responsibility and states
which access strategy each group uses.

All application table access is owned by `lib/db/`, with the narrow membership
read exception in `lib/auth.ts`. See spec 01 for the import boundary.

## Migration discipline

Migration filenames are `NNN_snake_case.sql`, with a unique monotonically
increasing numeric prefix. The implemented baseline ends at
`058_audio_recap_tts_provider.sql`.

Rules for a schema change:

1. Never edit an applied migration to change current behavior.
2. Add the next numbered migration and express the forward transition.
3. Make rerun safety explicit where practical (`IF EXISTS`, `IF NOT EXISTS`, or
   guarded procedural blocks), without hiding a genuinely incompatible state.
4. Enable RLS on every new table in the same migration.
5. Add deliberate policies or intentionally leave a service-only table deny-all.
6. Add constraints/indexes that back application assumptions about uniqueness,
   identity, ordering, and compare-and-set transitions.
7. Update the owning DAL types, tests, and relevant specification together.

The repository migration runner applies files in lexical order and records them
in `_bytes_migrations`. Each migration normally runs in a transaction. Files that
contain `ALTER TYPE ... ADD VALUE` are handled outside a transaction because of
Postgres enum restrictions. `_bytes_migrations` is separate from Supabase CLI
migration history; operators must not assume the two histories synchronize.

“Forward-only” does not mean the schema has never removed a feature. Migration
032 deliberately dropped the presentations feature after migrations 026–027
introduced it. That historical migration remains immutable; any future removal
must likewise be a new, reviewed migration with a data-retention decision.

CI checks prefix uniqueness and newly changed migrations for RLS posture. It is a
guardrail, not a semantic review of every policy.

## Core identity and tenant tables

| Table | Purpose | Principal ownership/access |
|---|---|---|
| `profiles` | Application profile synchronized from `auth.users`; email and display-name source | Authenticated self-read; self-update limited to display-name columns and `grade` (column grants, 062) so `email`/`email_verified_at` cannot be claimed; synchronization trigger and service DAL write identity |
| `organizations` | Root tenant and personal/non-personal organization metadata; `name` is renameable by super admins | Readable by members (`is_org_member_of`) and super admins; org admins update only their own (`is_org_admin_of`); creation is super-admin or service-role only |
| `organization_members` | User-to-organization role assignment | Member visibility constrained by org (unchanged by 062, because `getCurrentOrgId()` uses the newest visible own row); org admins update only `role` (column grant) and delete only in organizations they administer (`is_org_admin_of`, 062); inserts are super-admin or service-role only |
| `departments` | Programme partition, join code, configurable attendance/feedback settings, and ordered certificate coordinator defaults; `name` is unique per organization and renameable by moderators/super admins | Readable only by members of the department's organization and super admins (the join code and lead signature are not public); the code is assigned by the `departments_assign_code` `SECURITY DEFINER` trigger (from `gen_random_uuid()`) so uniqueness sees every tenant, and the `departments_aa_guard_code` trigger stops browser roles supplying or changing it |
| `department_members` | User membership, role, and grade in a department | Department/org scoped; the department must belong to the row's organization (`department_members_department_org_fkey`, `NOT VALID` for pre-062 rows); org admins write only in organizations they administer, for departments of that organization and users already in it (062); live writes use the service DAL |
| `super_admins` | Global platform administrator allow-list | Authorization seam/service use; never inferred from org role |

The profile synchronization trigger makes a profile row for auth users and keeps
identity fields aligned. Application workflows also update auth metadata/profile
data during onboarding. Lower-cased email is treated as a stable matching key in
several public-to-account reconciliation paths; callers must normalize before
deduplication.

## Onboarding and login-control tables

| Table | Purpose | Important behavior |
|---|---|---|
| `department_invite_links` | Reusable 12-character department invite capability | Rotating the link invalidates the previous code |
| `department_join_requests` | Older authenticated-user request for a department and role; status is pending/approved/rejected | No client insert policy since 062 (the legacy flow is unmounted and its approval trusts request scope); own-row and own-tenant moderator reads; decisions through the service DAL |
| `member_onboarding_requests` | Current invite/code onboarding request with submitted identity, grade, auth-link type, and movement state | Public begin flow writes through controlled service DAL; authenticated email-owner finalization is privileged |
| `login_link_requests` | Passwordless-link rate-limit counters | Per-email and per-IP windows; old rows pruned opportunistically |
| `organization_join_requests` | Legacy organization-join schema | No active runtime path in the current application |

Public request tables are not invitations to expose unrestricted table clients.
Capability resolution and state transitions remain in actions/DAL functions.

## Teaching delivery tables

| Table | Purpose | Key relationships and constraints |
|---|---|---|
| `sessions` | Scheduled teaching event | Belongs to organization and department (the department must belong to the same organization: `sessions_department_org_fkey`, `NOT VALID` for pre-062 rows); has creator, status, type, time, location, reminder/report watermarks, attendance policy/phase/revision, and secure group-code verifier |
| `session_teachers` | Registered-account teacher assignment/RSVP | Session + user identity; status is `PENDING`, `ACCEPTED`, or `DECLINED`; client writes require moderating the session in the row's own organization (`is_session_moderator_in`) |
| `teacher_invitations` | External-email teacher invitation and public RSVP | Session, normalized email, invite code, RSVP state, identity/contact fields; service-role only since 062 (no browser policies or grants) |
| `teacher_emails` | Historical/manual teacher email metadata | Session-linked communication record |
| `external_contacts` | Organization address-book identity outside auth | Case-insensitive organization email uniqueness; archive/reactivate state |
| `contact_groups` | Named organization contact group | Case-insensitive group-name uniqueness within an organization |
| `contact_group_members` | Contact-to-group join | Composite relationship between contact and group |
| `teaching_slots` | Offerable teaching time block | `OPEN`, `CLAIMED`, or `CLOSED`; selected slot may link to generated session |
| `slot_publications` | Publication event and audience selection | Immutable-ish publication metadata and creator |
| `slot_publication_slots` | Snapshot of slots included in a publication | Join between publication and offered slots |
| `slot_claim_links` | Per-recipient claim capability and claim result | Member or external identity; external links carry a code |
| `session_documents` | Private session file metadata, validation state, checksum, archive state, and scoped hard-delete path | Deny-all; object bytes live in the private `session-documents` bucket |

Open-slot uniqueness prevents two active rows with the same department/start
identity, but it does not prohibit all time overlaps. See spec 04 for the exact
claim compare-and-set and audience snapshot.

## Attendance and learning evidence tables

| Table | Purpose | Mutability |
|---|---|---|
| `attendance_evidence` | Source observation for exactly one user or external email at a session | Append-only application/RLS posture; policy-v2 writes use a transactional service RPC |
| `attendance` | Materialized deterministic result (`PRESENT`, `LATE`, `ABSENT`, `EXCUSED`) | Provisional derivation until locked/stamped with a final revision; written only by `SECURITY DEFINER` RPCs and the service role (no client write grants since 062) |
| `session_participants` | Expected/optional/excused session roster snapshot | Deny-all; evidence adds optional subjects and finalization snapshots expected members/teachers |
| `session_activity_events` | Governed session operation projection | Deny-all, append-only application convention; not a complete security audit |
| `attendance_code_attempts` | Per-user and HMAC-pseudonymized-IP group-code throttle events | Deny-all technical/security log |
| `session_attendance_secrets` | Salted scrypt verifier for the active group code | Deny-all server secret; never selected with ordinary session rows |
| `session_reflections` | User's written learning reflection | Self-owned upsert per session/user |
| `portfolio_packs` | Immutable serialized ARCP/portfolio snapshot and verification code | Insert/read through service DAL; no update/revoke path |
| `recall_question_sets` | Script-bound five-question artifact, immutable publication revision, 21-day window, and send watermarks | Current draft may be replaced; publication is immutable and recall clones a higher revision while retiring the old row |
| `recall_playback_progress` | Per-user/current-audio listening telemetry | Deny-all; guarded heartbeat RPC, reset when audio revision changes |
| `recall_attempts` | Up to three immutable five-answer attempts per set/user | Deny-all; unique numbered attempts tied to exact playback and question revision |
| `recall_completions` | Transactional mastery/attendance recognition and asynchronous certificate state | One per session/user; `PENDING`/`ISSUED`/`DELIVERED`/`FAILED` award lifecycle |
| `recall_answers` | Legacy aggregate/final-outcome compatibility row per session/user | Insert-once result with kind, score, answers, and timestamps; not attendance authority |

`attendance_evidence` has a unique per-session `source_event_key` when present.
`attendance` has separate partial uniqueness for internal subjects
(`session_id`, `user_id`) and external subjects (`session_id`, normalized external
email). A row is a cache of the derivation, not primary evidence. Policy-v2
finalization row-locks the session, snapshots the roster, materializes absences,
and increments/stamps the revision in one RPC transaction.

Migration 059 adds a narrow post-finalization transition. The only producer is
`complete_recall_catchup_v2`, which locks and verifies the immutable question
revision, current audio revision, complete playback, perfect attempt, expected
registered absentee, and current session revision before atomically appending
`RECALL` evidence, inserting completion, and changing that row to `PRESENT`.
Generic evidence writers cannot invoke this source.

## Feedback and recognition tables

| Table | Purpose | Important behavior |
|---|---|---|
| `session_feedback` | Submitted identity snapshot, configurable answer snapshot, derived rating/comment | Public/accountless submission through the service DAL; RLS (enabled by 062, never by 013) allows reads by own-tenant moderators, org admins, super admins, and the respondent's own rows; no client writes |
| `feedback_actions` | Legacy “You said, we did” records | Inactive historical storage; no current read, write, management, or public surface |
| `teacher_feedback_reports` | Moderator-approved, versioned aggregate release snapshot | Deny-all; deterministic analytics plus optional exact reviewed AI-assisted narrative; content changes create a new version |
| `session_deliveries` | Per-recipient report, invitation, certificate, or session-reminder delivery ledger and recoverable send claim | Deny-all; unique natural delivery identity `(session_id, recipient_email, delivery_type, related_id)`, 15-minute stale-claim recovery; `SENT` is reclaimable only for an explicit moderator feedback resend |
| `certificates` | Issued metadata, public code, finalized revision, recognition basis, coordinator snapshot, and validity/revocation state | No public SELECT (verification by code is a service DAL lookup); recipients read their own rows and own-tenant moderators their department's; database eligibility trigger; attendee recognition requires current finalized attendance and correct live/catch-up basis, while teacher recognition requires an accepted assignment/invitation; partial uniqueness permits one current `VALID` subject/session/role row |

Feedback stores the submitter's first name, last name, and email; “public form”
does not mean anonymous storage. A per-session submission key limits one response
per normalized email. Certificates are durable issuance records with
`VALID`/`REVOKED`/`LEGACY` state and an ordered `coordinator_names` snapshot,
while PDF bytes are rendered on demand. Department defaults permit at most four
`certificate_coordinator_names`; migration 052 initializes that list from the
historical `lead_name` and backfills existing certificate snapshots once. The
old single-value column remains as a compatibility mirror of the first current
coordinator, not the canonical renderer input. See spec 05 for report privacy,
eligibility, branding, replacement, and delivery semantics.

`session_deliveries.delivery_type` is unconstrained `TEXT`, so a new delivery
kind needs no migration; the application owns the vocabulary. The session
reminder uses `SESSION_REMINDER` with `related_id` set to the session id: a
non-null `related_id` is required for the natural unique key to deduplicate,
because Postgres treats nulls as distinct. Reminder rows add one ledger row per
reminded recipient (email, user id, provider message id) with no automated
expiry, like the other delivery rows (spec 04).

## Notification, API, and integration tables

| Table | Purpose | RLS posture |
|---|---|---|
| `notifications` | In-app notification for one user, optionally idempotent by user/dedupe key | User selects/marks own rows; service inserts |
| `api_tokens` | Hashed organization API credential, scopes, revocation, usage timestamp | Deny-all; service DAL after org-admin or bearer auth |
| `webhook_endpoints` | Organization callback URL, plaintext signing secret, event subscription | Deny-all; service DAL after org-admin auth |
| `webhook_deliveries` | One-attempt payload and response audit | Deny-all; service write/read |

API token plaintext is never stored. Webhook signing secrets are stored because
the application must sign later deliveries, but are only returned in full at
creation; list views expose a hint.

## Petrios Ops and approved-media tables

The Ops schema uses service-role DAL functions and deny-all RLS because agents,
scheduled runs, and approval execution do not have a natural end-user RLS
session.

| Table | Purpose |
|---|---|
| `ops_agent_runs` | One scheduled/assistant run with trigger, status, and timing |
| `ops_agent_run_steps` | Hash-only inference/tool audit and token metadata |
| `ops_pending_actions` | Approval-gated outbound action with exact payload and state |
| `ops_speaker_chases` | Chase count/timing per target |
| `ops_feedback_syntheses` | Safety-processed synthesis, themes, strengths, actions, quotes |
| `ops_curriculum_domains` | Retired historical organization curriculum taxonomy; no active reader/writer |
| `ops_curriculum_map` | Retired historical session mapping; no active reader/writer |
| `ops_newsletter_issues` | Department/week draft, exact content + source snapshot, revision, execution state, and counts |
| `ops_newsletter_optouts` | Recipient unsubscribe state |
| `ops_newsletter_deliveries` | Per-issue/member revision-bound send claim, retry, provider id, and error state |
| `ops_memory` | Organization-scoped agent state/deduplication memory |
| `ops_chat_threads` | Assistant conversation container |
| `ops_chat_messages` | Assistant/user/tool message history and traces |
| `audio_recaps` | Moderator-approved script and MP3 bytes; exact session-document source snapshot/digest; generation-time public research URL/title citations/research flag; speech provider/model/voice snapshot |

`audio_recaps` belongs to the same product surface but intentionally is not an
`ops_*` table. It uses its own draft/approved gate, never sends email, and treats
legacy rows without a source digest as stale until regenerated from documents.
Migration 053 added the document-source provenance fields; migration 054 adds
`research_sources` as a JSON array and `research_performed` as a nonnull boolean.
The list stores de-duplicated public URL/title pointers, not copies of the public
pages. Legacy rows default to an empty list and `false`. Current generation sets
the flag only after required hosted search returns at least one verifiable HTTP(S)
source. SQL constrains the value to an array of at most 20 entries and forbids a
nonempty list when the research flag is false. Application metadata reads
deliberately exclude the MP3 byte column. The only blob read
(`openRecapAudioStream` in `lib/db/audio-recaps.ts`) is a direct PostgREST GET
of `audio` alone, filtered by session, authorized status, and `audio_revision`,
and decoded incrementally from PostgREST's `\\x` hex JSON. `audio_bytes` must
remain the exact decoded byte length, written or cleared in the same update as
`audio`, because playback sends it as `Content-Length`.

Migration 058 adds nullable `tts_provider`, constrained to `openai` or
`elevenlabs`. Existing audio remains `NULL` because a historical custom
OpenAI-compatible base URL does not prove the underlying provider. New audio
creation snapshots provider, model, and voice together. Script regeneration or
editing clears the MP3, byte count, and all three speech metadata fields so a
draft never describes audio that no longer exists.

No migration accompanies the Anthropic port. Model text columns
(`audio_recaps.model`, recall question sets, feedback syntheses, Ops audit
steps) now hold the model that served the response — `claude-*` by default,
possibly a server-side refusal-fallback model — or `gpt-*` on the optional
OpenAI-compatible adapter. The `tts_provider` constraint is unchanged.

Migration 060 changes newsletters from legacy organization-wide cron artifacts
to moderator-triggered department/week issues. New rows require `department_id`;
legacy null-department rows remain readable for migration history but cannot be
delivered by the current executor. `content` stores the validated editable JSON,
`source_session_ids` and `source_documents` store provenance metadata,
`content_revision` supports compare-and-swap review, and `generated_by` records
the initiating moderator. The partial unique index is
`(org_id, department_id, week_start) WHERE department_id IS NOT NULL`; a separate
legacy partial index preserves organization/week uniqueness for null rows.

`ops_newsletter_deliveries` is deny-all RLS and unique by `(issue_id,
recipient_user_id)`. Its organization and department columns duplicate scope for
auditing; `content_revision` binds the attempt to reviewed content. The claim RPC
is service-role-only and can reacquire `FAILED` rows or a `SENDING` lease older
than ten minutes. Delivery status is constrained to `PENDING`, `SENDING`, `SENT`,
or `FAILED`.

## RLS strategies

Every active table must fit one of these explicit strategies.

### Tenant/member policies

Rows are visible to a user because a join proves current organization or
department membership. Write policies usually narrow further to owner,
department moderator, or organization administrator. Session policies also
consider status and teacher assignment: published sessions are broadly readable
inside the organization; drafts/cancelled sessions are limited to organizers,
creator, or assigned teacher.

### Self-owned policies

Profiles, reflections, and notifications contain rows with a clear user owner.
The user may read or mutate only the supported self operation. Service-created
rows, such as notification inserts, need no public insert policy.

### Tenant helper functions

Policies scope to the row's organization with the `SECURITY DEFINER` helpers
from migration 062: `is_org_member_of(org)`, `is_org_admin_of(org)`,
`is_department_moderator_in(org, department)` (org admin of that organization,
or a department moderator there, and the department must belong to it), and
`is_session_moderator_in(org, session)`. They answer only about `auth.uid()`
and are granted to `authenticated`, not `anon`. Do not write a new policy that
relies on `is_org_admin()` alone or on `get_user_org_id()` for anything but
the caller's primary organization: both resolve the caller's first membership
(`LIMIT 1`, unordered), not the row's tenant, which is how the pre-062
cross-tenant holes arose. `is_department_admin(dept)` and
`is_session_faculty(sess)` are kept for existing policies and are scoped to the
department's/session's own organization since 062.

Do not change which of a user's own `organization_members` or
`department_members` rows are visible: `getCurrentOrgId()` picks the newest
visible own membership and the `lib/auth.ts` role checks read visible rows, so
extra visibility silently switches tenants. A scoped `FOR ALL` policy grants
SELECT too, so write per-command INSERT/UPDATE/DELETE policies on these tables
(062 does). Org admins have no INSERT policy on `organization_members`.

### Capability-mediated public policies

Invite/claim/feedback flows are entered without a normal membership. Access is
still narrowed by code, expiry/state, and a record-specific capability, and is
resolved by the service DAL: since migration 062 no table carries a
`USING (true)` policy for these flows (the old `teacher_invitations`,
`certificates`, and anonymous feedback-insert policies are gone). The server
action/DAL predicate is the boundary; a new public flow must not add a broad SQL
policy instead.

### Deny-all service tables

Ops, API credentials, webhooks, portable snapshots, session documents/activity/
rosters, attendance-code attempts, teacher feedback reports, delivery ledgers,
and some public-capability records enable RLS without granting browser policies.
Only server code with a justified service-role client may access them. Such a
DAL must:

- derive tenant scope before the call;
- filter by that scope on every read/update/delete;
- avoid returning secrets;
- cap untrusted or scheduled list reads; and
- use state predicates for compare-and-set transitions.

## Service role policy

The service role bypasses RLS and is appropriate only when the actor is not a
Supabase browser session or the operation is intentionally system-wide, such as:

- authenticating an API token by its hash;
- running a cron across organizations;
- resolving an accountless invite/capability;
- delivering a webhook;
- creating system attendance/certificate records; or
- storing deny-all Ops artifacts.

It is not a convenience for avoiding a failing policy. A new service function
must take the narrowest trusted identifier set. Request-body `org_id` is never
sufficient by itself.

A `SECURITY DEFINER` function that trusts caller-supplied ids must be
`REVOKE ALL ... FROM PUBLIC, anon, authenticated` and granted to
`service_role` only. `FROM PUBLIC` alone is not enough on Supabase: default
privileges grant `EXECUTE` to `anon` and `authenticated` directly, which is how
the attendance, Recall, and newsletter RPCs stayed callable from browsers until
migration 062. Helpers that policies call as the querying role are granted to
`authenticated` explicitly. `docs/security/rls-lockdown.md` has read-only
queries for checking grants and policies against a live database.

## Constraints, concurrency, and idempotency

Important guarantees live at different layers:

- unique constraints prevent duplicate memberships, answer sets, synthesis rows,
  codes, and selected natural identities;
- migration 044's serialized trigger permits `department_admin` rows in multiple
  departments of one organization but demotes moderator rows in every other
  organization to `faculty` whenever a new organization wins;
- partial unique indexes distinguish internal/external attendance subjects and
  current valid certificate roles;
- Recall uniqueness freezes `(session, revision)`, numbered attempts, one
  playback row per set/user, and one completion per session/user;
- attendance source-event keys, feedback submission keys, notification dedupe
  keys, report versions, and delivery natural keys suppress replay;
- session row locks serialize evidence and attendance finalization;
- database triggers reject duplicate finalization, invalidate certificates when
  attendance is reopened, and reject ineligible `VALID` certificate inserts;
- update predicates implement transitions such as claiming an `OPEN`, future
  slot, claiming a `pending` Ops action, or claiming a delivery lease;
- watermarks plus per-recipient delivery rows keep reminder/report/Recall jobs
  from repeating completed work while leaving failures retryable;
- email and webhook effects are usually not in the same transaction as the
  durable state that triggered them.

Documentation must say “best-effort”, “compare-and-set”, or “unique” only when
the corresponding source/constraint exists.

## Dormant and historical schema

The current schema contains fields/features that are not active runtime
guarantees:

- `sessions.attendance_mode` and strict-token fields exist, but all current
  attendance channels use the evidence pipeline; no strict token mode is
  enforced.
- `TEAMS` is a recognized attendance source, but there is no Teams attendance
  importer.
- `organization_join_requests` is a legacy table without a current route/action.
- presentation tables and storage created in migrations 026–027 were removed by
  migration 032.

Do not expose dormant fields as a supported feature without defining their state
machine, access policy, migration, and tests.

## TypeScript projections

Shared domain projections live in `lib/types.ts`; subsystem-specific DAL modules
also define local interfaces. Not every table has or needs a complete shared row
type. Prefer selecting named columns and typing the returned projection to using
an unbounded `select('*')` outside administrative/internal records. When a JSON
payload is durable—feedback answer snapshots, Ops action payloads, portfolio
packs, webhook payloads—validate it at ingress and preserve a version/format
contract where it leaves the instance.

## Data-model change checklist

- New numbered forward migration, never an edit to history.
- RLS enabled and policy posture intentional.
- Foreign keys and tenant consistency considered.
- Uniqueness and concurrency guarantees placed in Postgres when possible.
- Service-role functions accept trusted scope and do not leak secrets.
- DAL projection/type and error normalization updated.
- Deletion/cascade and retention consequences documented.
- Jobs and capability links remain safe under replay.
- Relevant subsystem spec and tests updated.
