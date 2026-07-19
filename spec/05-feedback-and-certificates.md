# 05 — Feedback, analytics, teacher reports, and certificates

## Privacy vocabulary and invariants

Petrios feedback submission is public/accountless and identified. Those words
describe different properties:

- **public/accountless**: no authenticated browser session is required;
- **identified at storage**: first name, last name, and email are required and
  stored with answers;
- **identity-field omitted**: a processing path deliberately excludes the
  stored identity columns;
- **privacy processed**: a path also applies controls such as name stripping,
  welfare screening, aggregation, or small-cohort evidence warnings; and
- **anonymous**: the person cannot reasonably be identified, which the source
  feedback row does not guarantee.

The invariants are:

1. Product copy must not describe source feedback as anonymous.
2. Feedback submission never creates attendance evidence or a certificate.
3. Teacher release never includes respondent names, email addresses, or raw
   comments and never changes attendance or certificates.
4. A non-empty feedback set can produce AI guidance and detailed teacher-report
   analytics; reports below five responses must state that the evidence is
   limited and directional rather than representative.
5. Free text is untrusted at prompt, HTML, export, and public-output boundaries.
6. A `VALID` certificate can be created only from the current finalized
   attendance revision through the canonical eligibility boundary.
7. Provider-reported email errors and a teacher-report transport response
   without a message id are durable failures, not successful sends.
8. Coordinator attribution on an issued certificate is a snapshot and must not
   change when later department settings are edited.

See spec 13 for controller disclosure, lawful-basis, rights, retention, and AI
provider responsibilities. Privacy processing reduces disclosure risk but does
not retroactively anonymize the stored source.

## Configurable feedback form

Each department stores `feedback_form_fields` as a JSON array. Supported field
types are:

- `rating`: integer string `1`–`5`, with an optional comment prompt;
- `text`: single-line text; and
- `textarea`: longer free text.

Normalized fields have a stable unique id, type, label, required flag, and
type-appropriate prompt metadata. Invalid or absent templates fall back to six
defaults: five required teaching-quality ratings and one optional comment.
Normalization:

- drops blank-label fields;
- generates and de-duplicates missing/duplicate ids;
- maps unknown types to `rating`;
- restores defaults if nothing usable remains; and
- caps moderator updates at 24 fields in the server action.

Only a department moderator can read or update the management template. The
24-field cap is an application rule, not a database constraint.

## Public entry points and submission window

`/sessions/:id/feedback` targets one session.
`/departments/:id/feedback` selects an active published session in the
department. Both submit through `submitFeedback`.

The server, not only the page, enforces:

```text
opens  = session start - (checkin_open_mins_before ?? 15 minutes)
closes = session end   + (feedback_valid_mins_after_end ?? 120 minutes)
```

Both endpoints are inclusive. The session must exist and be `PUBLISHED`.
Direct action invocation cannot submit before opening or after closing.

The department-selector page must use the same nullish semantics; a configured
zero is meaningful and must not be changed to 120 with a truthy fallback.

## Submission validation and storage

The action requires trimmed first name, last name, and lower-cased email and
performs a basic server-side email syntax check. It reloads the current
department form and creates a durable answer snapshot:

1. answer inputs map by stable field id;
2. every required field is checked;
3. ratings must be `1` through `5`;
4. id, type, label, value, and comment prompt/value are snapshotted; and
5. historical labels therefore survive later template changes.

The stored scalar `rating` is the rounded mean of supplied rating answers. The
stored `comment` is a labelled, double-newline join of free-text fields and
rating comments. The JSON answer snapshot remains the detailed source.

If an existing profile has the same normalized email, its `user_id` is attached
for feedback association. This is a lookup, not proof that the account owner
submitted the public form, and must never be promoted into attendance identity.

`submission_key` is SHA-256 of the normalized submitted email. A partial unique
index on `(session_id, submission_key)` permits one response per email per
session and turns replay into a clear conflict message. This is an idempotency
and duplicate-control rule, not email ownership verification. Shared addresses
therefore share the one-response allowance, and a malicious person who knows an
address could consume it; verified-email feedback would require a capability or
login redesign.

The feedback insert is the complete submission transaction. There is no
best-effort attendance insert, certificate render, or email side effect after
it.

## Moderator statistics

Feedback statistics require department-moderator authorization. For every
submission:

