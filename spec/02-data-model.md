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
| `profiles` | Application profile synchronized from `auth.users`; email and display-name source | Authenticated self-read/update plus authorized directory use; synchronization trigger |
| `organizations` | Root tenant and personal/non-personal organization metadata | Organization members; managers mutate |
| `organization_members` | User-to-organization role assignment | Member visibility constrained by org; admins mutate |
| `departments` | Programme partition, join code, configurable attendance/feedback settings, and ordered certificate coordinator defaults | Organization members according to role and publication rules |
| `department_members` | User membership, role, and grade in a department | Department/org scoped; administrators mutate |
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
| `department_join_requests` | Older authenticated-user request for a department and role; status is pending/approved/rejected | Self-insert RLS plus administrator decision paths; actions/components remain but are not mounted by a current page |
| `member_onboarding_requests` | Current invite/code onboarding request with submitted identity, grade, auth-link type, and movement state | Public begin flow writes through controlled service DAL; authenticated email-owner finalization is privileged |
| `login_link_requests` | Passwordless-link rate-limit counters | Per-email and per-IP windows; old rows pruned opportunistically |
| `organization_join_requests` | Legacy organization-join schema | No active runtime path in the current application |

Public request tables are not invitations to expose unrestricted table clients.
Capability resolution and state transitions remain in actions/DAL functions.

## Teaching delivery tables

| Table | Purpose | Key relationships and constraints |
|---|---|---|
| `sessions` | Scheduled teaching event | Belongs to organization and department; has creator, status, type, time, location, reminder/report watermarks, attendance policy/phase/revision, and secure group-code verifier |
| `session_teachers` | Registered-account teacher assignment/RSVP | Session + user identity; status is `PENDING`, `ACCEPTED`, or `DECLINED` |
| `teacher_invitations` | External-email teacher invitation and public RSVP | Session, normalized email, invite code, RSVP state, identity/contact fields |
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
| `attendance` | Materialized deterministic result (`PRESENT`, `LATE`, `ABSENT`, `EXCUSED`) | Provisional derivation until locked/stamped with a final revision |
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
| `session_feedback` | Submitted identity snapshot, configurable answer snapshot, derived rating/comment | Public/accountless submission path; moderator raw access |
| `feedback_actions` | Legacy “You said, we did” records | Inactive historical storage; no current read, write, management, or public surface |
| `teacher_feedback_reports` | Moderator-approved, versioned aggregate release snapshot | Deny-all; deterministic analytics plus optional exact reviewed AI-assisted narrative; content changes create a new version |
| `session_deliveries` | Per-recipient report, invitation, or certificate delivery ledger and recoverable send claim | Deny-all; unique natural delivery identity, 15-minute stale-claim recovery; `SENT` is reclaimable only for an explicit moderator feedback resend |
| `certificates` | Issued metadata, public code, finalized revision, recognition basis, coordinator snapshot, and validity/revocation state | Database eligibility trigger; attendee recognition requires current finalized attendance and correct live/catch-up basis, while teacher recognition requires an accepted assignment/invitation; partial uniqueness permits one current `VALID` subject/session/role row |

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
deliberately exclude the MP3 byte column.

Migration 058 adds nullable `tts_provider`, constrained to `openai` or
`elevenlabs`. Existing audio remains `NULL` because a historical custom
OpenAI-compatible base URL does not prove the underlying provider. New audio
creation snapshots provider, model, and voice together. Script regeneration or
editing clears the MP3, byte count, and all three speech metadata fields so a
draft never describes audio that no longer exists.

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

### Capability-mediated public policies

Invite/claim/feedback flows are entered without a normal membership. Access is
still narrowed by code, expiry/state, and a record-specific capability. Broad SQL
policies in older migrations must not be treated as sufficient authorization;
the server action/DAL predicate is part of the boundary.

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
