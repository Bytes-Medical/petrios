# 03 — Evidence-based attendance

## Purpose and invariants

Attendance is not a mutable checkbox. Petrios records observations in
`attendance_evidence` and derives a current result into `attendance`. This keeps
the source and reason visible, lets a stronger observation supersede a weaker
one deterministically, and supports honest catch-up recognition without
presenting it as physical presence.

The governing invariants are:

1. Normal application flows add evidence; they never update an evidence row.
2. `attendance` is a materialized derivation and must be reproducible from the
   evidence and the session's window settings.
3. The pure implementation in `lib/attendance/compute.ts` is shared by
   interactive recomputation and the post-session job.
4. A session attendance lock prevents subsequent recomputation from changing
   results until an authorized unlock.
5. Every evidence item identifies exactly one internal user or one external
   email subject.
6. The primary source is selected by trust priority first, then time. It is not
   necessarily the subject's chronologically first observation.

### Precise append-only claim

The application exposes inserts, reads, and derivation; there is no evidence
update flow and the RLS UPDATE policy is false. Migration 015 does, however,
grant organization administrators a DELETE policy. Cascading deletion of parent
records can also remove evidence. The implemented guarantee is therefore
**append-oriented during normal operation**, not cryptographic or absolute
immutability. Removing the delete policy would require a forward migration and
an operational correction/retention policy.

## Storage model

### `attendance_evidence`

Each row carries:

- `org_id`, `department_id`, and `session_id`;
- either `user_id` or `external_email`;
- `source`;
- `observed_at`, the time used by window validation and lateness;
- JSON `metadata`, including optional code version, feedback id, actor id, or
  `status_override`;
- `created_by` and row creation time.

The evidence identity and its parent session must be tenant-consistent. Public
flows do not get a generic evidence writer; the source-specific action/DAL path
constructs the row.

### `attendance`

The materialized row carries the same tenant/session/subject identity plus:

- `status`: `PRESENT`, `LATE`, or `ABSENT`;
- `primary_source`;
- `first_evidence_at` (a legacy name; it is the timestamp of the selected primary
  evidence);
- `computed_at`; and
- row-level lock metadata.

Separate partial unique indexes cover `(session_id, user_id)` and
`(session_id, external_email)`. Derivation upserts on the appropriate identity.
An ABSENT row can exist after a recomputation with no valid evidence, but the
system does not pre-materialize an ABSENT row for every expected member.

## Evidence sources

| Source | Priority | Created by current implementation | Window | Meaning |
|---|---:|---|---|---|
| `TEACHER` | 5 | Moderator mark; accepted registered-teacher flow; registered slot claim; post-session teacher attribution; teacher feedback release | Always valid | Human/programme assertion or registered teacher attribution |
| `TEAMS` | 4 | Moderator-capable action only; no importer is shipped | Always valid | Reserved for meeting-platform attendance |
| `FEEDBACK` | 3 | Public feedback submission, best-effort | Check-in open through feedback deadline, inclusive | Feedback receipt used as attendance evidence |
| `GROUP_CODE` | 2 | Authenticated check-in using active session code version | Check-in window, inclusive | Participant used the group-code UI |
| `SELF_CHECKIN` | 1 | Authenticated user for themself; Jitsi join attempts this source | Check-in window, inclusive | Participant self-attestation |
| `RECALL` | 0 | Passing accountless catch-up Recall answer for an absent user | Session end through end + 21 days, inclusive | Learning catch-up, explicitly not evidence of physical presence |

The numeric priority is the current `EVIDENCE_PRIORITY` constant. New sources
require coordinated changes to the Postgres enum and `is_evidence_valid`, DAL
type, pure computation, permissions, UI/report labels, tests, and this table.

## Time windows

Let:

- `S` be `session.date_start`;
- `E` be `session.date_end`;
- `open` default to 15 minutes;
- `close` default to 45 minutes;
- `feedback` default to 120 minutes; and
- `late` default to 10 minutes.

Per-session values override those defaults using nullish semantics in the pure
computation, so zero is a meaningful configured value there.

| Boundary | Formula |
|---|---|
| Check-in opens | `S - checkin_open_mins_before` |
| Check-in closes | `S + checkin_close_mins_after` |
| Feedback evidence closes | `E + feedback_valid_mins_after_end` |
| Late threshold | `S + late_after_mins` |
| Recall evidence closes | `E + 21 days` |