- calculate the unrounded mean of snapshotted rating answers;
- fall back to the legacy scalar rating if no rating answers exist;
- give every submission equal weight in the overall mean;
- round/clamp its distribution bucket to 1–5;
- extract rating comments and text/textarea values as labelled responses; and
- group question summaries by the snapshotted field id.

`averageRating` is the mean of submission-level means rounded to one decimal,
or zero with no score. Question averages are rounded to one decimal and carry
response/comment counts. Legacy rows appear under “Overall session rating”.

The management Feedback surface can display aggregate scores and comment text
to authorized moderators. `getSessionFeedbackAudit` is the explicitly
identified raw path and includes stored name, email, answers, derived values,
and timestamp. It is not attendance evidence and is not presented in the
Attendance tab or any other management tab.

The raw **Feedback Responses** surface is an audit explorer rather than an
always-expanded feed:

- each submission is one compact row showing respondent, email, overall score,
  answered-field/written-response counts, and submission time;
- complete question answers stay collapsed until the moderator expands that
  row, with expand/collapse-all scoped to the visible page;
- client-side search covers respondent name/email, question labels, values,
  comments, and legacy comment text;
- score bands are below 3, 3–3.9, and 4+, with an optional written-feedback-only
  filter;
- sort choices are newest, oldest, lowest score, and highest score, with
  unscored responses after scored responses in score sorts; and
- pagination defaults to 10 rows with 10/20/50 options and reports both matching
  and total counts.

Changing search/filter/page-size returns to page one and closes expanded rows.
An empty filter result is distinct from a session with no feedback. The current
authorized endpoint still returns the complete session audit set and the
explorer filters/paginates it in the browser; this is appropriate for the
expected tens-to-low-hundreds scale but is not cursor pagination. A future
unbounded deployment must add server-side count/search/cursor semantics before
claiming large-dataset scalability.

## On-demand AI feedback summary

Petrios does have an optional OpenAI-compatible feedback summarization
capability. The moderator-only `summarizeSessionFeedback` action:

1. confirms session and department authority;
2. refuses gracefully when no provider is configured or no feedback exists,
   but permits model invocation from the first response;
3. checks raw comments for welfare, safety, conduct, bullying, or safeguarding
   signals and routes such content to human review without sending it to AI;
4. omits stored first name, last name, and email fields;
5. strips known name-like tokens from comments before inference;
6. places comments in an explicit `<feedback-data>` untrusted-data fence and
   instructs the model never to follow embedded instructions;
7. supplies privacy-safe question averages plus stripped written feedback and
   requests a teacher-facing draft with overall interpretation, evidenced
   strengths, improvement priorities, next-session actions, and an evidence
   limitation note; and
8. strips known names from returned text again.

The call goes through the general `lib/ai/llm.ts` adapter and is not an Ops
outbound action. Model completion alone cannot send anything. The result enters
an editable teacher-report composer; editing invalidates the review checkbox.
The moderator must compare it with source feedback, remove unsupported or
identifying material, and explicitly approve it for release. Deterministic
stripping cannot guarantee anonymization of every self-identifying phrase.

Petrios Ops synthesis is a separate stored workflow with the approval and audit
rules in spec 06. Neither AI path evaluates individual trainee performance.

## Teacher feedback report lifecycle

`releaseTeacherFeedback` is a deliberate department-moderator approval action.
It does not run automatically after session end.

### Recipients

- external `teacher_invitations` must be `ACCEPTED`;
- registered `session_teachers` must be `ACCEPTED` and have a profile email; and
- candidates are de-duplicated by normalized email.

Assignment status is teaching responsibility only; release does not assert that
the teacher physically attended.

### Report snapshot, no-data suppression, and small cohorts

The approval click creates (or reuses for retry) a
`teacher_feedback_reports` snapshot with monotonically increasing per-session
version, response count, aggregate JSON, suppression flag, creator/approver,
timestamps, and lifecycle status `APPROVED`, `RELEASED`, or `FAILED`.

For zero responses:

- average and rating distribution are stored as null in the release snapshot;
- question summaries are stored as an empty array; and
- a reviewed narrative is rejected because there is no evidence to summarize;
  the email states that no feedback evidence was available.

