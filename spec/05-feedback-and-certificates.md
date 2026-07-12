# 05 — Feedback & certificates

## Anonymous session feedback

- Collection is **public and anonymous**: per-session
  (`/sessions/[id]/feedback`) and per-department
  (`/departments/[id]/feedback`, which resolves the currently active
  session) pages, distributed via QR codes
  (`DepartmentQRCodePanel`). No login required.
- Validity window: 15 min before `date_start` until
  `feedback_valid_mins_after_end` (default 120) after `date_end`.
- Departments customise their form (`feedback_form_fields` JSONB:
  rating / text / textarea fields, `normalizeDepartmentFeedbackFields` in
  `lib/feedback-form.ts`). Submissions store `answers` as
  `SubmittedFeedbackAnswer[]` plus a headline 1–5 `rating`, optional
  attendee identity fields (used for FEEDBACK attendance evidence when the
  submitter is a member), and free-text comments.
- Stats endpoint `/api/sessions/[id]/feedback/stats`; moderator analysis
  panels live on the session manage page.
- **AI summaries**: `summarizeFeedback` (`lib/ai/feedback-summary.ts`) via
  `askLlm` — plain-text Overall/Themes/Suggestions, anonymised by prompt
  rule, gracefully absent without `OPENAI_API_KEY`. (The deeper,
  safety-railed synthesis artifact lives in Petrios Ops — see 06.)
- Teacher feedback release: moderators can share a session's feedback with
  its teachers (`ReleaseTeacherFeedbackPanel`).
- **Feedback free text is untrusted input** everywhere it meets an LLM:
  fenced as data, never instructions.

## Certificates

- Generated per session for ACCEPTED teachers and PRESENT attendees
  (`app/actions/certificates.ts`), PDF via `@react-pdf/renderer`
  (`lib/certificates/pdf.tsx`), with department signature/issuer fields
  (migrations 019/028).
- Each certificate has a public `certificate_code`; verification page
  `/verify/[certificateId]` is public (no auth) and shows validity +
  metadata.
- The post-session cron (`post-session-reports`) auto-generates
  certificates and emails reports after sessions end, watermarked by
  `report_sent_at`; attendance should be computed/locked by then (it
  recomputes from evidence first — see 03).
- Certificates are also emailed as attachments through the Resend adapter.
