# 08 — Portfolio evidence and Petrios Recall

## Scope and self-service boundary

The Evidence Engine assembles a user's own teaching/learning evidence. Actions
derive `userId` from authentication and `orgId` from current membership; callers
cannot request another user's progress record, reflection pack, or teacher
dossier.

The subsystem contains four distinct artifacts:

- a live attendance/reflection/certificate record assembled on demand;
- user-authored session reflections;
- a stored, publicly verifiable portfolio-pack snapshot; and
- a live teacher dossier PDF assembled on demand.

The former Curriculum passport, Progress+ coverage UI, mapping job, assistant
tools, and pack/export coverage field are retired. Historical
`ops_curriculum_domains`/`ops_curriculum_map` rows and legacy signed records are
preserved for migration and verification compatibility; active application
flows do not read or write those tables.

Petrios Recall is a separate governed learning workflow. Completing the current
Audio Recap pathway changes a finalized absence to `PRESENT` with transparent
source `RECALL`; it does not claim or overwrite physical presence at the
original session.

## Live personal progress record

`getMyPassport` combines current-organization attendance, the user's reflections,
and current-organization certificates. `Passport` remains the internal type name
for compatibility; no active UI describes the result as a curriculum passport.

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
- leaving a department can remove those sessions from the live progress record; and
- a session counts as past when it starts, even if still in progress.

### Reflections and certificates

The reflection list is self-scoped by RLS/user id but is not filtered by current
organization in its list query. The live progress record can therefore carry the
user's reflection rows from other organizations, although pack inclusion later
requires a matching current progress-record session.

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
It uses the half-open interval `[start, end)` against each live progress-record entry's
`session_date` (`date_start`).

The generated payload snapshots:

- profile display name and profile grade;
- current organization name;
- date-only period labels;
- every in-period expected session with title, timestamp, status, and primary
  source—including synthesized absences;
- attended and total counts;
- reflections whose session id is in the in-period entries; and
- **all current progress-record certificate codes**, not only certificates belonging to
  the selected period.

The same content is rendered into a PDF, with certificate codes and a pack
verification code.

### Storage and verification

The service generates 16 random bytes encoded as 32 lowercase hex characters,
inserts a deny-all `portfolio_packs` row, and returns the PDF plus code. The
payload is a durable snapshot; subsequent attendance, profile, reflection, or
certificate changes do not alter it.

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

## Petrios Recall: current Audio Recap catch-up contract

Migration 059 changes Recall from a short, unauthenticated retention quiz into
a governed post-session learning pathway for **registered expected attendees
whose finalized result is `ABSENT`**. The learner listens to the exact approved
Audio Recap, earns 5/5 on five moderator-published multiple-choice questions,
and is then represented as `PRESENT` with primary source `RECALL`. That source is
displayed as **Audio recap catch-up** and must never be described as physical
presence at the original session.

Legacy `RETENTION` answers and aggregate analytics remain readable. Current
publication and delivery, however, are catch-up-only: present/late attendees no
longer receive the former +3-day quiz or +14-day boost.

### Non-negotiable Recall invariants

1. The HMAC URL is only a non-enumerable deep link. Playback, questions, answer
   submission, attendance recognition, and audio streaming require an
   authenticated user whose id exactly matches the token user id.
2. Catch-up is available only to a policy-v2, `PUBLISHED`, ended session with
   `attendance_phase = FINALIZED`.
3. The subject must be a registered `EXPECTED` `ATTENDEE` in the finalized
   `session_participants` snapshot, must have current-revision `ABSENT`
   attendance, and must not be an accepted session teacher. External/email-only
   subjects are unsupported.
4. The current recap must be `approved`, contain audio, and share its
   `script_digest` with an `approved` set of exactly five questions.
5. Questions are not sent to the browser until server-recorded playback has
   completed. Correct indexes and explanations stay server-side until a perfect
   attempt or the final failed attempt.
6. Mastery means exactly 5/5. A learner has at most three attempts per published
   question revision.
7. Only `complete_recall_catchup_v2` may create policy-v2 `RECALL` attendance
   evidence. Generic evidence actions continue to reject `RECALL`.
8. Completion, append-only evidence, the same-revision `ABSENT` → `PRESENT`
   transition, and the activity event commit in one database transaction.
9. A catch-up certificate is labelled with recognition basis
   `AUDIO_RECAP_CATCH_UP`; the certificate trigger rejects relabelling it as
   live attendance.
10. Certificate/provider failure cannot roll back successful learning or
    attendance recognition. The durable award row and delivery ledger permit
    retry without duplicate certificates or email.

### Recap and question provenance

