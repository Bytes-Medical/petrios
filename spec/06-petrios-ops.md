# 06 — Petrios Ops and AI-assisted operations

## Scope

Petrios Ops is an additive organizer-facing layer for feedback synthesis,
speaker follow-up drafts, moderator-triggered departmental newsletters, an
assistant, Recall drafting, and approved audio recaps. Its code is concentrated
in `lib/ops/`, `lib/db/ops*.ts`, `app/actions/ops*.ts`, the `/ops` pages, two Ops
cron routes, and `ops_*` tables. `audio_recaps` is a related, separately named
table with its own human approval state.

Ops reads core teaching data but does not own core sessions, attendance,
feedback, membership, documents, or certificate state. `lib/db/ops-reads.ts` is
read-only over those core tables. Curriculum mapping is retired from active Ops
behavior; its historical tables remain in place only for migration safety.

## Hard invariants

### 1. No Ops email before human approval

Every Ops-originated email is represented by an `ops_pending_actions` row whose
payload contains the exact recipient/content or newsletter issue. A human Ops
manager must approve that row. Only `lib/ops/executors.ts` sends Ops email.

Crons and the assistant can create drafts; they cannot send. Adding an outbound
Ops capability requires a new validated pending-action type and executor branch,
not a direct email adapter call.

This boundary applies to the **Ops subsystem**. Core deterministic flows—auth
links, onboarding, teacher invitations, slot offers, session reminders,
certificates, and Recall emails—are independently specified and are not routed
through `ops_pending_actions`.

### 2. Tenant and actor scope precede model input

Interactive Ops actions call `requireOpsManager`: authenticated user, current
organization, and organization-manager authority. An organization manager is a
super admin, organization admin, or department admin in the organization.

The assistant's tool context receives `orgId` and `userId` from that gate. No
tool accepts a model-selected organization id. Cron jobs enumerate organizations
from storage and carry the selected row into each operation.

### 3. Teaching quality, never individual trainee evaluation

Prompts and tool shape limit Ops to programme operations and teaching quality.
Assistant attendance tools expose aggregate counts only. Ops must not rank,
score, summarize, message, or infer the competence, performance, engagement, or
welfare of an individual trainee.

Raw welfare/conduct signals are routed to human review rather than summarized
into automated insights or newsletters.

### 4. Feedback is untrusted model data

Ops synthesis fences feedback as data, tells the model never to follow embedded
instructions, strips names before inference, validates structured output, and
sanitizes returned text. A synthesis is a stored artifact only; it never invokes
tools itself.

### 5. Inference is purpose-gated and audit-aware

Ops model requests use `opsInference`, except the assistant tool loop which must
preserve the raw tool-call message protocol. Speech requests use only
`lib/ai/tts.ts`.

### 6. Kill switch

`opsEnabled()` is false only when `OPS_ENABLED` is the exact lowercase string
`false`; unset and every other value enable Ops.

When false:

- Ops cron routes return a skipped result;
- the gateway throws before inference;
- chat and action execution refuse;
- audio recap generation, editing, synthesis, approval, metadata delivery, and
  streaming are unavailable (streaming returns 404); and
- the UI presents a disabled state.

Historical overview/run/queue reads can still be available, and rejecting a
pending action does not execute an outbound capability. The precise guarantee is
that disabling halts AI/automation/outbound Ops execution, not that the database
becomes unreadable.

## Inference gateway

`opsInference` accepts only these purposes:

| Purpose | Current use |
|---|---|
| `feedback_synthesis` | Structured, safety-processed session feedback artifact |
| `email_draft` | Optional wording for speaker/thank-you drafts |
| `newsletter` | File-backed, structured one-page departmental weekly draft |
| `low_score_digest` | Reserved/available Ops purpose |
| `recall_questions` | Five-question, spoken-script-bound Audio Recap mastery draft |
| `audio_recap` | Spoken recap script draft |
| `assistant` | Assistant audit purpose |

The gateway:

1. checks kill switch and purpose;
2. returns null without a configured model provider;
3. hashes `system + NUL + prompt` with SHA-256;
4. calls the shared LLM adapter, passing the purpose's effort
   (`OPS_PURPOSE_EFFORT`: low for `email_draft`/`low_score_digest`, medium for
   `feedback_synthesis`/`newsletter`/`recall_questions`/`assistant`, high for
   `audio_recap`; a caller's explicit effort wins; the OpenAI adapter ignores the
   default so its requests are unchanged);
5. when a schema is supplied, adds a JSON-only instruction (the OpenAI adapter
   also requests JSON mode; Anthropic relies on the instruction plus validation);
6. extracts the first object/array from a response and validates with Zod;
7. on invalid output, retries once with the validation error;
8. returns null after refusal, provider failure, or a second invalid output; and
9. logs through the optional run without storing raw prompt text: the served
   model (a refusal fallback can differ from the configured one), the prompt
   hash and token counts (Anthropic input includes cache reads/writes and every
   attempt in `usage.iterations`). A failure is logged as error class, status,
   API error type and request id; an unreadable/unparseable response stream is
   logged only as `unreadable_response` because the SDK's message can quote
   model output.

Callers must treat null as “skip/retry later,” not as permission to use a partial
parse. The gateway throws only for programmer misuse such as disabled Ops or an
unknown purpose.

### Run audit