`SELF_CHECKIN` and `GROUP_CODE` accept both endpoints of the check-in interval.
`FEEDBACK` accepts from check-in opening through the feedback deadline, both
inclusive. `RECALL` accepts both `E` and exactly `E + 21 days`. `TEACHER` and
`TEAMS` have no time restriction.

The SQL `is_evidence_valid` function mirrors these source windows as a database
utility. Runtime derivation uses the TypeScript pure function and must remain in
semantic lockstep with it.

### Lateness boundary

Lateness is strict: primary evidence observed **after** `S + late` produces
`LATE`; evidence exactly at the threshold produces `PRESENT`. A primary
`metadata.status_override` replaces this derived status.

## Deterministic derivation

For one subject and one session:

1. Revalidate every evidence row against the window for its source using its
   stored `observed_at`.
2. Discard invalid evidence.
3. If none remains, return `ABSENT`, null primary source, and null timestamp.
4. Sort valid evidence by source priority descending.
5. Within the same source priority, sort `observed_at` ascending.
6. Select the first item as the primary evidence.
7. Calculate `PRESENT`/`LATE` using that item's timestamp and the late threshold.
8. If the primary item has `metadata.status_override`, use it instead.
9. Upsert the materialized row with the primary source/timestamp and current
   computation time.

Consequences that callers must understand:

- A teacher observation at 10:30 outranks a self check-in at 09:55; if there is
  no override, lateness is calculated from 10:30.
- `first_evidence_at` is not the earliest timestamp across all sources. It is the
  primary evidence timestamp after priority selection.
- Manual correction does not erase earlier evidence. It adds high-priority
  `TEACHER` evidence with an explicit override.
- A later real-presence source outranks `RECALL`, so catch-up remains visible only
  when it is the strongest evidence available.

## Source authorization and ingestion

### Self check-in

The caller must be authenticated, and `payload.userId` must equal the current
user. The session's organization is established by `requireOrg` and the session
read. The observation time is the server's current time. On success the subject
is immediately recomputed unless attendance is locked.

Joining an in-app Jitsi room attempts a `SELF_CHECKIN` as a best-effort side
effect. The room display window (30 minutes before through 30 minutes after the
session) is broader than the default attendance window (15 minutes before
through 45 minutes after start), so opening the room does not guarantee a valid
check-in.

### Group code

A moderator generates/regenerates a code by:

1. incrementing `sessions.group_code_version`;
2. setting expiry to session end plus check-in-close minutes; and
3. calling the Postgres `generate_group_code(session_id, version)` function.

The database function derives a six-character value from session id, version,
and the current calendar date. Regeneration invalidates older versions. The
check-in action requires authentication, group-code enablement, an active
version, matching supplied version when present, and a nonexpired timestamp.

Current limitations:

- The submitted code string is used only to choose `GROUP_CODE`; the action does
  **not compare the string itself** with the generated value. The enforced
  credential is the optional version plus current session state. This is weaker
  than the UI implies and should be fixed before calling the value a secure code.
- If the RPC fails, generation returns an application-random fallback but does
  not persist that value. Later display/validation cannot reliably reconstruct
  the fallback.
- The generation action uses `checkin_close_mins_after || 45`; a configured zero
  is therefore replaced with 45 for code expiry, unlike the nullish window
  computation.
- The database-derived value changes with the calendar date even when version is
  unchanged.

These are documented implementation facts, not desired security properties.

### Feedback

Public feedback submission writes a feedback row first, then best-effort creates
`FEEDBACK` evidence for the matched user or external email. This path does not
use the authenticated `addEvidence` action because the form is accountless.
Failure to create evidence does not roll back feedback.

Feedback evidence alone is not guaranteed to immediately create/update the
materialized attendance row in every public path. A later recomputation (or
another source) may materialize it. The feedback form itself currently accepts
published sessions without server-enforcing the attendance feedback window; see
spec 05. Evidence still has its own validity semantics during recomputation.

### Teacher and Teams

Interactive `TEACHER` and `TEAMS` evidence requires department-moderator
authorization. Manual marking writes `TEACHER` with `status_override`, then
recomputes the subject.