From one response onward, the email contains total count, mean, response
distribution, and every snapshotted scored-question average with its
denominator. When the moderator approved an AI-assisted narrative, the exact
edited text is stored as `analytics_snapshot.reviewedSummary` and rendered ahead
of the deterministic tables. The email labels it as AI-assisted and
moderator-reviewed. A report with one to four responses also carries a prominent
warning that its scores and themes are limited, directional evidence, not a
representative conclusion, and must not be used to infer who submitted feedback.
This warning does not make a small cohort anonymous; teachers may infer
participation from context.

In every cohort the email explicitly states that no respondent identity or raw
comments are included. Dynamic teacher/session/department/question/narrative
fields are HTML-escaped. The email uses the Petrios warm-paper, ink, and clay
visual tokens and separates the headline, evidence, coaching narrative, and
privacy note.

The Feedback tab is the single composition/release surface. The older split
between a disposable AI preview under Feedback and the release button under
Certificates no longer applies. The server accepts reviewed narrative only from
an authorized department moderator, caps it at 4,000 characters, and rejects it
only when no response exists. The release click is the approval boundary: it
snapshots the exact text alongside deterministic analytics before contacting
the provider. Model generation itself remains non-outbound.

### Idempotency, claims, and retry

Report reuse compares canonicalized aggregate JSON, not response count alone.
If the latest report has the same response count and identical approved
snapshot:

- `FAILED` or `APPROVED` is reused for retry;
- `RELEASED` is reused as the already-approved immutable snapshot; and
- a newly accepted teacher without a delivery row can receive that same report.

A changed response count or changed reviewed narrative/question snapshot creates
the next version. This prevents later edits from rewriting or being sent under
an older approval. When a resend call omits a new narrative, the DAL preserves
the latest same-count reviewed narrative and sends the frozen snapshot; a page
reload therefore cannot silently downgrade the email. Concurrent version
creation is reconciled only when both response count and canonical snapshot
match the row that won `(session_id, version)`.

Each recipient/report pair has one `session_deliveries` row. Before contacting
the provider, a worker atomically claims `PENDING`/`FAILED` as `SENDING`.
Concurrent workers cannot claim the same row. A `SENDING` claim older than 15
minutes can be recovered after a crashed worker. Background jobs and an
unfinished first release skip `SENT` on retry.

The moderator control is deliberately different after a report has reached
`RELEASED`: every later click without changed approved content is an explicit resend of that same approved
snapshot to the current de-duplicated accepted-teacher list. On that path only,
the claim may transition `SENT` back to `SENDING`. This permits any number of
intentional resends without weakening certificate-email or cron idempotency.
The in-flight lease still prevents two concurrent clicks or browser tabs from
contacting the provider for the same recipient at the same time. The button
remains enabled after success and labels the next action as a resend; it does
not claim that a resend was skipped merely because an older attempt succeeded.

Provider data id and `{ error }`, attempt count, last error/time, and sent time
are stored. A failed resend preserves the last successful provider id and
successful sent time while recording the new failure and incremented attempt
count. A first release becomes `RELEASED` only when the current action observes
no failed or in-progress recipient. A later failed resend does not change that
historical lifecycle fact back to `FAILED`.

Every completed moderator attempt appends an activity event with a unique
`attempt_id`, report id, resend flag, sent count, and failed count. Event types
distinguish `RELEASED`, `FAILED`, `RESENT`, and `RESEND_FAILED`. The response UI
shows recipient-level failure messages and any provider receipt ids returned in
that browser action. The teacher-report path rejects any transport success
without a nonblank provider id as untraceable and cannot set the ledger to
`SENT`; this includes the local development sink. The Resend adapter independently
enforces the same requirement for a Resend 2xx response.

`SENT` means the configured SMTP or Resend transport accepted the submission;
it is not proof that the message reached the inbox. Final delivery, deferral,
bounce, spam filtering, or complaint status remains in the provider unless a
provider webhook/status ingestion feature is added. A displayed Resend receipt
is the support reference for investigating that downstream state.

Ordinary first-release retry is effectively-once at the application claim
boundary, not a mathematical exactly-once email guarantee: a provider may
accept an email and the database write may then fail, causing a later retry.
Explicit resends are intentionally at-least-once user actions. Provider-supported
idempotency would be needed to close the provider-acceptance/database-write gap.

Teacher feedback release never:

- creates teacher or attendee certificates;
- appends attendance evidence;
- emails attendees;
- writes the session certificate-report watermark; or
- exposes raw respondent identity/comment data to the teacher.