`startRun(kind, trigger, orgId?)` creates `ops_agent_runs` and returns monotonic
in-process step logging. Each model step can store purpose, model, prompt hash,
input/output token counts, name, and sanitized error detail. General steps store
structured details. Logging and finish updates are best-effort so telemetry does
not halt the work.

Global cron runs may have `org_id = null`. The current run-detail authorization
allows an organization manager to read a null-org run. Step detail must therefore
never include prompt text, email bodies, feedback text, secrets, or unnecessary
cross-organization personal data.

On-demand non-Ops `summarizeSessionFeedback` does not use this gateway or run
audit; it is specified in spec 05. It creates an editable draft from any
non-empty feedback set. A separate authenticated moderator release
snapshots the exact reviewed text before core email delivery, so inference alone
has no outbound capability. Audio recap generation uses the gateway but does
not currently pass an `OpsRun`, so it has purpose enforcement without a stored
inference step.

## Safety-processed feedback synthesis

For one session:

1. load raw feedback and known names (feedback submitters, registered teacher
   profiles, accepted external teachers);
2. scan raw free text for deterministic welfare/conduct patterns **before**
   redaction;
3. strip known names and capitalized name-like pairs from text;
4. fence responses in an untrusted-data block and request structured themes,
   sentiment, suggestions, quotes, and review flag;
5. validate the model response;
6. strip names again from every output field, drop welfare-signal quotes, and
   force `requires_human_review` when the pre-check fired; and
7. insert the unique per-session synthesis.

Name stripping intentionally over-redacts and is not proof of anonymity. If the
review flag is true, automated thank-you insights are not drafted and assistant
tools return only the review warning. Newsletters do not consume feedback or
synthesis rows at all. Moderators are directed to the raw feedback surface.

## Approval state machine

Pending actions carry type, tenant/department, structured payload, preview title,
preview body, creator, reviewer, timestamps, and error/status state.

```text
pending --approve CAS--> approved --executor success--> executed
   |                         |
   +--reject CAS--> rejected +--executor error--------> failed
```

Approval and rejection update only a row still in `pending`, so two reviewers
cannot both claim it. Approval then executes synchronously. An execution failure
does not return the row to pending; it records `failed` and reports “approved,
but execution failed.” There is no automatic retry action.

Implemented action types:

- `SPEAKER_CHASE_EMAIL`: send payload, then increment/create chase record;
- `THANK_YOU_EMAIL`: send exact payload;
- `CUSTOM_EMAIL`: assistant-proposed exact payload; and
- `NEWSLETTER_ISSUE`: fan out one exact reviewed issue revision to eligible
  current members of its department, excluding organization-level opt-outs.

Newsletter approval is initiated from the issue editor. The server first saves
the exact current editor content, creates the pending row with `issueId` and
`contentRevision`, immediately records the authenticated moderator's explicit
approval, and invokes the same sole executor. The executor refuses a stale
revision, a cross-organization/department action, or a legacy organization-wide
issue. It then starts delivery with a compare-and-set
(`beginNewsletterExecution`): only the reviewed `content_revision`, only from
`draft`/`failed` or from an `approved` execution whose ten-minute lease
(`updated_at`) has expired, moves to `approved` and links the action. A miss
means another execution holds the lease or the content changed after review,
and nothing is sent. The executor sends from the row that CAS returned, never
from its earlier read. Save and regenerate only touch `draft`/`failed` issues,
so they cannot change an issue while it is being delivered.

Each audience member has one `ops_newsletter_deliveries` row per issue. Claims
move `PENDING`/`FAILED` (or a stale ten-minute `SENDING` lease) to `SENDING`;
the claim function is not `SETOF`, so a missed claim is an all-NULL composite
that the DAL treats as "not claimed" (no send). Completion is bound to that
claim (`status = 'SENDING'` and the claimed `attempt_count`) and stores `SENT`
with provider id or `FAILED` with a sanitized error (no recipient addresses,
at most 300 characters). An email the provider accepted is never downgraded to
`FAILED`: if both attempts to record `SENT` fail, the row stays `SENDING` under
its lease. Each send carries a provider idempotency key
(`ops-newsletter/<delivery id>/<revision>`; Resend deduplicates for 24 hours),
so a later resend of that row is not delivered twice (SMTP has no equivalent).
Each send carries the stored HTML and a text/plain part rendered once per
execution, before any delivery row is seeded, purely from the stored issue —
the reviewed content and its render snapshot, including the snapshotted
organisation and department names (`buildNewsletterText`; nothing is re-read,
so a rename after approval cannot split the two parts and a retry of a
revision sends identical bytes under its idempotency key); the placeholder is swapped for the recipient's
unsubscribe page URL in **both** parts. A legacy issue without a snapshot is
sent HTML-only. The approval row's preview body is the same plain text (with
the placeholder shown as “[personal unsubscribe link]”).
Sends are paced at least 500 ms apart; an HTTP 429 is retried up to twice after
`Retry-After` (at most 5 s) before the row is recorded `FAILED`. One request
stops starting sends after four minutes or about 3,000 estimated subrequests
(inside the ten-minute lease); the rest stay `PENDING`.

