-- 059: Governed Audio Recap catch-up recognition.
--
-- A registered, finalized ABSENT attendee may become PRESENT through the
-- transparent RECALL source only after completing the exact approved audio and
-- earning 5/5 on its moderator-published question set. Generic evidence writers
-- remain unable to create RECALL evidence; the SECURITY DEFINER completion RPC
-- is the sole producer and verifies every prerequisite inside one transaction.

ALTER TABLE public.audio_recaps
  ADD COLUMN script_digest TEXT,
  ADD COLUMN audio_revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN audio_duration_seconds INTEGER;

ALTER TABLE public.audio_recaps
  ADD CONSTRAINT audio_recaps_script_digest_check
    CHECK (script_digest IS NULL OR script_digest ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT audio_recaps_audio_revision_check
    CHECK (audio_revision >= 0),
  ADD CONSTRAINT audio_recaps_audio_duration_check
    CHECK (audio_duration_seconds IS NULL OR audio_duration_seconds BETWEEN 1 AND 1800);

ALTER TABLE public.recall_question_sets
  ADD COLUMN script_digest TEXT,
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN published_at TIMESTAMPTZ,
  ADD COLUMN catchup_opens_at TIMESTAMPTZ,
  ADD COLUMN catchup_closes_at TIMESTAMPTZ;

ALTER TABLE public.recall_question_sets
  ADD CONSTRAINT recall_question_sets_script_digest_check
    CHECK (script_digest IS NULL OR script_digest ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT recall_question_sets_revision_check CHECK (revision > 0),
  ADD CONSTRAINT recall_question_sets_catchup_window_check
    CHECK (
      catchup_opens_at IS NULL
      OR catchup_closes_at IS NULL
      OR catchup_closes_at > catchup_opens_at
    );

ALTER TABLE public.recall_question_sets
  DROP CONSTRAINT recall_question_sets_status_check,
  DROP CONSTRAINT recall_question_sets_session_id_key;

ALTER TABLE public.recall_question_sets
  ADD CONSTRAINT recall_question_sets_status_check
    CHECK (status IN ('draft', 'approved', 'retired')),
  ADD CONSTRAINT recall_question_sets_session_revision_key
    UNIQUE (session_id, revision);

CREATE INDEX recall_question_sets_current_idx
  ON public.recall_question_sets (session_id, revision DESC)
  WHERE status IN ('draft', 'approved');

-- Store a new draft without mutating a question revision that learners may
-- already have attempted. Drafts are safe to replace; approved revisions are
-- retired and a new incremented draft is inserted atomically.
CREATE OR REPLACE FUNCTION public.replace_recall_question_set_draft_v1(
  p_org_id UUID,
  p_session_id UUID,
  p_questions JSONB,
  p_model TEXT,
  p_script_digest TEXT
) RETURNS public.recall_question_sets AS $$
DECLARE
  v_current public.recall_question_sets%ROWTYPE;
  v_result public.recall_question_sets%ROWTYPE;
  v_revision INTEGER := 1;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sessions
    WHERE id = p_session_id AND org_id = p_org_id
  ) THEN RAISE EXCEPTION 'Session scope mismatch'; END IF;
  IF jsonb_typeof(p_questions) <> 'array' OR jsonb_array_length(p_questions) <> 5
     OR p_script_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A script-bound five-question draft is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_id::TEXT, 0));
  SELECT * INTO v_current FROM public.recall_question_sets
  WHERE session_id = p_session_id
  ORDER BY revision DESC LIMIT 1 FOR UPDATE;

  IF FOUND THEN v_revision := v_current.revision + 1; END IF;
  IF FOUND AND v_current.status = 'draft' THEN
    UPDATE public.recall_question_sets
    SET questions = p_questions, model = p_model,
        script_digest = p_script_digest,
        approved_by = NULL, approved_at = NULL, published_at = NULL,
        catchup_opens_at = NULL, catchup_closes_at = NULL,
        sent_attendees_at = NULL, sent_boost_at = NULL, sent_catchup_at = NULL
    WHERE id = v_current.id RETURNING * INTO v_result;
    RETURN v_result;
  END IF;

  IF FOUND AND v_current.status = 'approved' THEN
    UPDATE public.recall_question_sets SET status = 'retired'
    WHERE id = v_current.id;
  END IF;

  INSERT INTO public.recall_question_sets (
    org_id, session_id, questions, model, script_digest, revision, status
  ) VALUES (
    p_org_id, p_session_id, p_questions, p_model, p_script_digest,
    v_revision, 'draft'
  ) RETURNING * INTO v_result;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.recall_published_question_set_v1(
  p_set_id UUID
) RETURNS public.recall_question_sets AS $$
DECLARE
  v_current public.recall_question_sets%ROWTYPE;
  v_result public.recall_question_sets%ROWTYPE;
