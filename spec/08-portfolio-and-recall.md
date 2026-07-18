# 08 — Curriculum passport, portfolio evidence, and Petrios Recall

## Scope and self-service boundary

The Evidence Engine assembles a user's own teaching/learning evidence. Actions
derive `userId` from authentication and `orgId` from current membership; callers
cannot request another user's passport, reflection pack, or teacher dossier.

The subsystem contains four distinct artifacts:

- a live curriculum passport assembled on demand;
- user-authored session reflections;
- a stored, publicly verifiable portfolio-pack snapshot; and
- a live teacher dossier PDF assembled on demand.

Petrios Recall is a separate learning-retention workflow. A passing catch-up
answer records learning completion but does not prove or modify policy-v2
physical attendance.

## Live curriculum passport

`getMyPassport` combines current-org attendance, curriculum mapping, the user's
reflections, and current-org certificates.

### Expected session population

Attendance summary starts with the user's **current** `department_members` rows
in the current organization, then selects every `PUBLISHED` session in those
departments whose `date_start <= now`. The expected denominator is that session
count.

For each session:

- use the user's materialized attendance row when one exists;
- synthesize `ABSENT` with null source when it does not;
- count `PRESENT` and `LATE` as attended; and
- preserve `primary_source` so physical/self/feedback/Recall provenance remains
  visible.

The summary returns attended count, total count, rounded integer percentage, and
a current streak from the most recent session backward until the first absence.

Consequences:

- membership at viewing time, not historical membership at session time,
  determines the session universe;
- joining a department can make all its past published sessions appear as
  expected absences;
- leaving a department can remove those sessions from the live passport; and
- a session counts as past when it starts, even if still in progress.

### Coverage

Curriculum coverage uses stored `ops_curriculum_map` rows only for attended
session ids. It counts mapped sessions per configured curriculum domain. An
unmapped attended session contributes to attendance but no domain. Coverage is a
mapping summary, not a competence judgment.

### Reflections and certificates

The reflection list is self-scoped by RLS/user id but is not filtered by current
organization in its list query. The live passport can therefore carry the user's
reflection rows from other organizations, although pack inclusion later requires
a matching current passport session.

Certificates are filtered to the current organization and contain code, role,
and session title. Certificate eligibility caveats are in spec 05.

## Session reflections

An authenticated user may upsert one `session_reflections` row per
`(session_id, user_id)` when the session exists in their current organization.
The body is trimmed, required, and capped at 4,000 characters.

The action does not require:

- department membership for that session beyond whatever the org-scoped session
  read exposes;
- `PRESENT`/`LATE` attendance;
- a completed or published session; or
- an issued certificate.

There is no delete action. Saving replaces the body and updates `updated_at`.
Reflections are private/self-owned in normal application use, but become part of
a portfolio-pack public snapshot when the user explicitly generates and shares
that pack code.

## Portfolio pack

### Generation window

`generatePortfolioPack(start, end)` requires parseable dates and `start < end`.
It uses the half-open interval `[start, end)` against each live passport entry's
`session_date` (`date_start`).

The generated payload snapshots:

- profile display name and profile grade;
- current organization name;
- date-only period labels;
- every in-period expected session with title, timestamp, status, and primary
  source—including synthesized absences;
- attended and total counts;
- curriculum coverage recomputed only from in-period attended session ids;
- reflections whose session id is in the in-period entries; and
- **all current passport certificate codes**, not only certificates belonging to
  the selected period.

The same content is rendered into a PDF, with certificate codes and a pack
verification code.

### Storage and verification

The service generates 16 random bytes encoded as 32 lowercase hex characters,
inserts a deny-all `portfolio_packs` row, and returns the PDF plus code. The
payload is a durable snapshot; subsequent attendance, profile, reflection,
curriculum, or certificate changes do not alter it.

`/verify/pack/:code` is public and resolves that random code through a
service-role DAL. It displays the stored snapshot. The pack is **not digitally
signed** and the PDF is not cryptographically bound to the row; verification
means that this instance still holds a snapshot with the supplied random code.

