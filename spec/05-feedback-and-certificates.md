# 05 — Feedback, improvement actions, and certificates

## Privacy statement

Petrios feedback entry is public and accountless, but the current implementation
is **not anonymous at collection or release**.

The submitter must provide first name, last name, and email. Those values are
stored in `session_feedback.attendee_*`; email is also used to resolve an
existing profile/user id. Moderators can inspect raw identity and answer data.
The teacher feedback email currently prints the submitter's name next to each
free-text comment.

Any UI text, prompt, or prior spec that calls the current end-to-end flow
“anonymous” is inaccurate. The on-demand AI summary omits stored identity from
its model input, and Petrios Ops performs stronger name stripping, but those
processing choices do not make the original row or teacher email anonymous.

An anonymized product promise would require, at minimum, a deliberate identity
retention model, teacher-email redaction, small-cohort rules, raw-audit access
policy, migration/backfill plan, and tests.

## Feedback form definition

Each department stores `feedback_form_fields` as a JSON array. Supported field
types are:

- `rating`: optional/required value from integer strings 1–5 plus an optional
  comment prompt;
- `text`: optional/required single text value; and
- `textarea`: optional/required longer text value.

Each normalized field has a stable unique id, label, required flag, type, and
type-appropriate prompt metadata. Invalid/missing arrays fall back to six default
fields: five required teaching-quality ratings and one optional additional
comment. Missing/duplicate ids are generated and de-duplicated during
normalization. Unknown field types fall back to `rating`; blank-label fields are
dropped. If normalization yields no fields, defaults are restored.

Only department moderators can read/edit the template management action.
Updates normalize and cap the form at 24 fields. The cap is enforced in that
action, not by a database constraint.

## Public entry points and timing

Two routes render the same form:

- `/sessions/:id/feedback` targets a named session; and
- `/departments/:id/feedback` chooses the first published department session
  active from 15 minutes before start through its feedback deadline.

The department page uses `feedback_valid_mins_after_end || 120`, so a configured
zero is treated as 120 in that selector. The session-specific page can be opened
directly.

The server `submitFeedback` action validates only that the session exists and is
`PUBLISHED`. It does **not** enforce the displayed start/end feedback window.
Consequently, a direct request can submit to any published session at any time.
There is also no uniqueness constraint or idempotency key preventing repeated
submissions by the same email/user.

The attendance-evidence computation still rejects out-of-window `FEEDBACK`
observations on recompute. A durable feedback row can therefore exist without
valid attendance evidence.

## Submission validation and snapshot

Submission requires nonblank trimmed first name, last name, and lower-cased
email. Email syntax is primarily constrained by the form control; the action
only requires a nonblank string.

The server reloads the current department template and builds a snapshot:

1. answer inputs are mapped by field id;
2. every required value is checked;
3. rating values must be one of `1` through `5`;
4. every template field is stored with id, type, label, value, comment label,
   and comment as applicable; and
5. labels are snapshotted so historical answers remain interpretable after a
   template edit.

The submission's derived rating is the arithmetic mean of supplied rating
values, rounded to the nearest integer. Derived comment is the double-newline
join of labelled free-text values and rating comments. The JSON answer snapshot
preserves the individual values used for later detailed statistics.

If a profile has the same normalized email, `user_id` is attached; otherwise
the row remains external. `is_anonymous` defaults false.

## Submission side effects and failure order

The durable feedback row is inserted first. Then two independent best-effort
effects run:

1. insert `FEEDBACK` attendance evidence for the resolved user or external email;
2. if the organization name can be resolved, create an `ATTENDEE` certificate,
   render its PDF, and email it as an attachment to the submitted email.

Evidence or certificate/PDF failure is logged and does not reject or delete the
feedback. The mail adapter returns `{ error }` for provider failure, but this
path does not inspect that result; only a thrown exception is logged. A feedback
submission can therefore report success with no delivered certificate and no
explicit provider-failure log. Certificate issuance occurs immediately, even if:

- the session has not ended;
- the feedback observation is outside the evidence window;
- attendance is locked or evidence insertion failed;
- a certificate already exists for the same recipient/session/role; or
- a department's `require_feedback_for_certificate` setting would be relevant to
  a different batch path.

