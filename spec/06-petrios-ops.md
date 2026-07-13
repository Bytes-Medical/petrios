# 06 — Petrios Ops (the AI agent layer)

An additive agent layer that runs programme operations semi-autonomously.
Everything lives under `lib/ops/`, `/ops` routes, `app/actions/ops*.ts`,
three cron routes, and `ops_*` tables — the layer must remain droppable
without touching the core app.

## Hard invariants (defects if violated, whatever the task)

1. **No outbound email without an approved `ops_pending_actions` row.**
   `lib/ops/executors.ts` is the only ops send path; crons and the
   assistant can only *draft*. New outbound capability = new action type in
   the executor, never a direct send.
2. **One inference choke point**: `opsInference` (`lib/ops/gateway.ts`) with
   a purpose allow-list (`feedback_synthesis`, `email_draft`,
   `session_summary`, `curriculum_map`, `newsletter`, `low_score_digest`,
   `gap_topics`, `recall_questions`, `audio_recap`, `assistant`). Every
   call logs an audit step: purpose, model, **sha256 prompt hash**, token
   counts — never prompt text. (On-demand calls that run without an OpsRun
   — `summarizeSessionFeedback`, recap script generation — write no audit
   row; the gateway still enforces the purpose list and kill switch.) The
   assistant's tool loop (`lib/ops/agent-loop.ts`) is the one sanctioned
   caller of the OpenAI API outside `lib/ai/llm.ts` (tool calling needs the
   raw message stream) and follows the same audit rules. For speech,
   `lib/ai/tts.ts` is the one sanctioned caller of the TTS endpoint — the
   audio sibling of the `llm.ts` doctrine.
3. **Kill switch**: `OPS_ENABLED=false` (`lib/ops/flags.ts`) halts every
   surface — crons no-op, gateway throws, chat and approve/execute actions
   refuse.
4. **Teaching quality only, never trainee performance** — prompt rules plus
   structural guarantees (no per-trainee aggregates in tools).
5. **Feedback text is untrusted data** — fenced in prompts; synthesis output
   is a stored artifact that never triggers tools.
6. **Org scope comes from the authenticated caller** (or the cron's own
   iteration), never from model input.

## Structure

- `lib/db/ops.ts` — service-role DAL for `ops_*` tables only (deny-all
  RLS). `lib/db/ops-reads.ts` — read-only service-role queries over core
  tables for crons/tools (SELECTs only; ops never writes core tables).
- `lib/ops/run.ts` — audit runs: `startRun(kind, trigger, orgId?)` returns
  `{log, logLlm, finish}`; best-effort logging never breaks the work.
- `lib/ops/gateway.ts` — `opsInference({purpose, system, prompt, schema?,
  run?})`: zod-validated JSON (json_object mode + extractJson + one retry
  with the validation error), returns null on refusal/API failure/invalid
  output so batch callers skip the item.
- Pure modules with colocated tests: `anonymize.ts` (name stripping +
  `WELFARE_PATTERNS`), `synthesis.ts`, `curriculum.ts` (keyword matcher
  first, LLM fallback with confidence tiers), `newsletter.ts` (week window,
  HMAC unsubscribe tokens, HTML builder with escaping), `drafts.ts`
  (chase/thank-you drafting with **deterministic template fallbacks** —
  deterministic-first, LLM-second), `email-html.ts`, `format.ts`.

## The approval gate

Pending actions carry `payload` (exact email content), `preview_title`,
`preview_body`. Surfaces: `ApprovalsBell` in the nav (org managers) and the
`/ops` queue. `approveOpsAction` does a CAS claim (pending → approved), runs
the executor, then marks executed/failed; double-review is impossible.
Executors: SPEAKER_CHASE_EMAIL (sends + increments `ops_speaker_chases`),
THANK_YOU_EMAIL / CUSTOM_EMAIL (send payload), NEWSLETTER_ISSUE (fan-out to
org members minus opt-outs, per-recipient HMAC unsubscribe link replacing
`UNSUBSCRIBE_PLACEHOLDER`, updates issue status/sent_count).

## Crons (all an `Authorization: Bearer CRON_SECRET` header + kill-switch guard + batch caps + run logging)