Any unfinished row marks the issue `failed` with `sent_count` recounted from the
ledger, and the action `failed`; this includes the missing-email and
no-eligible-recipient refusals and any unexpected error after the start CAS. A
moderator can retry (“Retry unfinished delivery”), which is refused while a
recent execution still holds the lease, and already `SENT` rows are never
emailed again. Editing and regenerating are locked when the issue has
`sent_count > 0` **or** any `SENT`/`SENDING` ledger row (a cut-off run), so one
issue cannot deliver different content to different members. A wholly sent
issue is guarded against double execution.

### Dates in Ops output

`lib/ops/format.ts` formats instants in `APP_TIME_ZONE` (default
`Europe/London`; spec 07): `formatDateTimeShort` (list rows and pending-action
labels; `PendingActionsPanel` passes the server zone as its `timeZone` argument), `formatSessionDateLabel` (session dates in drafts) and `formatDateLong`.
Chase, thank-you, newsletter and Recall outputs therefore show UK wall-clock
times on a UTC server. The newsletter renderer takes the zone as an explicit
argument and formats session times with `formatInAppTimeZone`; its “Week
commencing” and “W/C” labels format the UTC calendar key in UTC, because
newsletter weeks are UTC Monday–Sunday windows (`formatDayKeyLong` does the same
for other callers). Client panels that use these helpers resolve the default
zone in the browser.

## Weekly Ops job

`GET /api/cron/ops-weekly` requires `Authorization: Bearer CRON_SECRET`, checks
the kill switch, creates one global run, and performs two passes.

### Speaker chase drafts

Candidates are published sessions starting within 21 days with no accepted
registered or external teacher. For each pending registered/external invitee:

- use the dashboard response URL for registered teachers and RSVP capability URL
  for external teachers;
- skip when recorded chase count is at least two;
- skip if an equivalent pending chase action already waits for that
  session/email; and
- create at most 10 draft actions across the invocation.

Draft wording has deterministic fallbacks when model drafting is unavailable.
The chase count increments only after an approved email sends.

Current limitation: `CHASE_SPACING_DAYS = 5` exists and comments claim five-day
spacing, but the weekly job does not inspect the last-sent timestamp. It enforces
the maximum count and pending-action dedupe, not elapsed spacing.

### Low-score internal alert

For sessions ending in the last eight days, at least three stored ratings and an
average below 3.5 cause an in-app notification to department moderators. It is
an internal signal, not email, so it is not pending-action gated.

The eight-day window intentionally overlaps a weekly schedule, but there is no
notification uniqueness/watermark. The same session can alert again on a later
invocation within the window.

## Daily synthesis and Recall-draft job

`GET /api/cron/ops-synthesis` requires cron auth and considers published sessions
ended 2–45 days ago.

With Anthropic as the provider, every `ops-synthesis` run — including one whose
synthesis work or audit-run creation failed — ends with a best-effort sweep of
Files API uploads named `petrios-ai-*` older than 2 hours (≤200 deletions, ≤2,000
files scanned); only counts are logged. The sweep does not run when the kill
switch stops the job before it starts.

### Synthesis/thank-you branch

- Exclude sessions already in `ops_feedback_syntheses`.
- Keep sessions with any feedback row.
- Process at most five.
- Store the synthesis when valid.
- For review-flagged synthesis, notify department moderators and draft no email.
- Otherwise resolve accepted registered and accepted external teachers,
  deduplicate external against registered email, and queue one thank-you draft
  per teacher.

Thank-yous are naturally drafted once because they are created only in the pass
that inserts the unique synthesis. A model failure leaves no synthesis and the
session remains eligible.

### Recall branch

The cron retains a compatibility branch for up to five candidate sessions, but
question drafting now requires an existing Audio Recap script/digest and uses
that spoken material to produce exactly five questions. The primary path runs
immediately after a moderator successfully generates or regenerates the recap
script. There is deliberately no deterministic fallback. A question failure
does not discard the successful recap; successful drafts remain inert until
moderator review/publication. Immutable question revision, delivery, playback,
attempts, and catch-up attendance are in spec 08.

## Moderator-triggered departmental newsletter job

There is no newsletter cron. `/ops/newsletters` is a workspace for organization
admins, super admins, and department admins. Organization/super admins may select
any current-organization department; department admins see only departments they
moderate. Every generation/save/send action repeats the server-side department
moderator authorization check.

### Window and source completeness

The moderator selects a UTC Monday–Sunday week that has started, no more than
one year (366 days) old. Generation selects **every `PUBLISHED` session in the
department whose `date_end` is in `[weekStart, min(weekStart + 7 days, now))`**
(`WeekWindow.coverEnd`, `loadNewsletterWeekSessions`): a mid-week draft covers
only sessions that have already ended, so later sessions and their documents
are never sent to the provider or described as delivered, and the draft stays
regenerable until sent. An empty window is rejected. The job caps a week at 50
sessions (it reads 51 rows) so it never silently truncates a larger set.

For those sessions the job selects every `AVAILABLE` `session_documents` row,
including PDF, DOCX, and PPTX. It rejects more than 50 files or more than 50 MiB
combined. A missing stored digest fails before inference. Every selected object
is then streamed one at a time from the private service DAL
(`fetchDocumentObject`) into the provider (Anthropic: one Files API upload per document, DOCX/PPTX as extracted text, all deleted when the generation ends; OpenAI-compatible: one streamed request body); its stored
byte count and SHA-256 are verified incrementally, and a mismatch errors the
upload (Anthropic) or the request body (OpenAI-compatible) before it is
complete, so no output is accepted (spec 04 describes the per-provider detail). A missing
object or an integrity mismatch fails the whole generation with the original
storage or integrity message: because the gateway converts provider failures to
null, the job rethrows the recorded source failure after inference
(`throwIfSourceFailed`). The gateway also records that failed step with its error
message, which names the document, as for any provider failure. The
schema-repair retry re-reads (and on Anthropic re-uploads) every object from storage. A week with sessions but
no documents is allowed: trusted session title/date/description metadata remains
the available source. No material is silently omitted.