The database has no general uniqueness on certificate recipient/session/role, so
repeat submissions can issue multiple durable certificates. This path is not an
attendance-eligibility guarantee; it is a feedback-triggered recognition path.

## Statistics

Feedback statistics are moderator-only because `getSessionFeedbackStats` calls
the moderator-gated raw list operation.

For each submission:

- use the unrounded mean of its rating answers;
- if there are no rating answers, fall back to the legacy stored `rating`;
- add that score to the submission-score list;
- round the submission score to the nearest integer, clamp 1–5, and increment
  the distribution bucket;
- extract rating comments and text/textarea values as labelled responses.

Overall `averageRating` is the arithmetic mean of submission scores, rounded to
one decimal; it is zero when no score exists. Question summaries group by stored
field id, average individual rating values to one decimal, and report response
and comment counts. Legacy feedback without answer snapshots appears under an
“Overall session rating” fallback.

This is a mean of submission-level means: a response answering one rating and a
response answering five ratings have equal weight in the overall average.

## Raw audit and on-demand AI summary

Department moderators can fetch a feedback audit containing stored first/last
name, email, rating, derived comment, normalized answers, and timestamp.

The “summarize feedback” control is a separate on-demand feature:

- it requires a department moderator;
- it calls `lib/ai/feedback-summary.ts` through the general `askLlm` adapter, not
  the Petrios Ops gateway;
- it sends session title, counts, ratings, and free-text comments but not the
  stored attendee identity fields;
- it returns plain text and does not store the result;
- when no provider or feedback exists, it returns a displayable error rather
  than mutating state.

Current prompt-safety limitation: comments are labelled as anonymized data, but
they are concatenated into the prompt without the explicit untrusted-data fence
and injection rules used by Ops synthesis. The model instruction says not to
attribute names, but this path does not deterministically strip names appearing
inside comment text. It must not be treated as having the stronger Ops safety
contract.

## Petrios Ops synthesis

The scheduled Ops synthesis is a different stored artifact. It performs welfare
screening on raw text, strips known and heuristic names before inference, validates
structured output, removes unsafe returned quotes, and may require human review.
It is used for thank-you/newsletter/recap workflows under the Ops specification.
It does not replace raw moderator access or automatically change the teacher
release email.

## Teacher feedback release

`releaseTeacherFeedback` is a moderator action with broad side effects.

### Teacher selection

- External teachers are restricted to `teacher_invitations.status = ACCEPTED`.
- Registered teachers are selected from every `session_teachers` row without a
  status filter. Pending and declined registered assignments are currently
  included if their profile has an email.

### Per-teacher work

For each selected teacher, the action independently:

1. inserts a new `TEACHER` certificate (no duplicate check);
2. renders a PDF certificate;
3. builds an email with total responses, average, distribution, and comments;
4. includes stored attendee first/last name next to each comment; and
5. sends the PDF attachment.

Thrown errors are caught per teacher. Adapter-reported `{ error }` results are
not inspected and are still counted as sent. Re-running the action can create
duplicate certificates and repeat email. There is no release watermark or batch
transaction.

After email attempts, it best-effort inserts `TEACHER` evidence at session start
for registered selected teachers. It then emails nonteacher attendees with
materialized status exactly `PRESENT` (not `LATE`), reusing or creating a
certificate. Those attendee emails do not attach the PDF even though the generic
email says the certificate is available in the dashboard. Finally the action
writes the session report watermark, which can pre-empt the later cron selector.

### HTML safety limitation

The core teacher feedback template interpolates teacher, session, department,
attendee name, and comment strings directly into HTML. It does not apply a shared
HTML escape function. Stored free text can therefore alter rendered email markup.
This is a known injection/sanitization gap; do not state that all Petrios email
templates escape dynamic data. Ops newsletter templates have their own escaping.

## “You said, we did”

`feedback_actions` closes the visible improvement loop without copying raw
feedback automatically.

- A department moderator creates, edits, or deletes a session-linked pair of
  `theme` and `action`.
