# 06 — Petrios Ops and AI-assisted operations

## Scope

Petrios Ops is an additive organizer-facing layer for feedback synthesis,
speaker follow-up drafts, curriculum mapping, weekly newsletters, an assistant,
Recall drafting, and approved audio recaps. Its code is concentrated in
`lib/ops/`, `lib/db/ops*.ts`, `app/actions/ops*.ts`, the `/ops` pages, three Ops
cron routes, and `ops_*` tables. `audio_recaps` is a related, separately named
table with its own human approval state.

Ops reads core teaching data but does not own core sessions, attendance,
feedback, membership, or certificate state. `lib/db/ops-reads.ts` is read-only
over those core tables. The assistant's `session_enrich` tool is the deliberate
write to Ops curriculum mapping, not to the session row.

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
| `session_summary` | Concise organizer session enrichment |
| `curriculum_map` | Fallback domain mapping |
| `newsletter` | Structured weekly digest draft |
| `low_score_digest` | Reserved/available Ops purpose |
| `gap_topics` | Curriculum-gap topic suggestions |
| `recall_questions` | Three-question Recall draft |
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
audit; it is specified in spec 05. Audio recap generation uses the gateway but
does not currently pass an `OpsRun`, so it has purpose enforcement without a
stored inference step.

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
review flag is true, automated thank-you insights are not drafted, assistant
tools return only the review warning, and newsletter content omits its themes.
Moderators are directed to the raw feedback surface.

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
- `NEWSLETTER_ISSUE`: fan out the stored issue to current organization members
  excluding opt-outs.

For newsletters, each recipient failure is isolated. If every available profile
send fails, issue and pending action fail. If at least one succeeds, the issue is
marked sent with `sent_count` even when others failed; there is no per-recipient
retry ledger. A sent issue is guarded against double execution.

## Weekly Ops job

`GET /api/cron/ops-weekly` requires `Authorization: Bearer CRON_SECRET`, checks
the kill switch, creates one global run, and performs three passes.

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

### Curriculum gap watch

For each nonpersonal organization with at least five published sessions in the
last 120 days:

- map unmapped sessions using keyword matching first and LLM fallback;
- cap new mappings at 15 across the full invocation;
- calculate coverage against stored domains; and
- when the sorted uncovered-domain set differs from `ops_memory`, notify org
  admins and store the new set plus optional suggestions.

Only changes to the uncovered set alert. If the global mapping cap prevents later
organizations from being fully mapped, their apparent gaps may include not-yet-
mapped sessions until a future run.

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

Independently of whether a session had feedback/synthesis, take up to five
candidate sessions with no Recall set and attempt a three-question model draft.
There is deliberately no deterministic fallback. Successful drafts notify
moderators and remain inert until reviewed/approved. Recall sending and catch-up
attendance are in spec 08.

## Weekly newsletter job

`GET /api/cron/ops-newsletter` computes the prior complete Monday–Sunday window
and iterates nonpersonal organizations.

It skips an organization when:

- an issue already exists for `(org_id, week_start)`; or
- no sessions ended in the prior week.

It combines delivered-session ratings and safe stored themes with the next seven
days of sessions, asks for a schema-validated draft, renders escaped newsletter
HTML containing an unsubscribe placeholder, stores the issue, queues a
`NEWSLETTER_ISSUE` pending action, and notifies organization admins. No email is
sent by the job.

On approval, the executor enumerates **current** organization members, excludes
`ops_newsletter_optouts`, substitutes a per-user HMAC unsubscribe URL, sends, and
updates issue status/count. The audience is evaluated at execution, not frozen
when drafted.

## Organizer assistant

**Disabled by default.** `opsAssistantEnabled()` (`lib/ops/flags.ts`)
requires an explicit `OPS_ASSISTANT_ENABLED=true` opt-in per deployment,
on top of `OPS_ENABLED` — free-form chat with tool access carries its own
risk surface and needs its own safety review before exposure. While off:
every `app/actions/ops-chat.ts` action throws, `/ops/assistant` returns
404, and the "Open Assistant" button is not rendered. The scheduled
drafting pipelines (chases, syntheses, newsletter) are unaffected.

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
| `curriculum_domains_list` | Read configured domain taxonomy |
| `curriculum_coverage` | Read last-120-day aggregate coverage |
| `slots_list_open` | Read open organization slots |
| `memory_list` | Read up to 20 organizer memory rows |
| `memory_save` | Upsert short organization-scoped note |
| `comms_propose_email` | Insert `CUSTOM_EMAIL` pending action only |
| `session_enrich` | Generate summary and store Ops curriculum mappings |

Read results are generally capped at 20 rows. Tools expose operational names and
invite statuses where needed for organizer work, but no per-trainee performance
tool exists.

## Audio recaps

Audio recap is a moderator-approved artifact, not an automatic email action.

1. A moderator requests a script for a session.
2. `generateRecapScript` uses session title/description/tags and safe synthesis
   themes/suggestions, fences feedback-derived data, and calls gateway purpose
   `audio_recap`.
3. The script is capped at 2,500 characters and upserted as `draft`. A regenerated
   script clears old audio/approval.
4. The moderator may edit only a draft. Editing clears audio so speech can never
   be stale relative to text.
5. `lib/ai/tts.ts` produces MP3 using configured model/voice. No key or an HTTP
   404 returns unavailable; other provider errors throw.
6. Audio bytes and byte count are stored in Postgres. Metadata reads exclude the
   byte column.
7. Approval uses a compare-and-set from `draft` and requires nonnull audio bytes,
   recording approver/time.
8. Any authenticated member of the session's organization can stream approved
   audio; only department moderators can stream a draft preview.

Streaming is private-cacheable for one hour. There is no unapprove operation.
Calling script regeneration can upsert an approved row back to draft, clearing
audio and approval; that is the implemented revision path. The feature sends no
email and does not use `ops_pending_actions`.

## Operational verification

For an Ops change:

- search `emails.send` under `lib/ops`, Ops actions, and Ops cron routes; only
  executor branches may send;
- ensure every inference purpose is allow-listed and feedback text is fenced;
- check null-provider and invalid-JSON behavior;
- validate org scope before invoking any model-selected tool;
- preserve compare-and-set review/approval transitions;
- test duplicate cron invocation, partial email delivery, and kill-switch state;
- keep model prompt/body/feedback/secrets out of run details; and
- state whether an artifact is a draft, approved, executed, retryable, or
  permanently watermarked.
