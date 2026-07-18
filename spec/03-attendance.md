# 03 — Attendance evidence, review, and finalization

## Purpose

Petrios treats physical attendance as a governed record, not a side effect of
feedback, teaching assignment, or later learning activity. An observation is
appended to `attendance_evidence`; a deterministic result is materialized in
`attendance`; a moderator reviews and finalizes a complete roster before that
result can authorize a certificate.

New sessions use attendance policy version 2. Sessions that existed when
migration 045 was applied retain policy version 1 so historical evidence is not
silently reinterpreted. The version is stored on `sessions` and is part of the
derivation contract.

## Non-negotiable invariants

1. `attendance_evidence` is append-only in normal and privileged application
   operation. There is no UPDATE policy, migration 049 removes the former org
   admin DELETE policy, and a correction is a new reasoned evidence row.
   Parent-record deletion can still cascade according to declared foreign keys;
   this is lifecycle deletion, not an evidence correction mechanism.
2. Every evidence row identifies exactly one subject: one `user_id` or one
   normalized `external_email`, never both and never neither. The database check
   is `NOT VALID` only to tolerate potentially malformed historical rows; it is
   enforced for new writes.
3. Policy-v2 evidence insertion and result recomputation occur in one database
   transaction through `record_attendance_evidence_v2`. A committed evidence row
   cannot be left with a stale derived row by that path.
4. Feedback submission, Recall completion, teacher invitation acceptance, and
   teaching-slot claim do not create policy-v2 attendance.
5. A certificate requires the current finalized revision and a `PRESENT` or
   `LATE` result. Both application code and a database trigger enforce this.
6. Finalized attendance cannot be edited. A moderator must reopen it with a
   reason, append corrections, and create a new final revision.
7. Tenant scope comes from the authenticated organization and the session row.
   The service-role RPC locks and matches `org_id`, `department_id`, and
   `session_id`; it does not trust client-supplied scope by itself.
8. Missing evidence is not silently treated as presence. At finalization every
   expected roster member without a result receives an explicit `ABSENT` or
   `EXCUSED` result.

## Storage model

### Session governance fields

`sessions` carries:

| Field | Contract |
|---|---|
| `attendance_policy_version` | `1` for migrated historical sessions; default `2` for new sessions |
| `attendance_phase` | `OPEN`, `REVIEW`, or `FINALIZED` |
| `attendance_revision` | Starts at zero and increments exactly once per successful finalization |
| `attendance_finalized_at/by` | Actor and time for the current final revision |
| `attendance_reopened_at/by/reason` | Most recent documented reopening |
| `attendance_locked*` | Compatibility lock fields; synchronized with the phase |
| `group_code_version` | Monotonic generation number |
| `group_code_expires_at` | Server-enforced expiry |

`attendance_phase` is authoritative for the new lifecycle. `attendance_locked`
remains synchronized because older views and integrations still read it.
The deprecated `sessions.group_code_hash` column is kept null. The active salted
verifier lives in deny-all `session_attendance_secrets`, keyed by session and
tenant, so an ordinary session/RLS payload cannot expose it.

### `attendance_evidence`

An evidence row contains tenant/session identifiers, its one subject, `source`,
server observation time, JSON metadata, creator, and creation time. Policy v2
also uses:

- `source_event_key`: optional idempotency key, unique within a session; and
- `correction_reason`: required for `MODERATOR_CONFIRMATION`.

Evidence metadata may include `code_version`, `actor_user_id`, integration
metadata, or a controlled `status_override`. Evidence is provenance and must not
be rewritten to make a later outcome look like the original observation.

### `attendance`

The materialized row is unique per `(session_id, user_id)` or
`(session_id, external_email)` and contains:

- `status`: `PRESENT`, `LATE`, `ABSENT`, or `EXCUSED`;
- `primary_source` and `first_evidence_at` (the selected primary evidence time,
  despite the legacy field name);
- computation time;
- lock/finalization actor and time; and
- the attendance `revision` represented by the row.

While a session is open or under review, evidence-backed results can be
materialized without being certificate-eligible. At finalization all rows are
locked and stamped with the new revision.