There is no expiry, revocation, replacement, deduplication, or one-pack-per-period
constraint. Every generation inserts another shareable snapshot. Treat the code
as a bearer capability containing personal name, grade, attendance, reflections,
and certificate identifiers.

## Teacher dossier

The teacher dossier selects `session_teachers` rows where:

- `user_id` is the current user;
- assignment status is `ACCEPTED`;
- joined session belongs to current organization;
- joined session status is `PUBLISHED`; and
- `date_start` is lexically in `[periodStartIso, periodEndIso)`.

For each session it computes:

- exact duration in minutes;
- count of materialized `PRESENT`/`LATE` attendance rows;
- average of stored feedback `rating` values and response count; and
- display title/date.

The aggregate includes total hours rounded to one decimal, sum of attendee
counts, mean of all stored ratings across selected sessions, and at most the
first ten themes flattened from stored syntheses that do not require human
review.

The dossier is rendered to PDF and returned but not stored, signed, assigned a
verification code, or publicly verified. External teachers cannot generate a
self-service dossier because they have no `session_teachers.user_id` auth
relationship.

Current validation limitation: dossier actions do not perform the portfolio
pack's parseable-date/order validation before DAL lexical comparisons and PDF
`Date` construction. Callers should supply ISO timestamps; future validation
must be server-side.

## Petrios Recall overview

Recall provides one moderator-approved, three-question single-best-answer set
per session. It has two goals:

- `RETENTION`: measure whether learning persisted for attendees; and
- `CATCH_UP`: offer current department members without attended status a short
  learning path whose completion is explicitly distinct from attendance.

It must never expose individual scores to organizers. The public respondent sees
their own result through a bearer link.

## Question schema and drafting

A set contains exactly three questions. Each question requires:

- nonblank question text;
- exactly four nonblank option strings;
- integer `answer_index` from 0 through 3; and
- nonblank explanation.

The daily Ops synthesis job considers published sessions ended 2–45 days ago
that have no Recall set, up to five per invocation. It asks the model for the
schema-validated set and inserts status `draft`. This branch does not require
session feedback and has no deterministic fallback; invalid/unavailable model
output creates no set. Moderators are notified when a draft exists.

## Moderator review and state

Only a moderator for the session's department can read/edit/approve the set.
Saving validates the full three-question schema.

When `approve = true`, update writes:

- edited questions;
- status `approved`;
- approver user id; and
- approval timestamp.

When `approve = false`, it updates questions only. It does **not** move an already
approved set back to draft, clear prior approver metadata, or reset any send
watermark. Thus an approved/sent set can currently be edited in place while
remaining approved and without triggering a resend. There is no explicit
unapprove or version history. This is a lifecycle limitation that must be fixed
before promising immutable approved questions.

## Recall capability token

An email link contains:

```text
<session UUID>.<user UUID>.<32 lowercase hex HMAC characters>
```

The HMAC-SHA256 input is `recall:<sessionId>.<userId>`, keyed by
`SUPABASE_SERVICE_ROLE_KEY`, truncated to 32 hex characters (128 bits). Verification
uses timing-safe comparison. Rotating the service-role key invalidates all links.

The token names an internal user and requires no login. It has no issued-at or
expiry encoded; the server additionally requires an approved set, no existing
answer, and current time within the Recall evidence window. Anyone possessing
the URL can answer as the named user, so links must not be logged/shared.

## Delivery schedule

`GET /api/cron/recall-send` requires the cron Bearer secret. Each candidate query
is capped at 20 approved sets with a null target watermark.

### First send: end + 3 days

Once current time reaches `date_end + 3 days`, and no later than end + 21 days:

- `PRESENT`/`LATE` internal attendance user ids receive `RETENTION` mail;
- every **current** department member not in that attended set receives
  `CATCH_UP` mail; and
- both attendee and catch-up watermarks are written.