- **ops-weekly**: (1) speaker chase — published sessions ≤21 days out with
  zero ACCEPTED teacher → drafted chase per PENDING invitee (registered →
  dashboard link, external → RSVP link), max 2 chases/target, dedupe against
  queued pending actions, cap 10 drafts/run; (2) low-score alerts — sessions
  ended in the last 8 days with ≥3 responses averaging <3.5 → bell
  notification to department moderators (internal, ungated); (3) curriculum
  gap watch — map unmapped term sessions (cap 15), alert org admins only
  when the uncovered-domain set *changes* (state in `ops_memory`).
- **ops-synthesis** (daily): sessions ended 2–45 days ago with feedback and
  no synthesis (UNIQUE(session_id) = idempotency), cap 5/run. Welfare-
  flagged → moderators told to read raw feedback, no automated thank-you;
  otherwise thank-you-with-insights drafts per accepted teacher (drafted
  only in the pass that created the synthesis — natural exactly-once).
- **ops-newsletter** (weekly, Mon): per non-personal org, prior complete
  Mon–Sun week; skip if issue exists (UNIQUE(org, week_start)) or nothing
  was delivered. Draft (schema-validated) → issue + NEWSLETTER_ISSUE pending
  action → notify org admins. Welfare-flagged syntheses are excluded from
  newsletter content.

## Synthesis safety rails (order matters)

1. Welfare pre-check runs on **raw** text (before name stripping can mask a
   signal) → forces `requires_human_review`.
2. Names (attendees who left feedback + session teachers) stripped **before**
   the text reaches the model, and again on returned quotes; the
   capitalised-pair heuristic deliberately over-strips.
3. Model output is schema-validated; quotes with welfare signals are dropped
   deterministically.

## Assistant (organisers only)

`/ops/assistant` → `sendChatMessage` (requireOpsManager) → tool loop
(max 8 iterations, all tool results returned per turn) over the registry in
`lib/ops/tools.ts`: read tools capped at 20 rows (sessions, unconfirmed
speakers, feedback stats, syntheses, attendance counts, curriculum
coverage, open slots, memory) and three writes — `memory_save`,
`session_enrich` (stores curriculum mappings), and `comms_propose_email`,
which can only queue a pending action. System prompt =
`ASSISTANT_SYSTEM_RULES` + `PLATFORM_KNOWLEDGE` (`lib/ops/knowledge.ts` —
update it when platform behaviour changes). History persists in
`ops_chat_threads/messages` with a tool-use trace.

## Success metric

Zero unapproved outbound actions, ever. Verify with:
`grep -rn "emails.send" lib/ops app/api/cron/ops-* app/actions/ops*` —
matches must exist only in `lib/ops/executors.ts`.

## Audio recaps (on-demand, moderator-approved)

A 60–90 s spoken recap per session, generated on demand from the manage
page's Feedback tab (`AudioRecapPanel`) — never automatically.

- **Script**: `lib/ops/recap.ts` via `opsInference` purpose `audio_recap`,
  sourcing session title/description/tags + the stored feedback synthesis
  (already name-stripped; still fenced as untrusted data in the prompt).
  Capped at `AUDIO_RECAP_MAX_SCRIPT_CHARS` (2500). Never any individual's
  performance or name (system rules).
- **Audio**: `synthesizeSpeech` (`lib/ai/tts.ts`, env `OPENAI_TTS_MODEL` /
  `OPENAI_TTS_VOICE`, shares `OPENAI_API_KEY`/`OPENAI_BASE_URL`). Degrades
  to null when unconfigured or when the endpoint 404s (local models).
- **Approval gate, structural**: `audio_recaps` (migration 043, deny-all,
  DAL `lib/db/audio-recaps.ts`) stores the MP3 as BYTEA; editing the script
  clears the audio, and approval requires audio present — the approved
  artifact is exactly what the moderator heard. Attendees see a player card
  on the session page only for approved recaps; the streaming route
  `/api/sessions/[id]/recap-audio` is org-scoped (drafts: moderators only).
- **No email**: v1 sends nothing, so the ops approval queue is not
  involved; the recap approval is its own status column (the
  recall_question_sets pattern). `OPS_ENABLED=false` removes the panel,
  the attendee card, and 404s the route.
- Blob discipline: metadata reads never select the BYTEA column
  (`META_COLUMNS`); `audio_bytes` mirrors its size.