Several system flows create `TEACHER` evidence directly with a service-role DAL:

- a registered teacher accepts an assignment;
- a registered member claims a teaching slot;
- the teacher-feedback release flow; and
- the post-session reporting job for every registered `session_teachers` row.

The final job currently does not restrict teacher rows to `ACCEPTED`; pending or
declined registered assignments can therefore receive teacher evidence. This is
a known status-filter gap.

`TEAMS` exists in schema and computation, but no Microsoft Teams attendance
importer is implemented.

### Recall catch-up

Recall links are HMAC capabilities naming a session and user. If the current
materialized attendance is not `PRESENT`/`LATE`, the answer is `CATCH_UP`. A score
of at least two out of three within 21 days inserts `RECALL` evidence with
`status_override: PRESENT`, unless the session is locked, and recomputes. See
spec 08 for token, question, and analytics behavior.

## Locking

Department moderators may lock or unlock attendance. Locking updates:

- the session-level `attendance_locked`, timestamp, and actor fields; and
- every existing materialized attendance row's lock fields.

Interactive evidence ingestion checks the session lock before recomputation.
The post-session job also skips its batch recomputation when the session is
locked. Evidence can still be inserted: the lock freezes the derived view, not
the audit input stream.

Unlocking clears the session and existing-row lock metadata. It does **not**
automatically recompute every subject, so evidence accumulated during the lock
may remain unapplied until another recomputation path runs. Any bulk “unlock and
refresh” feature must enumerate both internal and external evidence subjects and
be safe under concurrent evidence insertion.

The simple `recomputeAttendance` action itself does not independently refuse a
locked session; callers are expected to honor the lock. New callers must perform
that check or intentionally define an authorized correction operation.

## Post-session derivation job

`/api/cron/post-session-reports` authenticates with the cron Bearer secret and
selects a capped set of published sessions that ended at least 24 hours ago and
have no report watermark.

For each session it:

1. ensures one `TEACHER` evidence row for every registered teacher id, observed
   at session start;
2. if unlocked, groups existing evidence by user or external email and recomputes
   only those subjects;
3. emits a best-effort `attendance.computed` webhook;
4. identifies internal `PRESENT` and `LATE` users;
5. issues missing attendee certificates and sends certificate email; and
6. writes the report watermark.

Per-attendee thrown certificate/PDF/email errors are caught. The shared mail
adapter normally reports provider failure as `{ error }`; this job does not
inspect that result, so such an attempt is treated as success. A session can
still be watermarked after individual or adapter-reported failures, so the job
is not a guaranteed delivery retry queue. If there are no present/late
materialized users, it watermarks without certificate delivery.

The job does not generate ABSENT rows for all department members. Dashboards and
portfolio views that need expected attendance synthesize ABSENT for missing rows.

## Reads, exports, and privacy

- A participant can read supported self/organization attendance through RLS and
  application projections.
- Moderators can view evidence detail for a session.
- Attendance CSV exports include internal user id or external email, status,
  primary source, selected timestamp, computation time, and lock state.
- The bearer API's `read:attendance` scope returns user ids/external emails and is
  therefore a PII-bearing integration scope.
- Audit, portfolio, certificates, and Recall interpret `PRESENT` and `LATE` as
  attended. They must retain the source where provenance matters.

CSV output quotes every field but does not currently add spreadsheet-formula
neutralization. Treat exported files as sensitive and review formula-injection
risk before adding free-text fields.

## Dormant session settings

`attendance_mode` and strict-token fields exist on sessions, but current runtime
check-ins do not implement a strict token branch. They must not be described in
UI or integration documentation as an active security mode until the action,
database verification, rotation/expiry, and tests are implemented.

## Verification contract

Tests for `lib/attendance/compute.ts` cover defaults and overrides, inclusive
boundaries, priority, tie-breaking, overrides, invalid evidence, and Recall. A
change to attendance must add cases for:

- the exact opening/closing instant;
- null versus zero settings;
- multiple competing sources;
- locked and unlocked behavior;
- internal and external subjects;
- duplicate/replayed requests; and
- SQL/TypeScript window parity where the database function is affected.

Before merging, verify that every evidence producer is enumerated in this spec
and that no caller writes `attendance` as if it were raw input.