## Retired “You said, we did” surface

The management editor and public “You said, we did” sections are removed. The
application performs no current reads or writes against `feedback_actions`.
Existing rows remain as inactive historical data because migrations are additive
and this change does not silently destroy operator records. A later retention or
schema-removal migration must be an explicit, reviewed data-governance decision.

## Certificate record and statuses

A certificate stores organization, department, session, optional registered
user, role (`ATTENDEE`/`TEACHER`), unique human-readable code, recipient
name/email snapshot, ordered teaching-coordinator name snapshot, issuer
snapshot, issue time, attendance revision, issuance source, and lifecycle
fields.

Statuses are:

| Status | Meaning |
|---|---|
| `VALID` | Passed the current canonical eligibility gate and has not been revoked |
| `REVOKED` | Retained for audit but no longer valid; reason, actor, and time are stored |
| `LEGACY` | Predates the canonical gate; retained and labelled as legacy, not silently asserted as v2-valid |

Migration 046 marks pre-existing rows `LEGACY`. Partial unique indexes permit at
most one `VALID` certificate per `(session, user, role)` or normalized external
email/role. Revoked and legacy history does not prevent a new canonical row.
Migration 056 defines the external protocol: an external teaching certificate
has `user_id = NULL`, `certificate_role = TEACHER`, a nonblank recipient
name/email snapshot, and an `invitation_id` pointing to the matching accepted
session invitation. The normalized invitation email is the roster and delivery
identity. Migration 057 separates role semantics: teaching recognition is based
on the accepted assignment after session finalization, while attendee
recognition remains based on physical-attendance evidence.

## Teaching-coordinator configuration and snapshot

Department moderators and organization admins configure certificate defaults in
Settings for each department they manage. The form accepts zero to four ordered
teaching-coordinator names. The server boundary:

- requires an array of text values;
- trims leading/trailing whitespace and collapses repeated inner whitespace;
- removes blank values and case-insensitive duplicates while preserving the
  first spelling and order;
- rejects more than four input rows; and
- rejects a normalized name longer than 80 characters.

`departments.certificate_coordinator_names` is the current default. The database
also caps its cardinality at four. Updating the list writes the first name to
the historical `departments.lead_name` column for compatibility with older
clients; new code treats the ordered array as canonical.

At new issuance, both the moderator path and the post-session job copy the
resolved department list to `certificates.coordinator_names`. Manual generation
also snapshots the issuing moderator separately in `issued_by_name`; the cron
has no human issuer. If the configured array is empty but a legacy lead exists,
the server uses that one legacy value. Editing Settings later affects previews
and future certificate rows only.

Migration 052 initializes empty department arrays from nonblank `lead_name` and
then backfills every pre-existing certificate once from its department. That
transition freezes the attribution visible at migration time; it cannot recover
which historical lead applied at each old issue date.

## Canonical certificate eligibility

Every application issue path calls `requireCertificateEligibility`, and a
database `BEFORE INSERT/UPDATE` trigger independently repeats the gate. Every
`VALID` certificate first requires:

1. a `PUBLISHED` session whose end is not in the future;
2. `attendance_phase = FINALIZED`; and
3. certificate organization and department matching the authoritative session.

Role-specific eligibility is then:

- `ATTENDEE`: a registered user who is not an accepted session teacher, with
  finalized `PRESENT` or `LATE` attendance at the current session revision;
- registered `TEACHER`: the matching `ACCEPTED` `session_teachers` assignment;
  or
- external `TEACHER`: a nonblank recipient name, normalized recipient email,
  and matching `ACCEPTED` invitation id/session/organization/email.

External identities are eligible only for `TEACHER`, never `ATTENDEE`.
Registered and external subjects are mutually exclusive at the application
eligibility boundary. The database additionally matches certificate org and
department to the authoritative session, requires external recipient name and
invitation id, and matches invitation/session/org/email before accepting the
row.

Feedback status and `require_feedback_for_certificate` do not participate.
Teaching assignment does not become physical-attendance evidence: it is the
separate recognition basis for a certificate of teaching. No attendance row is
created or changed by teacher certificate generation.

`certificates.recognition_basis` is one of:

- `LIVE_ATTENDANCE` for an ordinary attendee `PRESENT`/`LATE` result;
- `AUDIO_RECAP_CATCH_UP` for a RECALL-primary result backed by the governed
  completion in spec 08; or