`audio_recaps.script_digest` is lowercase SHA-256 of the trimmed spoken script.
Every drafted question set snapshots that digest. Publishing fails unless it
matches the current approved recap; learner access and the audio route repeat
the same check. Editing or regenerating a script changes the digest, clears its
audio/approval, and makes the former question revision unusable for new access.

Every synthesized MP3 increments `audio_revision`. Petrios derives
`audio_duration_seconds` by scanning MPEG Layer III frames, which works for
constant- and variable-bitrate MP3. The stored value is bounded to 1–1,800
seconds. The server falls back to the bounded 150-words-per-minute script
estimate only when the returned bytes cannot be parsed. Duration is not accepted
from the browser.

Audio Recap generation automatically asks gateway purpose `recall_questions`
for five questions derived from the stored spoken script. Question answers must
be taught in that script; research/document material omitted from the spoken
recap cannot become a hidden test requirement. The question prompt treats the
script as untrusted reference text. A question-draft failure is logged but does
not discard a successfully generated recap script; the moderator can regenerate
the recap to retry drafting.

The schema requires exactly five entries. Each entry contains:

- nonblank `question`;
- exactly four nonblank `options`;
- integer `answer_index` from 0 through 3; and
- nonblank learner-facing `explanation`.

Legacy three-question sets cannot be published for attendance recognition and
must be regenerated.

### Immutable publication revisions

`recall_question_sets` is revisioned per session. Status is `draft`, `approved`,
or `retired`; `(session_id, revision)` is unique.

- Repeated AI generation may replace the current **draft**, because no learner
  can use it.
- Regeneration when the latest set is approved retires that row and inserts a
  new incremented draft in one SQL function.
- “Recall for editing” retires the published row and clones its questions into
  a new incremented draft in one transaction.
- Editing is disabled for approved rows. Publishing is a draft-only
  compare-and-set.
- Attempts, playback, and completions keep their foreign key to the immutable
  revision they actually used. Retired rows are audit history and are not
  candidates for new learner access or mail.

The HMAC token contains session/user, not set revision. Therefore reopening an
old email always resolves the latest current revision. Retiring a published set
immediately stops new use of that email until a replacement is published.

### Moderator publish gate and window

Only the session department moderator can read, edit, recall, or publish. The
moderator UI exposes all five question texts, options, correct selections, and
explanations for human review. After generation, the complete editor is inside
a collapsed-by-default native disclosure; its closed summary retains the
question count, revision, and draft/published status. Publishing requires:

- valid five-question schema;
- a matching approved recap with audio;
- finalized attendance; and
- a still-current draft revision.

Publication records approver/time, `published_at`, `catchup_opens_at = now()`,
and `catchup_closes_at = now() + 21 days`. The deadline is tied to moderator
publication rather than session end, so late but intentional publication still
offers the complete 21-day opportunity. Recalling clears learner access by
retiring the revision; it does not erase attempts or completed recognition.
The service-only `publish_recall_question_set_v1` function locks the draft,
session, and recap and repeats the audio/digest/policy/finalization checks in
the publication transaction, so a concurrent recap recall cannot publish a
stale catch-up package.

### HMAC deep link and sign-in continuation

The email URL token format remains:

```text
<session UUID>.<user UUID>.<32 lowercase hex HMAC characters>
```

The signature is truncated HMAC-SHA256 over
`recall:<sessionId>.<userId>`, keyed by `SUPABASE_SERVICE_ROLE_KEY`, and compared
in constant time. Service-key rotation invalidates outstanding links. The URL
contains no issued-at field; the published-set window is authoritative.

The route itself stays proxy-public so an email can land before authentication.
An unauthenticated visitor is sent to `/login?next=/recall/<token>`. Password,
passwordless, and Microsoft login preserve this same-origin `next` path through
the callback; values that are not a single-slash local path fall back to
`/dashboard`. A signed-in different account receives no session title, audio,
questions, or mutation authority.

### Identity-bound audio streaming and playback progress

`GET /api/recall/:token/audio` verifies the token, current authenticated user,
current approved set, recap approval, and matching script digest before returning
MP3 with `private, no-store`. It is separate from the normal organization-member
recap stream so a valid expected attendee is not broken by “current org”
selection in a multi-membership account.

The browser sends an authenticated heartbeat approximately every eight seconds
while audio is playing and a final heartbeat on `ended`. The service action
derives user id from the verified link/account and accepts only finite playback
positions from 0 through 7,200 seconds. The security-definer playback RPC then:

1. rechecks approved set, current approved recap/digest/revision, and catch-up
   window;