### `session_participants`

This deny-all-RLS, service-DAL table is the session roster snapshot. It supports
an internal user or external email, display name, participant role
(`ATTENDEE`/`TEACHER`), and expectation (`EXPECTED`/`OPTIONAL`/`EXCUSED`).

- Recording evidence adds the subject as `OPTIONAL` if they are not already
  rostered.
- Finalization snapshots current department members as expected attendees.
- Accepted registered session teachers are upserted as expected teachers.
- A current department member already added by evidence is normalized to
  `EXPECTED`, unless their expectation is explicitly `EXCUSED`.

The snapshot is taken at finalization time. It is not a historical claim about
department membership at session start. A future pre-session roster feature
must define its own snapshot time and change semantics explicitly.

### `session_activity_events`

This is the human-readable, append-only session operations log used by the
management Activity Log tab. Attendance evidence, finalization, reopening,
certificate reconciliation, feedback-report release, and document events are
recorded here. It supplements rather than replaces the source tables.

## Lifecycle

### `OPEN`

New sessions start open. Authenticated self/group-code evidence and authorized
moderator/integration evidence may be recorded during their source windows.
Results are provisional. The finalize action is unavailable before session end.

### `REVIEW`

Review means a previously finalized revision has been reopened. Existing
evidence and results remain visible, row locks are cleared, and corrections are
appended. The reopening reason is durable. Certificates from the old canonical
revision are revoked immediately and the post-session report watermark is
cleared.

### `FINALIZED`

Only a published session whose `date_end` is not in the future can be finalized.
The database transaction:

1. obtains a row lock on the session;
2. rejects tenant mismatch, unpublished/future sessions, and duplicate
   finalization without reopening;
3. increments the revision;
4. snapshots current department members and accepted registered teachers;
5. creates explicit `ABSENT`/`EXCUSED` rows for expected subjects with no row;
6. locks and stamps every session attendance row with actor, time, and revision;
7. sets the session phase and compatibility lock fields; and
8. appends activity events and reconciles certificate eligibility.

Finalization does not infer presence from roster membership or teacher role.

### Reopening and correction

Only a department moderator can reopen. A trimmed reason of at least three
characters is required by the database RPC. Reopening is itself not a result
change; it creates a controlled review window.

Manual marking uses `MODERATOR_CONFIRMATION`, a new random idempotency key, a
required reason, and an explicit override of `PRESENT`, `LATE`, `ABSENT`, or
`EXCUSED`. It outranks all earlier evidence but does not delete it. After review,
the moderator finalizes again, creating the next revision.

Calling finalize twice without an intervening reopen is rejected by the
database trigger, even if a client bypasses the disabled UI button.

## Evidence sources and derivation

| Source | Priority | Policy-v2 producer | Validity | Meaning |
|---|---:|---|---|---|
| `MODERATOR_CONFIRMATION` | 6 | Department moderator | No time limit; reason required | Reviewed human decision/correction |
| `TEACHER` | 5 | No ordinary v2 producer; retained for policy-v1/history and reviewed integrations | No time limit | Historical teacher assertion; assignment alone is excluded |
| `TEAMS` | 4 | Department moderator/integration action | No time limit | Reserved meeting-platform observation; no importer currently ships |
| `FEEDBACK` | 3 | None in v2 | Policy v1 only | Historical feedback-derived evidence |
| `GROUP_CODE` | 2 | Authenticated subject after secure-code verification | Check-in window inclusive | Possession of the active session code |
| `SELF_CHECKIN` | 1 | Authenticated subject for themself; Jitsi join attempts it | Check-in window inclusive | Participant self-attestation |
| `RECALL` | 0 | None in v2 | Policy v1 only, end through end + 21 days | Historical catch-up learning completion |

For a subject, derivation:

1. revalidates every row using its stored `observed_at`;
2. under policy v2 excludes `FEEDBACK`, `RECALL`, and `TEACHER` rows whose
   metadata says `assigned_as_teacher: true`;
3. sorts valid evidence by priority descending and then observation time
   ascending;
4. selects the first row as primary;
5. uses its `status_override` when present, otherwise derives `PRESENT` or
   `LATE`; and