The inference request supplies a trusted manifest tying opaque provider
filenames to session ids/titles/dates plus the corresponding private file bytes.
Session descriptions and file content are explicitly fenced as untrusted data,
not instructions. The model must not introduce patient/person identifiers,
learner evaluation, feedback claims, clinical claims absent from the materials,
or outside research. The newsletter purpose is the second allowed private-file
gateway path alongside `audio_recap`.

### One-page draft contract

Generation asks for structured JSON containing subject, introduction, exactly
one section per selected session, at most three learning points per section,
and a closing. The dynamic Zod validator (`newsletterSchemaForSessions(ids,
sessionsWithDocuments)`) requires every trusted session id exactly once, rejects
unknown/duplicate/omitted ids, and limits the complete artifact to 700 words.
**Honesty rule:** a session with at least one uploaded teaching file needs one
to three learning points; a session with no file may have none, because its
points could only restate the description. The prompt says: “For a session with
no uploaded file, return an empty learning_points array unless the description
itself states the points; never infer clinical guidance from a title.” The base
`NewsletterSchema` allows zero to three points; the per-session minimum is the
`superRefine`. Trusted session title/date replace model-returned labels after
parsing. The saved source snapshot contains session ids and document id/session
id/name/MIME/byte-count/SHA-256 metadata, never document bytes.

### Render snapshot (`content.render`)

The moderator approves the exact stored HTML, so everything the template shows
beyond the AI/moderator narrative is captured **once, at generation**, by
`loadNewsletterRenderContext` (`lib/ops/newsletter-context.ts`) and stored with
the issue as the server-owned `content.render` key
(`NewsletterRenderContextSchema`, version 1; no migration — `content` is JSONB):
the organisation name (`findOrganizationName`, “Petrios” when unset) and
department name (both at most 200 characters), each covered session's start/end (UTC ISO), location type, accepted teacher
names (registered profile full name, else first + last; then accepted external
invitations' first + last; deduplicated case-insensitively; never an email
address; at most eight, 120 characters each), an approved Audio Recap's
duration (`audio_recaps.status = 'approved'` with audio, 1–3,600 s) or null —
only while the recap is **source-current**, the same rule the session page uses
before it shows the player (`recapSourcesAreCurrent`: its stored
`source_digest` equals `buildRecapSourceSnapshot` of the session's current
documents, taken from the generation's own `listSessionDocumentsAsSystem`
source snapshot, and the session has at least one document), so the email never
advertises a recap the page hides — the
department's teaching coordinators (configured order, at most four), and the
“Coming up” board: up to six PUBLISHED sessions of **this department** starting
in `newsletterUpcomingWindow`: from `APP_TIME_ZONE` local midnight on the Monday
after the newsletter week (or `now`, if later) to local midnight seven calendar
days after that start's local day (`appWallClockToIso`/`appDayKey`), so the
rendered range is exactly seven days in BST, GMT and across a clock change
(“12–18 OCT”, never “12–19 OCT”), with their accepted teacher names, plus
`more`, the exact count of further matches (PostgREST `count=exact`). All reads
are service-role SELECTs in `lib/db/ops-reads.ts`
(`listAcceptedTeacherNamesForSessions`, `listDepartmentSessionsStartingInWindow`),
`lib/db/audio-recaps.ts` (`listApprovedRecapDurations`: session id, duration
and source digest, never the audio), `findDepartmentSettings` and
`findOrganizationName`, run in one staged `Promise.all` after the
moderator checks. Snapshot session keys must equal the covered session ids
(asserted in the loader and again by the renderer). The newsletter never reads
attendance, feedback, reflections, certificates or assessment data; a test
scans the renderer and loader imports and the loader's DAL calls.

The model never sees or produces `render`, and `NewsletterSchema` strips it from
client submissions: `normalizeNewsletterEdit` always restores the stored
snapshot, so a crafted client cannot change dates, teachers, recap state or the
upcoming list. Saving re-renders from the stored snapshot without re-querying,
and sending never re-reads it. A recap approved after drafting appears only
after **Regenerate**. A legacy draft without a snapshot cannot be saved in the
new design (an expected error asks the moderator to regenerate it); a legacy
issue already approved keeps its stored HTML and is sent HTML-only.

### Email renderer (“Monitor strip”)