2. maintains one row per `(question_set_id, user_id)`;
3. resets progress if the MP3 `audio_revision` changed;
4. credits at most 20 seconds per heartbeat and bounds credit by both elapsed
   wall time and forward media-position movement (with a two-second scheduling
   tolerance);
5. caps accumulated credit at server-derived duration; and
6. sets `completed_at` only on an end signal when credited listening is at least
   85% and the position reached at least 90% of the server duration.

This is reasonable product telemetry, not a claim that the browser can prove
human attention. A determined user controlling their browser can automate
playback. It does prevent a normal forward seek or forged single “ended” event
from immediately unlocking attendance. The UI accurately calls it verified
listening **progress**, shows a determinate bar from server-accepted seconds,
and unlocks questions only after completion.

### Attempts, scoring, and disclosure

Answer submission schema-validates exactly five integers in range 0–3 and
repeats every identity, eligibility, current-artifact, window, finalized-state,
and playback check. Attempts are numbered 1–3 and unique per
`(question_set_id, user_id, attempt_number)`.

`scoreAnswers` passes only when `total === 5 && score === 5`.

- After attempt 1 or 2 fails, the learner sees the score and remaining count,
  but receives no correct answers or explanations.
- On a perfect attempt, the full answer/explanation review is returned.
- After failed attempt 3, the full review is returned for learning, attendance
  remains `ABSENT`, and the route reports attempts exhausted.
- The original `recall_answers` row is populated best-effort with the final
  catch-up outcome so aggregate-only historical analytics continue to work. It
  is not the source of attendance authority.

Concurrent duplicate attempt numbers are rejected by the database unique key.
The transactional completion RPC is idempotent for an already-created
completion.

### Transactional attendance recognition

`complete_recall_catchup_v2(question_set_id, user_id, perfect_attempt_id)` runs
as `SECURITY DEFINER` and is executable only by `service_role`. Inside one
transaction it locks the session/result and verifies:

- current approved five-question revision and current matching recap;
- open publication window;
- published, ended, policy-v2 finalized session;
- playback complete for the current audio revision;
- the supplied attempt belongs to this set/user and is a perfect 5/5;
- expected registered attendee snapshot and no accepted-teacher assignment;
- current finalized `ABSENT` row at the session revision; and
- no earlier completion for this session/user.

It then inserts `recall_completions`, appends `attendance_evidence` source
`RECALL` with deterministic event key and metadata:

```json
{
  "status_override": "PRESENT",
  "method": "AUDIO_RECAP_CATCH_UP",
  "recall_completion_id": "<uuid>",
  "question_set_id": "<uuid>",
  "audio_revision": 1
}
```

and updates that same finalized attendance row to `PRESENT`, primary source
`RECALL`, without incrementing or reopening the global attendance revision. The
row remains locked/finalized and an activity event
`RECALL_CATCH_UP_RECOGNIZED` records completion, revision, and source.
An insert trigger additionally rejects every new `RECALL` evidence row unless
its exact completion id, question revision, user, deterministic event key, and
`AUDIO_RECAP_CATCH_UP` metadata match an existing governed completion. Thus the
generic evidence RPC cannot be repurposed as another RECALL producer.

This narrow post-finalization transition is the deliberate exception to the
ordinary “reopen before correction” lifecycle: it is a pre-authorized learning
recognition pathway, not a moderator claim that prior evidence was wrong. It
does not revoke unrelated certificates or rerun the whole roster.

`RECALL` remains priority 0, beneath every live source. Policy-v2 recomputation
preserves a governed RECALL row after its question deadline because the RPC
already enforced that deadline at creation. Policy-v1 keeps its historical
session-end through +21-day interpretation.

### Certificate issuance and delivery

`recall_completions.award_status` is `PENDING`, `ISSUED`, `DELIVERED`, or
`FAILED`; it stores the certificate id and last failure. After transactional
recognition, the answer action immediately invokes the shared award worker.
`GET /api/cron/recall-awards`, protected by `CRON_SECRET`, retries all unfinished
or failed rows.

The worker:

1. repeats canonical attendee certificate eligibility at the completion
   revision;
2. resolves the registered profile email/name and snapshotted coordinators;
3. reuses the one current valid attendee certificate or inserts one with
   `issuance_source = RECALL_CATCH_UP` and
   `recognition_basis = AUDIO_RECAP_CATCH_UP`;
4. obtains the natural-keyed `ATTENDANCE_CERTIFICATE` delivery row;
5. claims it with the normal stale-lease recovery;
6. renders the branded PDF with the words “completing the approved Audio Recap
   catch-up pathway”;
7. sends that PDF as an attachment and explains that source is not physical
   presence; and