6. returns `ABSENT` with no primary source when no evidence is valid.

The TypeScript implementation is `lib/attendance/compute.ts`. The policy-v2 RPC
mirrors its source filtering, priority, and lateness rules. A semantic change
must update both implementations, the tests, and this specification.

### Time boundaries

Let `S` be start and `E` be end. Null settings use these defaults:

| Boundary | Formula |
|---|---|
| Check-in opens | `S - (checkin_open_mins_before ?? 15 minutes)` |
| Check-in closes | `S + (checkin_close_mins_after ?? 45 minutes)` |
| Historical feedback closes | `E + (feedback_valid_mins_after_end ?? 120 minutes)` |
| Late threshold | `S + (late_after_mins ?? 10 minutes)` |
| Historical Recall closes | `E + 21 days` |

Endpoints are inclusive. Lateness is strict: evidence exactly at the late
threshold is `PRESENT`; evidence after it is `LATE`. Zero is a meaningful
configuration because runtime logic uses nullish rather than truthy fallback.

## Source authorization and ingestion

### Self check-in

The caller must be authenticated and the target user must equal the caller.
Server time is authoritative. Joining a Petrios Meet/Jitsi room attempts this
same path as a best-effort side effect; room visibility does not widen the
attendance window and a displayed meeting is not proof that check-in succeeded.
When an enabled, unexpired group-code verifier exists, plain self check-in is
disabled and the participant must submit the active code. This makes moderator
activation of the stronger shared-presence signal meaningful instead of leaving
an equivalent no-code bypass.

### Secure group code

A moderator generation action:

1. creates six characters from an unambiguous alphabet with cryptographic,
   unbiased randomness;
2. increments `group_code_version`;
3. calculates expiry using session end plus the configured close minutes;
4. transactionally stores only `scrypt$<salt>$<derived-key>` in the deny-all
   secret table while updating session version/expiry; and
5. returns the clear code once to the moderator.

The “current code” route returns only active/version/expiry state. It cannot
reconstruct or redisplay the clear code. Regeneration invalidates the prior
version. The moderator Attendance tab generates and displays the clear code in
ephemeral client state; leaving/refreshing loses it and requires rotation. The
participant Attendance tab accepts the announced code and otherwise uses plain
self check-in only while no active code exists.

For each authenticated attempt the server records a deny-all-RLS attempt row
before credential validation. It enforces a rolling ten-minute limit of fewer
than six attempts per user and fewer than thirty per pseudonymized IP. The IP is
HMACed with `ATTENDANCE_RATE_LIMIT_SECRET`, falling back to the server-only
Supabase service key; if neither exists, IP counting is disabled but per-user
counting remains. Raw IP addresses are not stored in this table.

The action checks enablement, active version, optional supplied-version match,
expiry, and the scrypt verifier using a timing-safe comparison. Success records
the code version in evidence and uses a deterministic source-event key so replay
does not duplicate evidence. Rate limiting is a mitigation, not proof of a
person's physical location; moderators retain the correction workflow.

The obsolete deterministic SQL generator has public execution revoked.

### Moderator and integration evidence

`MODERATOR_CONFIRMATION` and `TEAMS` require department-moderator authority in
the action before the service RPC is called. Direct policy-v2 client inserts are
denied by RLS. A database evidence-scope trigger also matches session/org/
department and permits reviewed policy-v2 evidence only for an existing session
participant/result, current department member, or accepted registered teacher.
It prevents a direct action call from attaching a reasoned result to an
unrelated auth user. Policy-v1 direct policies remain narrowly scoped for
historical compatibility.

The current app deliberately rejects attempts to create `FEEDBACK`, `RECALL`, or
ordinary `TEACHER` evidence through `addEvidence`. Accepting a teaching
assignment or slot changes teaching responsibility only.

## Feedback and Recall separation

Public feedback can resolve a stored `user_id` from the supplied email for
feedback-record association. That resolution does not prove the submitter is
that user and is never used for attendance or certificate eligibility.

Passing Recall questions records learning completion and can update the Recall
answer state. Under policy v2 it does not change physical attendance. Policy-v1
historical evidence remains interpretable so old records are not rewritten.