`lib/ops/newsletter-render.ts` (`renderNewsletterEmail`) is pure — no `lib/db`,
no `process.env`, no clock — and runs unchanged on Node and Workers. It takes
`appUrl` (`getAppUrl()`), `timeZone` (`appTimeZone()`), organisation and
department names (copied from the snapshot by `newsletterRenderInput`; a
snapshot without them asks for **Regenerate**), the department id, the issue's `week_start`, the narrative,
`source_documents` (session id + MIME type) and the render snapshot, and returns
`{ html, text, layout }`. `buildNewsletterHtml`/`buildNewsletterText` in
`lib/ops/newsletter.ts` wrap it. The HTML is a complete email document: a dark
monitor masthead with the HUD ECG trace rasterised into table cells (Outlook
desktop gets a flat wide-cell masthead in an MSO conditional instead, with no
cell narrower than 8 px), the readouts **Sessions**, **Hours** (Σ session length,
one decimal), **Files** and **Teachers** (distinct names, case-insensitive), then per session a date
tab, linked title, “With …” teachers, format and file-count chips (a dashed
**Description only** chip without files), the overview, key points (headed
**Key points**, or **From the session description** for a no-file session), a
“Listen to the Audio Recap” bar linking `/sessions/{id}#recap` only when the
snapshot has an approved recap, and a provenance line (“Drawn from N teaching
files (…)” or “Drawn from the session description only. No teaching files were
uploaded.”). Then the “Coming up” board (Lightning tag for ≤ 20-minute sessions,
“+N more in Petrios”, “Times can change. Petrios always has the latest.”), the
closing with “Next on the board”, the coordinator sign-off, an “Open this week
in Petrios” button, and a footer stating the digest contains no attendance,
feedback or assessment data, with the unsubscribe link. No images, SVG,
`data:` URIs or web fonts; dark mode, mobile and Outlook.com rules live in
`<head>` styles. Times are formatted with `formatInAppTimeZone` in the passed
zone; the week labels are UTC (newsletter weeks are UTC calendar keys). Month
abbreviations come from a fixed three-letter table (`SEP`, never en-GB ICU's
“Sept”).

