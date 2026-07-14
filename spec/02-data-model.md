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
`044_single_moderator_organization.sql`.

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
| `departments` | Programme partition, join code, configurable attendance/feedback settings | Organization members according to role and publication rules |
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
| `sessions` | Scheduled teaching event | Belongs to organization and department; has creator, status, type, time, location, reminder/report watermarks, attendance settings and lock |
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

Open-slot uniqueness prevents two active rows with the same department/start
identity, but it does not prohibit all time overlaps. See spec 04 for the exact
claim compare-and-set and audience snapshot.

## Attendance and learning evidence tables

| Table | Purpose | Mutability |
|---|---|---|
| `attendance_evidence` | Source observation for a user or external email at a session | Append-oriented in application flows; UPDATE denied; org-admin DELETE policy currently exists |
| `attendance` | Materialized deterministic result (`PRESENT`, `LATE`, `ABSENT`) | Upserted by derivation; frozen while session/result is locked |
| `session_reflections` | User's written learning reflection | Self-owned upsert per session/user |
| `portfolio_packs` | Immutable serialized ARCP/portfolio snapshot and verification code | Insert/read through service DAL; no update/revoke path |
| `recall_question_sets` | Three-question Recall artifact and send watermarks | Draft/edit/approve lifecycle |
| `recall_answers` | One answer set per session/user | Insert-once result with kind, score, answers, and timestamps |

`attendance` has separate partial uniqueness for internal subjects
(`session_id`, `user_id`) and external subjects (`session_id`, normalized external
email). A row is a cache of the derivation, not primary evidence.

## Feedback and recognition tables

| Table | Purpose | Important behavior |
|---|---|---|
| `session_feedback` | Submitted identity snapshot, configurable answer snapshot, derived rating/comment | Public/accountless submission path; moderator raw access |
| `feedback_actions` | “You said, we did” public response | Moderator-authored, department scoped |
| `certificates` | Issued certificate metadata and public verification code | Multiple issue paths; external recipient supported; no general recipient/session/role uniqueness |

Feedback stores the submitter's first name, last name, and email; “public form”
does not mean anonymous storage. Certificates are durable issuance records, while
PDF bytes are rendered on demand. See spec 05 for the privacy and duplication
implications.

## Notification, API, and integration tables

| Table | Purpose | RLS posture |
|---|---|---|
| `notifications` | In-app notification for one user | User selects/marks own rows; service inserts |
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
| `ops_curriculum_domains` | Organization curriculum taxonomy |
| `ops_curriculum_map` | Session-to-domain mapping and confidence/source |
| `ops_newsletter_issues` | Weekly draft/execution state and counts |
| `ops_newsletter_optouts` | Recipient unsubscribe state |
| `ops_memory` | Organization-scoped agent state/deduplication memory |
| `ops_chat_threads` | Assistant conversation container |
| `ops_chat_messages` | Assistant/user/tool message history and traces |
| `audio_recaps` | Moderator-approved script and MP3 bytes for a session |

`audio_recaps` belongs to the same product surface but intentionally is not an
`ops_*` table. It uses its own draft/approved gate and never sends email.

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

Ops, API credentials, webhooks, portable snapshots, and some public-capability
records enable RLS without granting browser policies. Only server code with a
justified service-role client may access them. Such a DAL must:

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
- partial unique indexes distinguish internal and external attendance subjects;
- update predicates implement transitions such as claiming an `OPEN`, future
  slot or claiming a `pending` Ops action;
- watermarks keep reminder/report/Recall jobs from repeating completed work;
- some issue paths intentionally have no uniqueness, notably repeated manual or
  release certificate generation;
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