8. records provider id/success before marking completion delivered.

The certificate database trigger requires matching finalized PRESENT/LATE as
usual. For `AUDIO_RECAP_CATCH_UP` it additionally requires primary source
`RECALL` and the matching completion; conversely a RECALL result cannot receive
a `LIVE_ATTENDANCE` certificate. Teacher rows require
`TEACHING_ASSIGNMENT`. Existing teacher certificates are backfilled to that
basis by migration 059. Downloaded and public verification views preserve and
show the catch-up basis.

If issuance, rendering, configuration, or provider delivery fails, recognition
remains committed and the completion becomes `FAILED`. A later worker run
reclaims the same delivery/certificate; `SENT` is never emailed again. If another
worker currently owns the delivery lease, a concurrent caller returns the
current `ISSUED` state instead of manufacturing a failure.

### Catch-up invitation delivery

`GET /api/cron/recall-send` is deterministic core email outside the Ops pending
action system; moderator publication is its human content/decision gate. It
processes approved, unsent sets only when the current recap/digest/audio is
valid and attendance is finalized.

Recipients are the intersection of:

- current finalized `ABSENT` attendance user ids;
- finalized `EXPECTED`/`ATTENDEE` participant snapshot; and
- not an accepted registered teacher.

This replaces the unsafe former “all current department members minus attended”
audience. Each recipient has a `RECALL_CATCHUP_INVITE` session-delivery row keyed
to the immutable set revision. Provider `{ error }` is treated as failure,
successful rows are skipped on retry, and the set watermark is written only
after every eligible profile delivery succeeds. Missing profile email leaves the
set retryable. An expired set is watermarked without mail. The legacy attendee
and boost watermarks are closed without sending because current Recall is an
absentee-only pathway.

The invitation states the deadline, sign-in requirement, Audio Recap, 5/5
requirement, three-attempt limit, attendance-source wording, certificate effect,
and physical-presence caveat.

### Analytics and privacy

Individual playback positions, attempts, answers, completion, and award status
are deny-all-RLS data accessed only through authorized service orchestration.
Moderator screens expose no named learner scores. Existing aggregate analytics
still project no `user_id` and suppress means/pass rates below cohort size five.
Catch-up final outcomes can enter those aggregates; playback and attempt-level
mistakes do not.

The HMAC link and certificate code are personal-data capabilities and should not
be logged in analytics payloads. Login callbacks allow only same-origin local
continuations. Audio and questions are withheld from wrong-account users.

### Current limitations

- Playback telemetry demonstrates plausible playback, not human attention or
  comprehension; 5/5 is the comprehension gate.
- The 21-day window has no moderator extension UI. A replacement publication
  creates a new revision/window; it does not change completed history.
- After three failures there is no self-service reset. A moderator must decide
  an out-of-band support/remediation path; no action currently resets attempts.
- `recall_answers` remains one row per session/user for legacy aggregate
  compatibility, so it stores only a final catch-up outcome best-effort rather
  than every immutable attempt. `recall_attempts` is authoritative for mastery.

## Superseded pre-059 Recall behaviour (historical, non-normative)

The remainder of this section documents the implementation before migration
059. It is retained to explain legacy `RETENTION` rows, three-question sets,
watermarks, and policy-v1 evidence. It does **not** describe the current learner
path or current invariants.

Recall provides one moderator-approved, three-question single-best-answer set
per session. It has two goals:

- `RETENTION`: measure whether learning persisted for attendees; and
- `CATCH_UP`: offer current department members without attended status a short
  learning path whose completion is explicitly distinct from attendance.

It must never expose individual scores to organizers. The public respondent sees
their own result through a bearer link.

The session manage **Recall** tab composes three post-session learning surfaces:
the separately approved Audio Recap workflow specified in spec 06, Recall
question review, and aggregate retention analytics, in that display order.
Colocation does not merge their lifecycle or delivery rules.
Audio Recap targets about five minutes and is led by currently available
uploaded session documents, with required domain-limited authoritative web
research used only for relevant supporting context. The moderator sees an
estimated generation bar and a collapsed source-count disclosure whose
clickable research links expand on demand. Creating the audio
sends only the stored draft script—not the uploaded documents or research
queries—to the configured OpenAI-compatible or ElevenLabs speech provider; the
moderator sees its provider/model/voice provenance and reviews it before
approval. An approved recap can be recalled to a moderator-only draft while
preserving its current script/audio, then re-synthesized, edited, or regenerated
from the current documents; the replacement requires approval again. A document-
set change makes the artifact unavailable; later public-source changes do not
automatically stale it. It is not a summary of learner feedback.

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