- `TEACHING_ASSIGNMENT` for a registered/external teacher.

The trigger requires the basis appropriate to the role and provenance. A
catch-up basis additionally requires a matching `recall_completions` row at the
current revision; a RECALL-primary attendance row cannot be inserted as live
attendance. Migration 059 backfills existing teacher rows from the former
default to `TEACHING_ASSIGNMENT`.

The trigger overwrites the certificate's `attendance_revision` with the current
session revision and normalizes recipient email. For an attendee the revision
refers to the qualifying attendance row; for a teacher it is the finalized
governance snapshot and is not an attendance claim. The trigger also rejects
future issue paths that try to bypass the service. Certificate insert appends a
`CERTIFICATE_ISSUED` activity event.

## Certificate issue paths

| Path | Authority/trigger | Recipients | Idempotency and delivery |
|---|---|---|---|
| Manual `generateCertificate` | Authenticated department moderator | One supplied registered user and role passing canonical eligibility | Reuses current `VALID` certificate for that role; renders PDF result |
| Session batch | Department moderator, ended published session, finalized attendance governance | Current-revision `PRESENT`/`LATE` non-teacher registered attendees plus accepted registered and external teachers | Role-specific reuse; teachers do not need an attendee result; external teacher delivery uses a claimed `TEACHING_CERTIFICATE` ledger row and PDF attachment; returns issued/existing/failure counts |
| Post-session job | Cron bearer secret; finalized sessions selected by report watermark | Internal `PRESENT`/`LATE` attendees excluding accepted teachers and RECALL-primary catch-up learners | Role-specific valid reuse/insert; durable claimed email delivery; watermark only after all recipients complete; catch-up delivery stays with its dedicated worker |
| Audio Recap catch-up | Perfect authenticated completion RPC, then immediate worker or `recall-awards` cron retry | Expected registered attendee changed from finalized `ABSENT` to transparent RECALL-primary `PRESENT` | Reuses/inserts one `AUDIO_RECAP_CATCH_UP` certificate; PDF email attachment uses claimed delivery; learning/attendance remains committed through provider failure |

There is no feedback-submission issue path and no teacher-feedback-release issue
path.

Manual registered generation snapshots the target profile's name/email, the
department's resolved teaching coordinators, and the moderator as issuer. It
does not use the moderator's identity as the recipient. External batch issuance
snapshots the accepted invitation name/email and moderator issuer, renders the
same branded/verified teaching PDF, and attaches it to an email because the
recipient has no authenticated download surface. Provider acceptance is stored
in `session_deliveries`; failed/stale claims are retryable, while `SENT` is not
duplicated by an ordinary batch retry. Batch errors are returned to the
moderator rather than being presented as unqualified success.

An accepted teacher is removed from the attendee-certificate recipient set, and
both application and database eligibility reject an attendee-role certificate
for that registered teacher. This prevents one session from producing both
teaching and attendee recognition for the same teacher.

The post-session job emits `attendance.computed` only for the already finalized
record and `certificate.issued` only for a new certificate. A recipient delivery
is related to the certificate id, so a replacement certificate after correction
has a distinct retry ledger. The session report watermark is not written after
any missing profile, eligibility, claim, provider, or ledger failure.

## Reopening, revocation, and replacement

When finalized attendance is reopened, a database lifecycle trigger atomically:

- changes every `VALID` certificate for the session to `REVOKED`;
- records revocation time, actor, and reason;
- clears `report_sent_at`; and
- writes certificate-reconciliation activity.

The public code remains resolvable so a verifier sees “Revoked Certificate” and
the reason rather than “not found”. Authenticated PDF download returns HTTP 410
for revoked rows. A later finalization and eligibility pass can issue a new code.

Finalization also reconciles against the resulting revision and revokes any
canonical row without matching eligible attendance. These database effects are
in the attendance lifecycle transaction.

## PDF, branding, download, and public verification

PDFs are rendered on demand as one-page A4 landscape documents. The visual
contract deliberately follows the application UI rather than accepting custom
tenant colours:

- IBM Plex Mono is loaded from the bundled application fonts;
- Petrios warm paper (`#F0EEE6`), surface (`#FAF9F5`), ink (`#1F1D1A`), and
  contrast-safe clay (`#A95134`) are the renderer tokens;