BEGIN
  SELECT * INTO v_current FROM public.recall_question_sets
  WHERE id = p_set_id AND status = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'Published question set not found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_current.session_id::TEXT, 0));
  SELECT * INTO v_current FROM public.recall_question_sets
  WHERE id = p_set_id AND status = 'approved' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Published question set changed'; END IF;

  UPDATE public.recall_question_sets SET status = 'retired'
  WHERE id = v_current.id;
  INSERT INTO public.recall_question_sets (
    org_id, session_id, questions, script_digest, revision, status, model
  ) VALUES (
    v_current.org_id, v_current.session_id, v_current.questions,
    v_current.script_digest, v_current.revision + 1, 'draft', v_current.model
  ) RETURNING * INTO v_result;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Publication is a governance transition, so validate the question revision,
-- approved audio artifact, and finalized attendance together under locks. This
-- closes the race where a recap could be recalled between an application read
-- and the question-set update.
CREATE OR REPLACE FUNCTION public.publish_recall_question_set_v1(
  p_set_id UUID,
  p_questions JSONB,
  p_user_id UUID
) RETURNS public.recall_question_sets AS $$
DECLARE
  v_set public.recall_question_sets%ROWTYPE;
  v_session public.sessions%ROWTYPE;
  v_recap public.audio_recaps%ROWTYPE;
  v_result public.recall_question_sets%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_questions) <> 'array' OR jsonb_array_length(p_questions) <> 5 THEN
    RAISE EXCEPTION 'Five reviewed questions are required';
  END IF;

  SELECT * INTO v_set FROM public.recall_question_sets
  WHERE id = p_set_id AND status = 'draft' FOR UPDATE;
  IF NOT FOUND OR v_set.script_digest IS NULL THEN
    RAISE EXCEPTION 'The Recall question draft changed';
  END IF;

  SELECT * INTO v_session FROM public.sessions
  WHERE id = v_set.session_id FOR UPDATE;
  IF NOT FOUND OR v_session.org_id <> v_set.org_id
     OR v_session.status <> 'PUBLISHED'
     OR v_session.attendance_policy_version < 2
     OR v_session.attendance_phase <> 'FINALIZED' THEN
    RAISE EXCEPTION 'Finalized policy-v2 attendance is required';
  END IF;

  SELECT * INTO v_recap FROM public.audio_recaps
  WHERE session_id = v_set.session_id FOR UPDATE;
  IF NOT FOUND OR v_recap.status <> 'approved'
     OR v_recap.script_digest IS DISTINCT FROM v_set.script_digest
     OR v_recap.audio IS NULL OR COALESCE(v_recap.audio_bytes, 0) <= 0
     OR v_recap.audio_revision <= 0 OR v_recap.audio_duration_seconds IS NULL THEN
    RAISE EXCEPTION 'The matching approved Audio Recap is required';
  END IF;

  UPDATE public.recall_question_sets
  SET questions = p_questions,
      status = 'approved',
      approved_by = p_user_id,
      approved_at = now(),
      published_at = now(),
      catchup_opens_at = now(),
      catchup_closes_at = now() + INTERVAL '21 days'
  WHERE id = v_set.id AND status = 'draft'
  RETURNING * INTO v_result;
  IF NOT FOUND THEN RAISE EXCEPTION 'The Recall question draft changed'; END IF;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TABLE public.recall_playback_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_set_id UUID NOT NULL REFERENCES public.recall_question_sets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  audio_revision INTEGER NOT NULL CHECK (audio_revision > 0),
  listened_seconds INTEGER NOT NULL DEFAULT 0 CHECK (listened_seconds >= 0),
  last_position_seconds NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (last_position_seconds >= 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (question_set_id, user_id)
);

