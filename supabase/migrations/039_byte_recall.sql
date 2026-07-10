-- 039: Byte Recall — spaced-repetition recall questions after sessions,
-- with catch-up attendance: an absentee who passes the recall questions
-- (within 21 days) earns attendance evidence with the new RECALL source.
--
-- RECALL is the LOWEST-priority evidence source (see
-- lib/attendance/compute.ts) and always visible as the primary source in
-- audit/portfolio views, so caught-up attendance is honest and
-- distinguishable from physical presence.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run in the same transaction that
-- created the enum — the enum is from migration 014, so this is safe.

ALTER TYPE evidence_source_type ADD VALUE IF NOT EXISTS 'RECALL';

-- Recall window: session end -> end + 21 days (mirrors compute.ts).
CREATE OR REPLACE FUNCTION is_evidence_valid(
  p_session_id UUID,
  p_source evidence_source_type,
  p_observed_at TIMESTAMPTZ
) RETURNS BOOLEAN AS $$
DECLARE
  v_session sessions%ROWTYPE;
  v_checkin_start TIMESTAMPTZ;
  v_checkin_end TIMESTAMPTZ;
  v_feedback_end TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Calculate time windows
  v_checkin_start := v_session.date_start - (v_session.checkin_open_mins_before || ' minutes')::INTERVAL;
  v_checkin_end := v_session.date_start + (v_session.checkin_close_mins_after || ' minutes')::INTERVAL;
  v_feedback_end := v_session.date_end + (v_session.feedback_valid_mins_after_end || ' minutes')::INTERVAL;

  -- Validate based on source
  CASE p_source
    WHEN 'SELF_CHECKIN', 'GROUP_CODE' THEN
      RETURN p_observed_at >= v_checkin_start AND p_observed_at <= v_checkin_end;
    WHEN 'FEEDBACK' THEN
      RETURN p_observed_at >= v_checkin_start AND p_observed_at <= v_feedback_end;
    WHEN 'TEACHER', 'TEAMS' THEN
      RETURN true; -- Teacher/Teams evidence is always valid if created
    WHEN 'RECALL' THEN
      RETURN p_observed_at >= v_session.date_end
         AND p_observed_at <= v_session.date_end + INTERVAL '21 days';
    ELSE
      RETURN false;
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE;

-- One question set per session. AI-drafted (status 'draft'), then edited and
-- approved by a moderator in the session manage UI before anything sends.
CREATE TABLE public.recall_question_sets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL UNIQUE REFERENCES public.sessions(id) ON DELETE CASCADE,
  questions JSONB NOT NULL,  -- [{question, options[4], answer_index, explanation}]
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  model TEXT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  -- Send watermarks (idempotent cron):
  sent_attendees_at TIMESTAMPTZ,
  sent_boost_at TIMESTAMPTZ,
  sent_catchup_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.recall_question_sets ENABLE ROW LEVEL SECURITY;
-- Deny-all: service DAL only (lib/db/recall.ts).

-- One attempt per user per session (RETENTION for attendees, CATCH_UP for
-- absentees; a passing CATCH_UP grants RECALL attendance evidence).
CREATE TABLE public.recall_answers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('RETENTION','CATCH_UP')),
  answers JSONB NOT NULL,    -- selected option index per question
  score INT NOT NULL,
  total INT NOT NULL,
  passed BOOLEAN NOT NULL,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, user_id)
);

CREATE INDEX recall_answers_user_idx ON public.recall_answers (user_id);

ALTER TABLE public.recall_answers ENABLE ROW LEVEL SECURITY;
-- Deny-all: service DAL only.