- the masthead contains the clay-block `P` and explicit `PETRIOS` wordmark;
- organization and department attribution remain visible;
- live attendee, Audio Recap catch-up, and teacher certificates use
  role/provenance-specific recognition wording;
- the lower credential area shows the snapshotted coordinator list and a
  distinct human issuer when present; and
- certificate code, issue date, and a QR verification URL remain visible.

The coordinator display stacks up to four names vertically in configured order,
without slash or comma separators, and remains isolated from the issuer and QR
regions. A missing coordinator setting is labelled “Not specified”; a
system-issued certificate without a distinct human issuer is labelled “Petrios
certificate service”. A coordinator who also issued the row is not repeated by
name as issuer; the issuer region points back to the coordinator list. Long
organization, department, session, and recipient values are bounded or
font-scaled by the renderer.

The Settings preview is moderator-authorized and renders current department
defaults with sample recipient/session content. It is not an issued certificate
and uses code `PREVIEW`. Dynamic recipient/session values in certificate email
are HTML-escaped. The legacy `pdf_storage_path` is retained but current PDFs are
normally not persisted.

Authenticated download requires current-user ownership and organization scope,
so it applies only to registered recipients. External teachers receive the PDF
attachment at generation; public verification remains available by bearer code.
`VALID` and explicitly labelled `LEGACY` rows can render for their registered
owner; `REVOKED` cannot.

`/verify/:certificateId` is public because the code is a bearer verification
identifier. It uses the certificate's coordinator snapshot (falling back to the
legacy department lead only for an unmigrated/defensive read), shows each
coordinator plus a distinct issuer, displays “Audio Recap catch-up” when that is
the recognition basis, and reports:

- green “Valid Certificate” for `VALID`;
- amber “Legacy Certificate Record” with the pre-gate warning for `LEGACY`; and
- red “Revoked Certificate” with retained reason for `REVOKED`.

Public verification proves the status of a database record on this instance. It
is not a digital signature. Federated signed teaching records are a separate
spec 09 capability.

## Failure and privacy limitations

- Accountless feedback does not verify control of the supplied email.
- Known-name stripping and welfare keyword screening cannot identify every
  sensitive or self-identifying phrase.
- The raw moderator audit remains identified and needs least-privilege access,
  retention, and incident handling.
- Report claims prevent concurrent application sends, but provider acceptance
  followed by ledger failure can still produce an at-least-once retry.
- Provider acceptance and a receipt id do not prove inbox delivery; Petrios does
  not currently ingest delivery/bounce webhooks.
- Certificate codes are public bearer identifiers and must not contain hidden
  sensitive data.
- No general retention worker currently deletes feedback, report snapshots,
  delivery ledgers, revoked certificates, or provider copies.

## Verification contract

Changes require tests or integration coverage for:

- server feedback-window endpoints and zero/null behavior;
- required fields, rating values, email normalization, answer snapshot labels,
  and duplicate submission conflict;
- confirmation that submission creates no evidence/certificate/email;
- statistics for modern and legacy answers;
- raw response-explorer search, score/written filters, score/date sorting,
  unscored ordering, expansion, empty-filter state, and pagination;
- AI identity omission, untrusted-data fencing, welfare refusal, and returned
  name stripping;
- zero-response suppression, one-to-four-response evidence warnings, and HTML escaping;
- AI non-empty-feedback enforcement, question-score prompt input, editable review-state
  invalidation, exact reviewed-narrative snapshot/reuse, content-change report
  versioning, and omission of unreviewed/no-evidence narrative;
- accepted-teacher filtering, normalized recipient de-duplication, report
  version reuse, default delivery claim/reclaim, provider error, missing
  transport/Resend receipt, partial retry, already-sent skip during first-release recovery,
  explicit repeated resend, concurrent resend suppression, preserved historical
  release status, and resend activity metadata;
- application and database certificate eligibility, including accepted teachers
  with zero attendance rows, attendee current-revision enforcement, rejection of
  duplicate teacher-as-attendee recognition, and a finalized zero-attendee batch
  remaining actionable when an accepted teacher exists;
- role-specific uniqueness, batch partial failure, cron watermark, reopen
  revocation, HTTP 410 download, public valid/legacy/revoked states, coordinator
  normalization/snapshotting, issuer de-duplication, and branded PDF generation;
  and
- stale-language searches for claims that feedback is anonymous or that
  feedback/Recall/teaching assignment proves attendance.