CREATE INDEX recall_playback_progress_user_idx
  ON public.recall_playback_progress (user_id, session_id);
ALTER TABLE public.recall_playback_progress ENABLE ROW LEVEL SECURITY;
-- Deny-all: authenticated server actions use the service DAL/RPC.

CREATE TABLE public.recall_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_set_id UUID NOT NULL REFERENCES public.recall_question_sets(id) ON DELETE CASCADE,
  playback_id UUID NOT NULL REFERENCES public.recall_playback_progress(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempt_number SMALLINT NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  answers JSONB NOT NULL CHECK (jsonb_typeof(answers) = 'array' AND jsonb_array_length(answers) = 5),
  score SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 5),
  total SMALLINT NOT NULL DEFAULT 5 CHECK (total = 5),
  passed BOOLEAN NOT NULL,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_set_id, user_id, attempt_number)
);

CREATE INDEX recall_attempts_user_idx
  ON public.recall_attempts (user_id, session_id, answered_at DESC);
ALTER TABLE public.recall_attempts ENABLE ROW LEVEL SECURITY;
-- Deny-all: the authenticated answer action uses the service DAL.

CREATE TABLE public.recall_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_set_id UUID NOT NULL REFERENCES public.recall_question_sets(id) ON DELETE RESTRICT,
  playback_id UUID NOT NULL REFERENCES public.recall_playback_progress(id) ON DELETE RESTRICT,
  perfect_attempt_id UUID NOT NULL REFERENCES public.recall_attempts(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attendance_revision INTEGER NOT NULL,
  recognized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  certificate_id UUID REFERENCES public.certificates(id) ON DELETE SET NULL,
  award_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (award_status IN ('PENDING', 'ISSUED', 'DELIVERED', 'FAILED')),
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);

CREATE INDEX recall_completions_award_idx
  ON public.recall_completions (award_status, updated_at)
  WHERE award_status IN ('PENDING', 'ISSUED', 'FAILED');
ALTER TABLE public.recall_completions ENABLE ROW LEVEL SECURITY;
-- Deny-all: the recognition RPC and award worker own this state.

-- RECALL is not a general-purpose evidence source. New rows must point to the
-- governed completion that the dedicated completion RPC inserts immediately
-- before its evidence row. Historical rows are unaffected because this is an
-- INSERT-only guard.
CREATE OR REPLACE FUNCTION public.enforce_recall_evidence_producer_v1()
RETURNS TRIGGER AS $$
DECLARE
  v_completion public.recall_completions%ROWTYPE;
BEGIN
  IF NEW.source <> 'RECALL' THEN RETURN NEW; END IF;

  SELECT * INTO v_completion FROM public.recall_completions
  WHERE id::TEXT = NEW.metadata->>'recall_completion_id'
    AND org_id = NEW.org_id
    AND department_id = NEW.department_id
    AND session_id = NEW.session_id
    AND user_id = NEW.user_id;

  IF NOT FOUND
     OR NEW.user_id IS NULL
     OR NEW.external_email IS NOT NULL
     OR NEW.created_by IS DISTINCT FROM NEW.user_id
     OR NEW.metadata->>'method' <> 'AUDIO_RECAP_CATCH_UP'
     OR NEW.metadata->>'status_override' <> 'PRESENT'
     OR NEW.metadata->>'question_set_id' <> v_completion.question_set_id::TEXT
     OR NEW.source_event_key IS DISTINCT FROM
       'RECALL_CATCH_UP:' || v_completion.question_set_id::TEXT || ':' || NEW.user_id::TEXT THEN
    RAISE EXCEPTION 'RECALL evidence requires its governed catch-up completion';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS attendance_recall_evidence_producer
  ON public.attendance_evidence;
CREATE TRIGGER attendance_recall_evidence_producer
  BEFORE INSERT ON public.attendance_evidence
  FOR EACH ROW EXECUTE FUNCTION public.enforce_recall_evidence_producer_v1();

ALTER TABLE public.certificates
  ADD COLUMN recognition_basis TEXT NOT NULL DEFAULT 'LIVE_ATTENDANCE';