- Both fields are trimmed, required, and capped at 280 characters by the server.
- The table uses deny-all RLS and an authorized service DAL.
- Public feedback pages display up to the latest five department actions.
- Authoring an action is a human editorial decision; AI synthesis does not
  publish one automatically.

The public output must be written as nonidentifying programme improvement, since
the source feedback may contain personal or welfare information.

## Certificate record

A certificate stores:

- organization, department, and session;
- optional `user_id` (nullable for external recipients);
- role `ATTENDEE` or `TEACHER`;
- unique 8-character human-readable `certificate_code`;
- issued timestamp;
- optional snapshotted `recipient_name`;
- optional `issued_by` and snapshotted `issued_by_name`; and
- a legacy `pdf_storage_path`, while current PDFs are normally rendered on
  demand.

The certificate code is unique, but the combination of recipient/session/role is
not. There is no revocation, expiry, invalidation status, or replacement chain.
Public “valid” means a certificate row with that code exists.

## Certificate issue paths

| Path | Actors/trigger | Eligibility actually enforced | Duplicate behavior | Delivery |
|---|---|---|---|---|
| Feedback submission | Public submitter | Published session + valid required form fields | Always attempts a new row | Email with PDF attachment |
| Manual `generateCertificate` | Any authenticated current-org caller able to read session context; no explicit moderator check | No attendance/teacher check | Always new | Returns PDF buffer to caller |
| Session batch generation | Authenticated caller; no explicit moderator check | Session ended, not cancelled; all registered teacher rows; attendees `PRESENT`/`LATE`; optional feedback requirement for attendees | Calls manual path, always new | Returns buffers; no email |
| Teacher feedback release | Department moderator | External accepted teachers; all registered teacher rows; trainee status exactly `PRESENT` | Teachers always new; attendee reuses/finds existing | Teacher PDF attachment; trainee email without attachment |
| Post-session cron | Cron secret, 24h after published session | Internal `PRESENT`/`LATE` materialized users | Checks any user/session cert first | Email without attachment; emits event only for newly created cert |

Important manual-path limitation: `generateCertificate(sessionId, userId, role)`
records the supplied target user id, but derives the rendered recipient name from
the **current caller's** auth user/email, not the target profile, and does not
pass a `recipient_name` snapshot into the insert. It also snapshots the caller as
issuer. This can produce a certificate whose target, PDF name, and public
recipient display are inconsistent.

`findCertificateByUserAndSession` uses a single-row lookup despite the absence of
a uniqueness constraint. Existing duplicate rows can make lookup-based download
or reuse fail rather than select deterministically.

## Rendering, download, and verification

Certificate PDFs are black-and-white React PDF cards with organization,
department, session, date, recipient, role, code, issuer/signatory details, and a
QR verification URL. Rendering reads current session/department names plus
snapshotted recipient/issuer where the calling path stored them; older/manual
records may fall back to current auth identity.

Download paths require authentication and enforce either current-user ownership
or an org-scoped certificate id, depending on the route/action. External
recipients generally receive their PDF through email and cannot use a self-owned
authenticated download path without a linked user.

`/verify/:certificateId` is public. It resolves the unique code and displays
recipient snapshot when present, role, session/date, department, organization,
signatories, and issued date. No login or secret beyond the code is required.
The bearer API `read:certificates` route additionally requires the certificate's
organization to match the token organization.

Certificate verification proves database presence on this instance; it is not a
digital signature and does not prove that attendance or teacher eligibility was
correctly evaluated at issue time.

## Required change checks

- State whether feedback is identified, pseudonymous, or anonymous at storage,
  moderator view, AI input, teacher release, and public output separately.
- Enforce feedback windows on the server if they are a product rule.
- Add idempotency/uniqueness before promising one response or certificate.
- Keep form labels in answer snapshots so history survives template changes.
- Treat free text as untrusted in prompts and HTML; escape output at the template
  boundary.
- Filter teacher status explicitly in every issue/release path.
- Define one canonical certificate eligibility service before adding new issue
  paths.
- Decide revocation and correction semantics before calling public verification
  authoritative.
- Test side-effect ordering and partial failure, not only the happy-path PDF.