Layout tiers step down toward `NEWSLETTER_HTML_BUDGET_BYTES` (60 KiB, UTF-8
via `TextEncoder`): `full` cards for ≤ 6 sessions, `compact` rows (overview, no
key points) for 7–20, `index` rows above 20; a tier over budget steps down, and
`index` is final and may exceed the budget. Index rows show the when, the
linked title shortened to 90 characters and at most two teachers plus “+N”.
Only if the index HTML would pass `NEWSLETTER_HTML_HARD_LIMIT_BYTES` (96 KiB,
below Gmail's ~102 KB clip with headroom for the per-recipient unsubscribe
URLs) does it list the most sessions that fit (at least one) followed by “+N
more sessions this week in Petrios” (linking the department's past sessions),
so the footer and unsubscribe link are never clipped; schema-maximum input in
3-byte characters is tested. The text/plain part always lists every session
with full titles and teacher names. The workspace recovers the
tier from the stored HTML (`newsletterLayoutOf`) and shows it as “Full cards”,
“Compact rows (key points in Petrios)” or “Index (overviews in Petrios)”.

Escaping: every dynamic string (AI, moderator, session record, profile name)
goes through `escapeHtml` in text and attributes, including `<title>` and
`aria-label`; no dynamic value is placed in a style attribute, CSS, an HTML
comment or an MSO conditional. `escapeHtml` also encodes `%` (`&#37;`), so no
dynamic text can spell the executor's per-recipient `%%UNSUBSCRIBE_URL%%`
placeholder. Links are built only from the app origin and UUID ids (a non-UUID
id throws). The text/plain part (72 columns) gets no HTML escaping; control
characters are stripped and `%%` in dynamic text becomes `% %` before the
`Unsubscribe: %%UNSUBSCRIBE_URL%%` line is appended. “One page” means this
constrained, scannable email format and word cap; email clients and print
settings can still paginate differently.

One active issue is keyed by `(org_id, department_id, week_start)`; two
concurrent first generations for the same week return “Another moderator
generated this week” instead of a raw unique-violation. Generating again
replaces only an unsent draft/failed issue (not one being delivered, partially
delivered, or sent; refused before the AI run starts), with a compare-and-set on
the revision it read; the revision **increases** (it never resets), so a browser
tab holding an older revision fails the save CAS instead of overwriting the
regenerated draft. Obsolete `PENDING`/`FAILED` delivery rows are removed.
The editor exposes all narrative fields, live word count, saved HTML preview, and
the exact source-document list. A session with teaching files always keeps at
least one key point (its last point cannot be removed); a no-file session's
points are optional and headed “From the session description”. The preview
renders the exact stored `issue.html` (the bytes the executor sends, with only
the placeholder swapped) in an iframe with `srcDoc` and
`sandbox="allow-popups allow-popups-to-escape-sandbox"` (no `allow-scripts`, no
`allow-same-origin`; `newsletterPreviewDocument` adds only a `<base
target="_blank">` so links open outside the frame and a rule hiding the frame's
scrollbar so a classic scrollbar cannot narrow the viewport below the email's
600 px breakpoint), so the email's `<head>` styles neither leak into the app nor
get lost. The frame is sized by its content box (`newsletterPreviewFrameStyle`:
`box-sizing: content-box`), because Tailwind's preflight makes every element
border-box and the frame's 1 px border would otherwise give a 598 px viewport
and the phone layout under “Desktop 600”.
A 600 / 375 px toggle shows the desktop and phone layouts. Session identity/title/date labels remain bound
to the generated trusted snapshot even if a crafted client submits alternatives.
Save uses compare-and-swap on
`content_revision`; stale browser tabs are rejected. Every save revalidates exact
session coverage and the 700-word limit (`normalizeNewsletterEdit`), rebuilds
escaped HTML, increments the revision, and resets status to draft. Saving or
editing after any recipient delivery (or while a `SENDING` row exists) is
forbidden. The editor is keyed by the stored revision and `updated_at`, so a
save, regenerate or failed send that changes the issue resets its local content
and revision; “Approve & email” reports the saved revision even when delivery
then fails.

Generate, save, approve and retry return `{ ok: false, message }` for expected
outcomes (`NewsletterUserError`: empty or oversized week, document limits or
integrity failure, provider failure, stale tab, in-progress delivery, missing
member email, partial delivery) because Next masks thrown Server Action
messages in production (spec 07); the workspace shows the message in an alert.
Unexpected errors still throw. The workspace always lists `approved`/`failed`
issues, however many newer weeks exist, so an unfinished delivery stays
reachable.

### Review, audience, and delivery

Generation and save never send email. “Approve & email” is the explicit human
review event described in the approval state machine. The pending action binds
the exact saved issue revision; the executor checks that binding before any
recipient claim.

Audience membership is evaluated at every execution, including retries, not at
generation: every current `department_members.user_id` joined to an
email-bearing profile (members paged, profiles looked up 100 at a time), minus
users in the organization-level `ops_newsletter_optouts` set (queried only for
those candidates). A second account sharing an address is not emailed twice.
Before any send, unsent ledger rows for members who left, opted out, or changed
address are removed and current rows re-seeded, so a retry never emails someone
the rule now excludes and never uses a stale address. Missing profile email
fails the execution instead of silently dropping a member; an empty audience
also fails (nothing is marked sent). Delivery uses the per-recipient retry
ledger described above; the issue stores the number of successful sends, and
the UI offers “Retry unfinished delivery” after a partial failure without
duplicating successes.

Each email carries a user-bound HMAC unsubscribe link (keyed by the service-role
key, so rotating that key invalidates links already sent) and RFC 8058
`List-Unsubscribe` / `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
headers. The public page `/ops/unsubscribe/[token]` never changes state on GET,
because mail link scanners fetch every URL: it shows the current preference and
records the organization-wide opt-out (or a resubscribe) only from an explicit
form post (`app/actions/newsletter-unsubscribe.ts`). Mailbox providers'
one-click POST goes to `/ops/unsubscribe/[token]/one-click`, which requires the
`List-Unsubscribe=One-Click` body. Both paths are public in `proxy.ts`.

## Organizer assistant

**Disabled by default.** `opsAssistantEnabled()` (`lib/ops/flags.ts`)
requires an explicit `OPS_ASSISTANT_ENABLED=true` opt-in per deployment,
on top of `OPS_ENABLED` — free-form chat with tool access carries its own
risk surface and needs its own safety review before exposure. While off:
every `app/actions/ops-chat.ts` action throws, `/ops/assistant` returns
404, and the "Open Assistant" button is not rendered. The scheduled chase and
synthesis pipelines and the separate moderator-driven newsletter workspace are
unaffected.

`/ops/assistant` persists threads/messages for the owning organizer. Each user
turn starts a run and invokes the tool loop with `ASSISTANT_SYSTEM_RULES` plus
`PLATFORM_KNOWLEDGE`; update that knowledge when platform behavior changes.

The loop has a maximum of 8 model iterations (Anthropic: 16,384 max tokens per turn at effort medium; OpenAI adapter: 4096 completion tokens). It executes every tool call returned in an iteration, truncates
serialized tool result content to 20,000 characters, records a success/failure
trace, and supplies a tool response for each requested call. Refusal/content
filter produces a generic refusal; reaching the cap asks the organizer to
continue.

The assistant's direct provider call is the sole sanctioned model caller
outside `lib/ai/llm.ts`. On Anthropic it streams the beta Messages endpoint with
refusal fallbacks, strict tools (when the schema allows), automatic tool choice
and no `thinking`/prefill; assistant content (including thinking) is echoed
unmodified and all tool results return in one user message. Refusal, truncation
and a full context window end the turn with a fixed message before any tool
runs; `pause_turn` continues; an unreadable response is retried at most twice and
never quoted. It logs model/prompt hash/token metadata without raw history.

### Tool registry

| Tool | Access/effect |
|---|---|
| `sessions_list_upcoming` | Read published upcoming sessions, caller org |
| `sessions_get` | Read one org session and registered/external invite status |
| `sessions_list_unconfirmed_speakers` | Read sessions with no accepted teacher |
| `feedback_stats_for_session` | Aggregate rating counts/distribution |
| `feedback_low_scoring` | Aggregate low-scoring session list |
| `synthesis_get_for_session` | Safe stored synthesis or human-review warning |
| `attendance_summary_for_session` | Aggregate attendance statuses only |
| `slots_list_open` | Read open organization slots |
| `memory_list` | Read up to 20 organizer memory rows |
| `memory_save` | Upsert short organization-scoped note |
| `comms_propose_email` | Insert `CUSTOM_EMAIL` pending action only |

Read results are generally capped at 20 rows. Tools expose operational names and
invite statuses where needed for organizer work, but no per-trainee performance
tool exists. Session rows carry the UTC `date_start` plus a `date_label` in
`APP_TIME_ZONE` with the zone abbreviation (e.g. "Friday, 9 October 2026 at
16:15 BST"), so the assistant quotes local wall-clock times.

## Audio recaps

Audio recap is a moderator-approved artifact, not an automatic email action.
Its management card is colocated with Recall questions and retention analytics
on the session manage **Recall** tab. When enabled, Audio Recap is the first
card, ahead of Recall Questions and Retention Analytics; it is not part of the
Feedback tab.

1. A moderator requests a script; no automatic job sends document content to AI
   or starts research.
2. The action requires at least one currently available private session
   document, caps their combined decoded size at 50 MiB, and streams them one at
   a time from the authorized service DAL into the provider (Anthropic: one Files API upload each; OpenAI-compatible: one streamed request). Stored byte
   counts and SHA-256 are verified incrementally; a mismatch or storage failure
   aborts the incomplete request, and the action rethrows the original message
   (`throwIfSourceFailed`; see spec 04).
3. `generateRecapScript` calls gateway purpose `audio_recap` with the session
   title as context and PDF/DOCX/PPTX content as the primary learning evidence (on Anthropic, DOCX/PPTX as extracted text). It
   does not use description, tags, or feedback synthesis. The prompt treats file
   content as untrusted reference data, refuses meta-instructions, and prohibits
   invented medical content, patient-specific advice, and patient/person
   identifiers.
4. The prompt targets 650–800 words—approximately five minutes at a normal
   spoken pace. It asks for a natural sequence covering orientation, the
   document-led teaching in depth, directly relevant researched context,
   practical takeaways, and concise reinforcement. It prohibits padding,
   headings, spoken URLs, citation markers, and a spoken bibliography.
5. Research uses the provider's hosted search restricted to an allow-list.
   Anthropic: `web_search_20260209` with `allowed_callers: ['direct']`,
   `max_uses: 6` and approximate location GB; forced tool choice is not
   available, so a fixed system instruction requires a search before writing.
   OpenAI-compatible: one hosted `web_search` tool with `tool_choice: required`,
   medium search context, approximate country `GB` and external web access. The
   allow-list is: `nice.org.uk`, `nhs.uk`, `england.nhs.uk`, `gov.uk`,
   `rcpch.ac.uk`, `rcplondon.ac.uk`, `resus.org.uk`, `who.int`,
   `pubmed.ncbi.nlm.nih.gov`, `ncbi.nlm.nih.gov`, `cochranelibrary.com`,
   `bmj.com`, `thelancet.com`, `jamanetwork.com`, `ema.europa.eu`, and
   `medicines.org.uk`. Changing that list is a clinical-quality and privacy
   review decision, not a presentation-only change.
6. Research is supplementary. Documents must determine the topic, structure,
   and clear majority of the spoken material. Research may add current guidance,
   definitions, safety context, or high-quality evidence. It must not silently
   contradict or supersede the learning material; a material conflict is stated
   neutrally for the moderator. The moderator approval gate remains the clinical
   quality control and the output is not patient-specific medical advice.
7. Anthropic: documents are referenced by Files API `file_id` (PDF bytes;
   DOCX/PPTX as extracted text, see spec 04), uploaded with an opaque name and a
   one-hour expiry and deleted in `finally`. The request runs at effort `high`
   and resumes `pause_turn` (at most 5 times). The script is the text after the
   turn's last search result (notes written before or between searches are
   dropped). Sources come from `web_search_result_location` citations on every
   text block, then search results; only allow-listed HTTP(S) hosts survive,
   de-duplicated by normalized URL, at most 20 URL/title pairs; `cited_text` and
   encrypted fields are never stored. Generation fails unless at least one search
   completed (usage counter or result blocks, whichever is larger — after a
   refusal fallback the declined attempt's searches stay in the content) and at
   least one allow-listed source was returned. Web search disabled for the
   workspace, or a Console domain list excluding a recap domain, returns 400.
   OpenAI-compatible: `<OPENAI_BASE_URL>/responses`; PDFs use automatic
   text/page-image processing; DOCX/PPTX yield text only. The request includes
   `web_search_call.action.sources`; the adapter also reads message
   `url_citation` annotations, accepts only HTTP(S), de-duplicates by normalized
   URL, and keeps at most 20 URL/title pairs. Generation fails if required search
   returns no verifiable source. The request body is streamed with chunked
   transfer encoding and refuses redirects (`redirect: 'error'` on Node;
   `'manual'` on Workers, where a 3xx then fails as a non-2xx response). A custom
   provider must support Responses file inputs sent as a chunked body at its
   final URL and hosted web search; Chat Completions or file-input compatibility
   alone is insufficient.
8. The script is capped at 7,000 characters and upserted as `draft` with the
   serving model, the exact sorted document metadata/digest, research URL/title list, and
   `research_performed=true`, plus SHA-256 `script_digest`. A regenerated script
   clears old audio/approval and immediately attempts a five-question draft
   bound to that digest. Legacy rows have no citations/digest and
   `research_performed=false`; they cannot power current catch-up.
9. Research citations are available in collapsed-by-default native disclosure
   sections in the moderator panel and beside the approved attendee player. The
   collapsed summary always shows the source count; expanding reveals the
   clickable links. They are generation-time pointers for review, not archived
   copies: public page bodies are not stored and external changes do not
   automatically stale the recap. Document-source changes do stale it.
10. The moderator may edit only a draft. Editing recomputes `script_digest`,
    clears audio so speech can never be stale relative to text, and attempts a
    replacement five-question draft. A question-provider failure preserves the
    script edit but leaves older questions digest-mismatched and unpublishable;
    saving again retries.
11. `lib/ai/tts.ts` is the only speech-provider boundary. `TTS_PROVIDER` can pin
    `openai` or `elevenlabs`. When it is unset, declaring either ElevenLabs
    credential selects ElevenLabs; otherwise `OPENAI_API_KEY` selects OpenAI
    (the historical default); with none of these speech is unconfigured — the
    LLM provider never decides speech. OpenAI uses `OPENAI_API_KEY`, the compatible `OPENAI_BASE_URL`,
    default model `gpt-4o-mini-tts`, default voice `alloy`, and MP3 output.
    ElevenLabs requires both `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`, uses
    default model `eleven_multilingual_v2`, and requests `mp3_44100_128` from the
    fixed ElevenLabs API origin. Only the current stored draft script is sent to
    the selected speech provider; document bytes, extracted text, research
    queries, source-page bodies, and raw feedback are not part of this request.
12. The generated 650–800-word target fits the OpenAI default speech model's
    2,000-token budget and ElevenLabs' documented 10,000-character limit for the
    default model. The separate 7,000-character UI/server cap also constrains
    moderator edits but is not a tokenizer. The adapter does not silently trim a
    script. No complete selected-provider configuration returns unavailable;
    partial ElevenLabs configuration fails before any network call. An
    OpenAI-compatible endpoint 404 returns unavailable; other provider errors
    throw so the moderator is not shown a false success.
13. MP3 bytes, byte count, monotonic `audio_revision`, server-derived
    `audio_duration_seconds`, and the exact provider/model/voice used are stored
    in Postgres. Duration is parsed from MPEG Layer III frames, with the bounded
    script-rate estimate only as a malformed/unusual-MP3 fallback; browser input
    is not trusted. Existing audio predating migration 058 has a null provider
    because a historical compatible base URL cannot establish the real
    processor. Metadata reads exclude the byte column. Editing or regenerating
    a script clears audio duration and all speech metadata together.
14. Audio creation and approval require the stored source digest to match the
    current available document set. Approval uses a compare-and-set from `draft`,
    requires nonnull audio bytes, and records approver/time.
15. A moderator can explicitly recall an `approved` recap through a compare-and-
    set transition back to `draft`. Recall clears approver/time but deliberately
    preserves the current script, audio, sources, and speech provenance for
    moderator comparison. Attendee streaming stops; the moderator can re-create
    only the speech, edit the script, or regenerate the complete document-led
    draft. Every replacement requires a new approval.
16. Any authenticated member of the session's organization can stream approved,
    source-current audio; only department moderators can stream a current draft
    preview. A changed document set or legacy null digest returns 404. The route
    authorizes against blob-free metadata first, then reads only the `audio`
    column with a direct PostgREST GET pinned to the authorized `status` and
    `audio_revision`, decoding PostgREST's `\\x` hex JSON incrementally
    (`lib/audio-hex-stream.ts`), so a play never holds the hex string or the
    whole MP3 in memory. Audio that changed or was cleared between authorization
    and read returns 404. `Content-Length` is the `audio_bytes` size mirror.

Generation is one server action rather than a streamed provider job. The client
therefore renders an explicitly **estimated** progress bar, not fabricated
provider telemetry. It advances through document preparation, reading, research,
drafting, and finalisation, stops at 94% while the request is unresolved, and
sets 100% only after the action succeeds. Failure clears the busy state and shows
the safe action error; navigating away cancels only the client view and is not a
guarantee that the upstream provider stopped processing.

Streaming is private-cacheable for one hour, so recall prevents new authorized
streams but cannot revoke bytes a browser already fetched. The explicit recall
operation preserves the current media as a moderator-only draft; calling script
regeneration can also upsert an approved row back to draft but clears audio and
approval only after replacement generation succeeds. A failed regeneration
therefore leaves the existing approved recap unchanged. The feature sends no
email and does not use `ops_pending_actions`. Private document bytes leave
Petrios only on the explicit generation/regeneration click and are subject to
the configured AI provider's retention, region, contract, and transfer terms.
Hosted search may issue queries derived from those private documents and returns
public URLs. The generation warning, privacy notice, and external-service
register must disclose that derived-query flow. Creating or recreating audio is
a distinct provider request that can consume speech credits. The management UI
identifies the generated audio's provider/model/voice and warns before the
request; the attendee player identifies the narration as AI-generated. Operators
must separately review their selected speech provider's logging/history,
retention, region, contract, subprocessors, transfers, and deletion controls.

## Operational verification

For an Ops change:

- search `emails.send` under `lib/ops`, Ops actions, and Ops cron routes; only
  executor branches may send;
- ensure every inference purpose is allow-listed and feedback text is fenced;
- check null-provider and invalid-JSON behavior;
- test speech-provider selection, partial/invalid configuration, request shape,
  error behavior, and returned provider/model/voice metadata without exposing
  API keys;
- validate org scope before invoking any model-selected tool;
- preserve compare-and-set review/approval transitions;
- test duplicate cron invocation, partial email delivery, and kill-switch state;
- keep model prompt/body/feedback/secrets out of run details; and
- state whether an artifact is a draft, approved, executed, retryable, or
  permanently watermarked.
