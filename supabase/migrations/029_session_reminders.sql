-- Session reminder emails: cron watermark so each published session's
-- attendees are reminded exactly once, ~24h before it starts.
-- Mirrors the report_sent_at pattern from 023_post_session_report.sql.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN sessions.reminder_sent_at IS
  'Set by /api/cron/session-reminders after reminder emails were sent. NULL = not yet reminded.';
