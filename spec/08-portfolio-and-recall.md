# 08 — Evidence Engine (portfolio & dossier) + Byte Recall

## Evidence Engine

Two faces of one idea: the platform already holds verifiable evidence of
teaching activity — package it for the people who need it.

### Trainee side: curriculum passport + ARCP portfolio pack
- **Passport** (dashboard → Portfolio tab, `PortfolioPanel`): personal RCPCH
  Progress+ coverage (attended sessions ∩ `ops_curriculum_map`, via
  `buildCoverage`), per-session reflections, certificates.
- **Reflections** (`session_reflections`, migration 038): one per
  session/user, self-only RLS, edited inline on the Portfolio tab
  (`saveReflection`). ARCP wants attendance AND reflection — this is the
  reflection half.
- **Portfolio pack** (`generatePortfolioPack`): pick a period → signed PDF
  (`lib/portfolio/pack-pdf.tsx`) of attendance (with evidence sources —
  RECALL rows labelled "Caught up"), coverage, reflections, and certificate
  codes. An immutable snapshot is stored in `portfolio_packs` (deny-all RLS)
  keyed by a random `pack_code`; the PUBLIC page `/verify/pack/[code]`
  renders the snapshot so an ARCP panel can detect an altered PDF.

### Teacher side: appraisal/revalidation dossier
- Dashboard Teaching tab (`TeachingDossierPanel`) → `downloadTeachingDossier`:
  sessions taught (ACCEPTED `session_teachers` in period), hours, attendee
  counts, average ratings, anonymised feedback themes (safety-cleared
  syntheses only — `requires_human_review` sets are excluded). PDF:
  `lib/portfolio/dossier-pdf.tsx`.
- Strategic point: the dossier makes teaching on the platform career
  currency for seniors — it is the recruitment lever for slot claiming.

## Byte Recall (spaced retrieval + catch-up attendance)

### The flow
1. **Draft** — the ops-synthesis cron drafts 3 single-best-answer questions
   per recently-ended session (`lib/ops/recall.ts`, gateway purpose
   `recall_questions`, zod `RecallQuestionSetSchema` from `lib/recall.ts`).
   Deliberately NO deterministic fallback: bad questions are worse than
   none, so nothing is drafted without the LLM.
2. **Approve** — moderators edit and approve the set on the session manage
   **Recall** tab (`RecallQuestionsPanel`). This human gate is the quality
   bar; **nothing is emailed before approval**. (The subsequent sends are
   deterministic core-platform email of approved content, the same class as
   session reminders — the ops-layer no-unapproved-email invariant governs
   ops send paths, and this design keeps AI content human-gated regardless.)
3. **Send** — `recall-send` cron (daily): end+3d → retention email to
   PRESENT/LATE attendees AND catch-up invite to absent department members;
   end+14d → one boost nudge to attendees who haven't answered. Watermarks
   (`sent_attendees_at`, `sent_boost_at`, `sent_catchup_at`) make reruns
   idempotent; sets approved after the window closes are watermarked
   without sending.
4. **Answer** — public page `/recall/[token]` (HMAC token
   `makeRecallToken(sessionId, userId)`, listed in `proxy.ts`). One attempt
   per user/session (UNIQUE); `answer_index`/explanations are never shipped
   to the browser before submission; score + explanations shown after.

### Catch-up attendance (the supervisor rule)
Absentees who pass (≥2 of 3, `scoreAnswers`) earn attendance:
- Evidence source **RECALL** (migration 039 widens the enum + the
  `is_evidence_valid` SQL function; window = session end → end + 21 days,
  `RECALL_VALID_DAYS_AFTER_END` in `lib/attendance/compute.ts`).
- **Priority 0 — the lowest**: recall can never outrank evidence of real
  presence, and `primary_source='RECALL'` stays visible in audit, passport,
  and portfolio packs ("Caught up"), so integrity is preserved.
- The evidence carries `metadata.status_override='PRESENT'` so the
  post-session timestamp doesn't read as LATE, plus
  `method='RECALL_CATCH_UP'` and the score.
- Locked attendance: the answer is recorded but no evidence is written; the
  page tells the user to contact the moderator.

### Tables (migration 039, deny-all RLS)
`recall_question_sets` (UNIQUE(session), status draft/approved, send
watermarks) and `recall_answers` (UNIQUE(session, user), kind
RETENTION/CATCH_UP, score/passed). DAL: `lib/db/recall.ts`.