ALTER TABLE public.certificates
  ADD CONSTRAINT certificates_recognition_basis_check
    CHECK (recognition_basis IN ('LIVE_ATTENDANCE', 'AUDIO_RECAP_CATCH_UP', 'TEACHING_ASSIGNMENT'));

UPDATE public.certificates
SET recognition_basis = 'TEACHING_ASSIGNMENT'
WHERE certificate_role = 'TEACHER';

-- Extend the existing canonical issuance guard so the certificate records why
-- it was earned. A catch-up certificate must point to the matching governed
-- completion; a live-attendance certificate cannot quietly relabel RECALL.
CREATE OR REPLACE FUNCTION public.enforce_valid_certificate_eligibility()
RETURNS TRIGGER AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_attendance public.attendance%ROWTYPE;
BEGIN
  IF NEW.status <> 'VALID' THEN RETURN NEW; END IF;

  NEW.recipient_email := CASE
    WHEN NEW.recipient_email IS NULL THEN NULL
    ELSE lower(trim(NEW.recipient_email))
  END;

  SELECT * INTO v_session FROM public.sessions WHERE id = NEW.session_id;
  IF NOT FOUND
     OR v_session.org_id <> NEW.org_id
     OR v_session.department_id <> NEW.department_id
     OR v_session.status <> 'PUBLISHED'
     OR v_session.date_end > now()
     OR v_session.attendance_phase <> 'FINALIZED' THEN
    RAISE EXCEPTION 'Certificate session is not eligible';
  END IF;

  IF NEW.certificate_role = 'TEACHER' THEN
    IF NEW.recognition_basis <> 'TEACHING_ASSIGNMENT' THEN
      RAISE EXCEPTION 'Teacher certificates require the teaching-assignment basis';
    END IF;
    IF NEW.user_id IS NOT NULL THEN
      IF NEW.invitation_id IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM public.session_teachers AS teacher
        WHERE teacher.session_id = NEW.session_id
          AND teacher.user_id = NEW.user_id AND teacher.status = 'ACCEPTED'
      ) THEN
        RAISE EXCEPTION 'Teacher certificate requires an accepted teacher assignment';
      END IF;
    ELSE
      IF NEW.invitation_id IS NULL OR NEW.recipient_email IS NULL
         OR NULLIF(trim(NEW.recipient_name), '') IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.teacher_invitations AS invitation
        WHERE invitation.id = NEW.invitation_id
          AND invitation.session_id = NEW.session_id
          AND invitation.org_id = NEW.org_id
          AND invitation.status = 'ACCEPTED'
          AND lower(trim(invitation.email)) = NEW.recipient_email
      ) THEN
        RAISE EXCEPTION 'External teacher certificate requires the matching accepted invitation';
      END IF;
    END IF;
    NEW.attendance_revision := v_session.attendance_revision;
    RETURN NEW;
  END IF;

  IF NEW.certificate_role <> 'ATTENDEE' OR NEW.user_id IS NULL
     OR NEW.invitation_id IS NOT NULL
     OR NEW.recognition_basis = 'TEACHING_ASSIGNMENT' THEN
    RAISE EXCEPTION 'Attendee certificates require a registered attendee basis';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.session_teachers AS teacher
    WHERE teacher.session_id = NEW.session_id
      AND teacher.user_id = NEW.user_id AND teacher.status = 'ACCEPTED'
  ) THEN
    RAISE EXCEPTION 'Accepted teachers receive teaching certificates, not attendee certificates';
  END IF;

  SELECT * INTO v_attendance FROM public.attendance
  WHERE session_id = NEW.session_id AND user_id = NEW.user_id
    AND status IN ('PRESENT', 'LATE') AND finalized_at IS NOT NULL
    AND revision = v_session.attendance_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendee certificate requires current finalized attendance';
  END IF;

  IF NEW.recognition_basis = 'AUDIO_RECAP_CATCH_UP' THEN
    IF v_attendance.primary_source <> 'RECALL' OR NOT EXISTS (
      SELECT 1 FROM public.recall_completions AS completion
      WHERE completion.session_id = NEW.session_id
        AND completion.user_id = NEW.user_id
        AND completion.attendance_revision = v_session.attendance_revision
    ) THEN
      RAISE EXCEPTION 'Catch-up certificate requires its governed Recall completion';
    END IF;
  ELSIF v_attendance.primary_source = 'RECALL' THEN
    RAISE EXCEPTION 'Recall attendance requires the catch-up recognition basis';
  END IF;

  NEW.attendance_revision := v_session.attendance_revision;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS certificates_valid_eligibility ON public.certificates;