## Participant notifications

After the finalization transaction commits, Petrios creates an in-app
notification for every attendance row with an internal `user_id`. It names the
session, status, and revision and links to the session. Reopening similarly
notifies participants that the record is under review. Notification rows use a
per-user lifecycle deduplication key, so retries do not create duplicates.

Notification creation is intentionally outside the finalization transaction: a
notification provider/storage failure must not roll back a valid attendance
revision. The server action uses `Promise.allSettled`, returns the failure count
to the moderator UI, and leaves the durable attendance result intact. External
email subjects have no in-app inbox and are not emailed by this workflow.

## Certificates and the post-session job

Attendance finalization is the only recognition gate. Feedback is not required
and `require_feedback_for_certificate` is a legacy setting with no policy-v2
effect.

The post-session job does not create evidence or recompute attendance. It skips
sessions that are not finalized, reads current `PRESENT`/`LATE` internal users,
calls the canonical eligibility service, inserts an idempotent role-specific
certificate, and sends through `session_deliveries`. Provider `{ error }`
results are failures. Successful recipient deliveries are skipped on retry and
the session watermark is written only when every eligible recipient completes.

Reopening revokes canonical `VALID` certificates immediately and clears the
watermark. A later finalization can issue a new certificate and delivery tied to
the new certificate id. Revoked codes remain queryable as revoked audit history
but cannot be downloaded as valid PDFs.

## Reads, exports, and privacy

- A participant reads only attendance allowed by RLS/application projection.
- Department moderators can see the roster, computed results, evidence reasons,
  lifecycle revision, and session activity.
- The former “Attendance Audit” feedback list is not an attendance audit. The
  management UI now separates Attendance, Feedback, and Activity Log.
- Attendance CSV export is department-moderator gated. It includes subject id or
  external email, status, source, timestamps, and lock state. Every field is
  quoted and values beginning with spreadsheet formula sigils (`=`, `+`, `-`,
  `@`) are prefixed with an apostrophe.
- The bearer `read:attendance` API remains PII-bearing and must be scoped and
  handled accordingly.

## Concurrency, idempotency, and failure behavior

- Evidence RPCs row-lock the session, so finalization and new evidence cannot
  interleave into a partially finalized revision.
- `source_event_key` makes self check-in and group-code replay idempotent.
- Partial subject indexes keep one derived row per identity.
- Finalization and reopening are database transactions; an activity insert or
  lifecycle invariant failure rolls back the whole operation.
- Notification failure is reported separately after commit.
- Certificate uniqueness is partial by session, subject, role, and `VALID`
  status. Revocation permits a replacement while preserving the old row.

## Current limitations

- No Microsoft Teams attendance importer is implemented; `TEAMS` is a reserved
  reviewed source.
- No pre-session roster editor is implemented. Expected membership is
  snapshotted from current department membership at finalization.
- External-email subjects can be represented in evidence/results but the
  canonical certificate workflow currently requires a registered user.
- `attendance_mode` and strict-token fields are dormant. They must not be
  marketed as active security modes.
- The rate-limit attempt table has no automated retention job yet. Operators
  must include it in technical-log retention policy.
- In-app notification failure is visible to the moderator but has no background
  retry worker. Attendance correctness does not depend on notification delivery.

## Verification contract

Attendance changes require at least:

- pure tests for exact window endpoints, null/zero settings, priority,
  tie-breaking, overrides, policy-v1 compatibility, and policy-v2 exclusions;
- group-code tests for alphabet, normalization, salted verifier, incorrect code,
  and malformed verifier;
- database review of subject constraints, v2 RLS denial, RPC grants,
  idempotency indexes, row locks, duplicate-finalization rejection, roster
  seeding, and certificate triggers;
- action tests or integration checks for source authorization, replay,
  rate-limit boundary, finalization, reopening reason, notification failure,
  and moderator-only export;
- confirmation that feedback, assignment/claim, Recall, feedback release, and
  the post-session job do not create physical-attendance evidence; and
- lint, typecheck, unit tests, production build, and migration execution against
  a representative database before deployment.
