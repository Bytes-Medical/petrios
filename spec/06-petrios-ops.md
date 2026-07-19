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
4. calls the shared LLM adapter;
5. when a schema is supplied, adds a JSON-only instruction and requests JSON
   mode;
6. extracts the first object/array from a response and validates with Zod;
7. on invalid output, retries once with the validation error;
8. returns null after refusal, provider failure, or a second invalid output; and
9. logs through the optional run without storing raw prompt text.

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
issue.

Each audience member has one `ops_newsletter_deliveries` row per issue. Claims
move `PENDING`/`FAILED` (or a stale ten-minute `SENDING` lease) to `SENDING`;
completion stores `SENT` with provider id or `FAILED` with sanitized error.
Partial failure marks the issue/action failed. A moderator can retry, and already
`SENT` rows are never emailed again. Editing is locked after any successful send
so one issue cannot deliver different content to different members. A wholly
sent issue is guarded against double execution.

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

The moderator selects a UTC Monday–Sunday week that has started (mid-week drafts cover sessions ended so far and stay regenerable until sent) no more than one year
old. Generation selects **every `PUBLISHED` session in the department whose
`date_end` is in `[weekStart, weekStart + 7 days)`**. An empty week is rejected.
The job caps a week at 50 sessions so it never silently truncates a larger set.

For those sessions the job selects every `AVAILABLE` `session_documents` row,
including PDF, DOCX, and PPTX. It rejects more than 50 files or more than 50 MiB
combined. Every selected object is downloaded through the private service DAL;
stored byte count and SHA-256 are verified before inference. A missing object,
missing stored digest, or integrity mismatch fails the whole generation. A week
with sessions but no documents is allowed: trusted session title/date/description
metadata remains the available source. No material is silently omitted.

The inference request supplies a trusted manifest tying opaque provider
filenames to session ids/titles/dates plus the corresponding private file bytes.
Session descriptions and file content are explicitly fenced as untrusted data,
not instructions. The model must not introduce patient/person identifiers,
learner evaluation, feedback claims, clinical claims absent from the materials,
or outside research. The newsletter purpose is the second allowed private-file
gateway path alongside `audio_recap`.

### One-page draft contract

Generation asks for structured JSON containing subject, introduction, exactly
one section per selected session, one to three learning points per section, and
a closing. The dynamic Zod validator requires every trusted session id exactly
once, rejects unknown/duplicate/omitted ids, and limits the complete artifact to
700 words. Trusted session title/date replace model-returned labels after parsing.
The saved source snapshot contains session ids and document id/session id/name/
MIME/byte-count/SHA-256 metadata, never document bytes.

The email renderer uses the Petrios clay/black visual language, compact session
cards, and an unsubscribe placeholder. Every dynamic field is HTML-escaped before
storage. “One page” means this constrained, scannable email format and word cap;
email clients and print settings can still paginate differently.

One active issue is keyed by `(org_id, department_id, week_start)`. Generating
again replaces only an unsent draft/failed issue, resets it to draft revision 1,
and removes obsolete unsent delivery rows. A sent issue cannot be regenerated.
The editor exposes all narrative fields, live word count, saved HTML preview, and
the exact source-document list. Session identity/title/date labels remain bound
to the generated trusted snapshot even if a crafted client submits alternatives.
Save uses compare-and-swap on
`content_revision`; stale browser tabs are rejected. Every save revalidates exact
session coverage and the 700-word limit, rebuilds escaped HTML, increments the
revision, and resets status to draft. Saving or editing after any successful
recipient delivery is forbidden.

### Review, audience, and delivery

Generation and save never send email. “Approve & email” is the explicit human
review event described in the approval state machine. The pending action binds
the exact saved issue revision; the executor checks that binding before any
recipient claim.

Audience membership is evaluated at execution, not generation: every current
`department_members.user_id` joined to an email-bearing profile, minus users in
the organization-level `ops_newsletter_optouts` set. Missing profile email fails
the execution instead of silently dropping a member. Each email receives a
user-bound HMAC unsubscribe link. Delivery uses the per-recipient retry ledger
described above; the issue stores the number of successful sends, and the UI
offers “Retry unfinished” after a partial failure without duplicating successes.

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

The loop has a maximum of 8 model iterations and 4096 completion tokens per
model response. It executes every tool call returned in an iteration, truncates
serialized tool result content to 20,000 characters, records a success/failure
trace, and supplies a tool response for each requested call. Refusal/content
filter produces a generic refusal; reaching the cap asks the organizer to
continue.

The assistant's direct OpenAI-compatible call is the sole sanctioned chat
caller outside `lib/ai/llm.ts`. It logs model/prompt hash/token metadata without
raw history.

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
tool exists.

## Audio recaps

Audio recap is a moderator-approved artifact, not an automatic email action.
Its management card is colocated with Recall questions and retention analytics
on the session manage **Recall** tab. When enabled, Audio Recap is the first
card, ahead of Recall Questions and Retention Analytics; it is not part of the
Feedback tab.

1. A moderator requests a script; no automatic job sends document content to AI
   or starts research.
2. The action requires at least one currently available private session
   document, caps their combined decoded size at 50 MiB, downloads them through
   the authorized service DAL, and verifies stored byte counts and SHA-256.
3. `generateRecapScript` calls gateway purpose `audio_recap` with the session
   title as context and PDF/DOCX/PPTX bytes as the primary learning evidence. It
   does not use description, tags, or feedback synthesis. The prompt treats file
   content as untrusted reference data, refuses meta-instructions, and prohibits
   invented medical content, patient-specific advice, and patient/person
   identifiers.
4. The prompt targets 650–800 words—approximately five minutes at a normal
   spoken pace. It asks for a natural sequence covering orientation, the
   document-led teaching in depth, directly relevant researched context,
   practical takeaways, and concise reinforcement. It prohibits padding,
   headings, spoken URLs, citation markers, and a spoken bibliography.
5. The same Responses request configures one hosted `web_search` tool with
   `tool_choice: required`, medium search context, approximate country `GB`,
   external web access, and an allowed-domain filter. The allow-list is:
   `nice.org.uk`, `nhs.uk`, `england.nhs.uk`, `gov.uk`, `rcpch.ac.uk`,
   `rcplondon.ac.uk`, `resus.org.uk`, `who.int`,
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
7. `lib/ai/llm.ts` uses `<OPENAI_BASE_URL>/responses`. PDFs use automatic
   text/page-image processing; DOCX/PPTX yield text only. The request includes
   `web_search_call.action.sources`; the adapter also reads message
   `url_citation` annotations, accepts only HTTP(S), de-duplicates by normalized
   URL, and keeps at most 20 URL/title pairs. Generation fails if required search
   returns no verifiable source. A custom provider must support Responses file
   inputs and hosted web search; Chat Completions or file-input compatibility
   alone is insufficient.
8. The script is capped at 7,000 characters and upserted as `draft` with the
   exact sorted document metadata/digest, research URL/title list, and
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
    credential selects ElevenLabs; otherwise OpenAI preserves the historical
    default. OpenAI uses `OPENAI_API_KEY`, the compatible `OPENAI_BASE_URL`,
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
    preview. A changed document set or legacy null digest returns 404.

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