CREATE TRIGGER certificates_valid_eligibility
  BEFORE INSERT OR UPDATE OF status, attendance_revision, user_id,
    invitation_id, recipient_email, recipient_name, org_id, department_id,
    session_id, certificate_role, recognition_basis
  ON public.certificates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_valid_certificate_eligibility();

-- Policy-v1 keeps the historical 21-day interpretation. Policy-v2 RECALL
-- observations are created only by complete_recall_catchup_v2, which validates
-- the question-set-specific close time. Keeping them valid after creation lets
-- later governed reopen/recompute operations preserve their provenance.
CREATE OR REPLACE FUNCTION public.is_evidence_valid(
  p_session_id UUID,
  p_source evidence_source_type,
  p_observed_at TIMESTAMPTZ
) RETURNS BOOLEAN AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_checkin_start TIMESTAMPTZ;
  v_checkin_end TIMESTAMPTZ;
  v_feedback_end TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RETURN false; END IF;

  v_checkin_start := v_session.date_start
    - (COALESCE(v_session.checkin_open_mins_before, 15) || ' minutes')::INTERVAL;
  v_checkin_end := v_session.date_start
    + (COALESCE(v_session.checkin_close_mins_after, 45) || ' minutes')::INTERVAL;
  v_feedback_end := v_session.date_end
    + (COALESCE(v_session.feedback_valid_mins_after_end, 120) || ' minutes')::INTERVAL;

  CASE p_source
    WHEN 'SELF_CHECKIN', 'GROUP_CODE' THEN
      RETURN p_observed_at >= v_checkin_start AND p_observed_at <= v_checkin_end;
    WHEN 'FEEDBACK' THEN
      RETURN v_session.attendance_policy_version = 1
        AND p_observed_at >= v_checkin_start AND p_observed_at <= v_feedback_end;
    WHEN 'RECALL' THEN
      IF v_session.attendance_policy_version >= 2 THEN
        RETURN p_observed_at >= v_session.date_end;
      END IF;
      RETURN p_observed_at >= v_session.date_end
        AND p_observed_at <= v_session.date_end + INTERVAL '21 days';
    WHEN 'TEACHER', 'TEAMS', 'MODERATOR_CONFIRMATION' THEN
      RETURN true;
    ELSE
      RETURN false;
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.record_recall_playback_v1(
  p_question_set_id UUID,
  p_user_id UUID,
  p_position_seconds NUMERIC,
  p_is_playing BOOLEAN,
  p_finished BOOLEAN DEFAULT false
) RETURNS public.recall_playback_progress AS $$
DECLARE
  v_set public.recall_question_sets%ROWTYPE;
  v_recap public.audio_recaps%ROWTYPE;
  v_progress public.recall_playback_progress%ROWTYPE;
  v_wall_seconds NUMERIC := 0;
  v_media_seconds NUMERIC := 0;
  v_credit INTEGER := 0;
  v_listened INTEGER := 0;
  v_completed_at TIMESTAMPTZ;