A missing materialized attendance row is treated as not attended. The audience
is current membership, not a session-time snapshot. If a session is missing/not
published or the question set is approved after the 21-day window, watermarks
are written without sending.

### Boost: end + 14 days

After the first attendee send and at end + 14 days, present/late attendees with
no answer receive one boost mail. Catch-up recipients do not receive a boost.
After the 21-day window the boost watermark is written without sending.

### Delivery semantics

Watermarks are set after iterating recipients regardless of individual failures.
In addition, the current `sendTo` helper awaits the provider adapter but does not
inspect its returned `{ error }`; adapter-reported delivery failures can be
counted as sent. Only thrown errors enter the catch. Recall email is therefore a
best-effort one-pass notification, not a guaranteed or retryable queue.

Recall mail is deterministic core mail, not Ops-generated copy, so it does not
use the Ops pending-action approval gate. The questions themselves have the
moderator approval gate.

## Public answer flow

Before submission the route returns only question text and options. It never
ships `answer_index` or explanation.

The server:

1. verifies HMAC token;
2. loads session, approved set, and any prior answer;
3. rejects missing/not-approved, already-answered, or out-of-window cases;
4. considers current `PRESENT`/`LATE` materialized status to be `RETENTION`, and
   every other/missing status `CATCH_UP`;
5. compares supplied option indexes with the three correct indexes;
6. passes at two or more correct answers (`ceil(2/3 * total)`);
7. inserts the unique `(session_id, user_id)` answer; and
8. returns score, kind, pass, and per-question correct answer/explanation.

The answer array itself is not schema-validated for exact length/range before
scoring. Missing/out-of-range values simply do not match; extra values are
ignored. The fixed question schema keeps total at three, but explicit answer
validation should precede any future variable-length format.

## Catch-up learning completion

Every accepted answer inserts only the unique `recall_answers` row. When a
`CATCH_UP` answer passes, the response returns `caughtUp: true` to describe the
learning path; it does not append `RECALL` evidence, recompute attendance, issue
a certificate, or depend on the attendance lock. The compatibility
`attendanceLocked` response field is currently always false.

Policy-v1 historical `RECALL` evidence remains readable by the attendance
derivation so old provenance is not silently rewritten. There is no current
producer for new Recall attendance evidence. A failed answer likewise has no
attendance effect.

## Retention analytics and privacy

The moderator action requests answer projections that deliberately omit
`user_id`. It computes separate `RETENTION` and `CATCH_UP` aggregates:

- cohort count `n`;
- mean percentage score, one decimal; and
- whole-number pass rate.

For any whole or time-bucket cohort with `n < 5`, mean and pass rate are null and
`suppressed = true`; the count remains visible. The constant
`RETENTION_MIN_COHORT = 5` is shared conceptually with equity small-cohort
labelling and must not be lowered casually.

Time buckets use whole days from session end, clamped at zero:

- 0–3 days;
- 4–7 days;
- 8–14 days; and
- 15–21+ days (open-ended in the pure function, although the answer action
  normally rejects after day 21).

Attendee response rate is `RETENTION answer count / current PRESENT+LATE
attendance count`, rounded to a whole percentage. It is not small-cohort
suppressed. Counts and k=5 suppression are not differential privacy: uniform
scores in a cohort of exactly five can still imply individual results, and
membership/attendance changes can alter the response-rate denominator.

## Evidence/Recall change checklist

- Keep passport and dossier strictly self-scoped.
- Define historical versus current membership when constructing denominators.
- Preserve attendance source in every evidence export.
- Treat pack codes and Recall tokens as personal-data bearer capabilities.
- Never call a random-code pack digitally signed.
- Version or freeze approved questions before adding edits/resends.
- Validate answer arrays server-side.
- Keep individual Recall ids/scores out of moderator output and assistant tools.
- Apply small-cohort suppression to every new score-derived breakdown.
- Test day 3/day 14/day 21 exact edges, late approval, locks, provider error
  returns, duplicate submission, and service-key rotation.