BEGIN
  IF p_position_seconds IS NULL OR p_position_seconds < 0 THEN
    RAISE EXCEPTION 'Invalid playback position';
  END IF;

  SELECT * INTO v_set
  FROM public.recall_question_sets
  WHERE id = p_question_set_id AND status = 'approved';
  IF NOT FOUND OR v_set.script_digest IS NULL THEN
    RAISE EXCEPTION 'Catch-up questions are not published';
  END IF;

  SELECT * INTO v_recap
  FROM public.audio_recaps
  WHERE session_id = v_set.session_id
    AND status = 'approved'
    AND script_digest = v_set.script_digest
    AND audio_revision > 0
    AND audio_duration_seconds IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'The approved audio recap is not current'; END IF;

  IF v_set.catchup_opens_at IS NULL OR v_set.catchup_closes_at IS NULL
     OR now() < v_set.catchup_opens_at OR now() > v_set.catchup_closes_at THEN
    RAISE EXCEPTION 'The catch-up window is closed';
  END IF;

  INSERT INTO public.recall_playback_progress (
    org_id, session_id, question_set_id, user_id, audio_revision,
    last_position_seconds
  ) VALUES (
    v_set.org_id, v_set.session_id, v_set.id, p_user_id,
    v_recap.audio_revision, LEAST(p_position_seconds, v_recap.audio_duration_seconds)
  )
  ON CONFLICT (question_set_id, user_id) DO NOTHING;

  SELECT * INTO v_progress
  FROM public.recall_playback_progress
  WHERE question_set_id = v_set.id AND user_id = p_user_id
  FOR UPDATE;

  IF v_progress.audio_revision <> v_recap.audio_revision THEN
    UPDATE public.recall_playback_progress
    SET audio_revision = v_recap.audio_revision,
        listened_seconds = 0,
        last_position_seconds = LEAST(p_position_seconds, v_recap.audio_duration_seconds),
        started_at = now(), last_heartbeat_at = now(), completed_at = NULL
    WHERE id = v_progress.id
    RETURNING * INTO v_progress;
    RETURN v_progress;
  END IF;

  v_wall_seconds := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_progress.last_heartbeat_at)));
  v_media_seconds := GREATEST(0, p_position_seconds - v_progress.last_position_seconds);
  IF p_is_playing THEN
    v_credit := FLOOR(LEAST(20, v_wall_seconds + 2, v_media_seconds + 2));
  END IF;
  v_listened := LEAST(v_recap.audio_duration_seconds, v_progress.listened_seconds + v_credit);
  v_completed_at := v_progress.completed_at;

  IF v_completed_at IS NULL
     AND p_finished
     AND v_listened >= CEIL(v_recap.audio_duration_seconds * 0.85)
     AND p_position_seconds >= v_recap.audio_duration_seconds * 0.90 THEN
    v_completed_at := now();
  END IF;

  UPDATE public.recall_playback_progress
  SET listened_seconds = v_listened,
      last_position_seconds = LEAST(p_position_seconds, v_recap.audio_duration_seconds),
      last_heartbeat_at = now(),
      completed_at = v_completed_at
  WHERE id = v_progress.id
  RETURNING * INTO v_progress;

  RETURN v_progress;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.complete_recall_catchup_v2(
  p_question_set_id UUID,
  p_user_id UUID,
  p_perfect_attempt_id UUID
) RETURNS public.recall_completions AS $$
DECLARE
  v_set public.recall_question_sets%ROWTYPE;
  v_session public.sessions%ROWTYPE;
  v_recap public.audio_recaps%ROWTYPE;
  v_playback public.recall_playback_progress%ROWTYPE;
  v_attempt public.recall_attempts%ROWTYPE;
  v_attendance public.attendance%ROWTYPE;
  v_completion public.recall_completions%ROWTYPE;
BEGIN
  SELECT * INTO v_set FROM public.recall_question_sets
  WHERE id = p_question_set_id AND status = 'approved';
  IF NOT FOUND OR v_set.script_digest IS NULL
     OR jsonb_array_length(v_set.questions) <> 5 THEN
    RAISE EXCEPTION 'Five published catch-up questions are required';
  END IF;

  SELECT * INTO v_session FROM public.sessions
  WHERE id = v_set.session_id FOR UPDATE;
  IF NOT FOUND OR v_session.status <> 'PUBLISHED'
     OR v_session.attendance_policy_version < 2
     OR v_session.attendance_phase <> 'FINALIZED' THEN
    RAISE EXCEPTION 'Finalized policy-v2 attendance is required';
  END IF;
  IF v_set.catchup_opens_at IS NULL OR v_set.catchup_closes_at IS NULL
     OR now() < v_set.catchup_opens_at OR now() > v_set.catchup_closes_at THEN
    RAISE EXCEPTION 'The catch-up window is closed';
  END IF;

  SELECT * INTO v_recap FROM public.audio_recaps
  WHERE session_id = v_session.id AND status = 'approved'
    AND script_digest = v_set.script_digest AND audio_revision > 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'The approved audio recap is not current'; END IF;

  SELECT * INTO v_playback FROM public.recall_playback_progress
  WHERE question_set_id = v_set.id AND user_id = p_user_id
    AND audio_revision = v_recap.audio_revision AND completed_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Verified audio playback is required'; END IF;

  SELECT * INTO v_attempt FROM public.recall_attempts
  WHERE id = p_perfect_attempt_id AND question_set_id = v_set.id
    AND user_id = p_user_id AND passed = true AND score = 5 AND total = 5;
  IF NOT FOUND THEN RAISE EXCEPTION 'A perfect five-question attempt is required'; END IF;

  SELECT * INTO v_completion FROM public.recall_completions
  WHERE session_id = v_session.id AND user_id = p_user_id;
  IF FOUND THEN RETURN v_completion; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.session_participants sp
    WHERE sp.session_id = v_session.id AND sp.user_id = p_user_id
      AND sp.participant_role = 'ATTENDEE' AND sp.expectation = 'EXPECTED'
  ) OR EXISTS (
    SELECT 1 FROM public.session_teachers st
    WHERE st.session_id = v_session.id AND st.user_id = p_user_id
      AND st.status = 'ACCEPTED'
  ) THEN
    RAISE EXCEPTION 'The user is not an eligible registered absentee';
  END IF;

  SELECT * INTO v_attendance FROM public.attendance
  WHERE session_id = v_session.id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_attendance.status <> 'ABSENT'
     OR v_attendance.revision <> v_session.attendance_revision THEN
    RAISE EXCEPTION 'Only a current finalized absence can use catch-up recognition';
  END IF;

  INSERT INTO public.recall_completions (
    org_id, department_id, session_id, question_set_id, playback_id,
    perfect_attempt_id, user_id, attendance_revision
  ) VALUES (
    v_session.org_id, v_session.department_id, v_session.id, v_set.id,
    v_playback.id, v_attempt.id, p_user_id, v_session.attendance_revision
  ) RETURNING * INTO v_completion;

  INSERT INTO public.attendance_evidence (
    org_id, session_id, department_id, user_id, source, observed_at,
    metadata, created_by, source_event_key
  ) VALUES (
    v_session.org_id, v_session.id, v_session.department_id, p_user_id,
    'RECALL', now(),
    jsonb_build_object(
      'status_override', 'PRESENT',
      'method', 'AUDIO_RECAP_CATCH_UP',
      'recall_completion_id', v_completion.id,
      'question_set_id', v_set.id,
      'audio_revision', v_recap.audio_revision
    ),
    p_user_id,
    'RECALL_CATCH_UP:' || v_set.id::TEXT || ':' || p_user_id::TEXT
  ) ON CONFLICT (session_id, source_event_key) WHERE source_event_key IS NOT NULL
    DO NOTHING;

  UPDATE public.attendance
  SET status = 'PRESENT', primary_source = 'RECALL', first_evidence_at = now(),
      computed_at = now(), locked = true, locked_by = p_user_id,
      locked_at = now(), finalized_at = now(), finalized_by = p_user_id
  WHERE id = v_attendance.id;

  INSERT INTO public.session_activity_events (
    org_id, department_id, session_id, event_type, actor_user_id,
    subject_user_id, details
  ) VALUES (
    v_session.org_id, v_session.department_id, v_session.id,
    'RECALL_CATCH_UP_RECOGNIZED', p_user_id, p_user_id,
    jsonb_build_object(
      'completion_id', v_completion.id,
      'question_set_id', v_set.id,
      'attendance_revision', v_session.attendance_revision,
      'source', 'RECALL'
    )
  );

  RETURN v_completion;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.record_recall_playback_v1(UUID, UUID, NUMERIC, BOOLEAN, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_recall_catchup_v2(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_recall_question_set_draft_v1(UUID, UUID, JSONB, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recall_published_question_set_v1(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_recall_question_set_v1(UUID, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_recall_playback_v1(UUID, UUID, NUMERIC, BOOLEAN, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_recall_catchup_v2(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_recall_question_set_draft_v1(UUID, UUID, JSONB, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.recall_published_question_set_v1(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_recall_question_set_v1(UUID, JSONB, UUID) TO service_role;

COMMENT ON COLUMN public.certificates.recognition_basis IS
  'Snapshot of why the certificate was eligible; catch-up must remain distinguishable from live attendance.';
