-- 045: Attendance v2.
--
-- New sessions use an explicit participant roster and OPEN/REVIEW/FINALIZED
-- lifecycle. Historical sessions remain policy v1 so recomputing them does not
-- silently reinterpret already-issued records. All new v2 evidence is written
-- through record_attendance_evidence_v2, which inserts and recomputes in one
-- transaction.

ALTER TYPE evidence_source_type ADD VALUE IF NOT EXISTS 'MODERATOR_CONFIRMATION';

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS attendance_policy_version SMALLINT,
  ADD COLUMN IF NOT EXISTS attendance_phase TEXT,
  ADD COLUMN IF NOT EXISTS attendance_revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attendance_finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendance_finalized_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attendance_reopened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendance_reopened_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attendance_reopen_reason TEXT,
  ADD COLUMN IF NOT EXISTS group_code_hash TEXT;

UPDATE public.sessions
SET attendance_policy_version = 1
WHERE attendance_policy_version IS NULL;

UPDATE public.sessions
SET attendance_phase = CASE WHEN attendance_locked THEN 'FINALIZED' ELSE 'OPEN' END
WHERE attendance_phase IS NULL;

ALTER TABLE public.sessions
  ALTER COLUMN attendance_policy_version SET DEFAULT 2,
  ALTER COLUMN attendance_policy_version SET NOT NULL,
  ALTER COLUMN attendance_phase SET DEFAULT 'OPEN',
  ALTER COLUMN attendance_phase SET NOT NULL;

ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_attendance_policy_version_check,
  ADD CONSTRAINT sessions_attendance_policy_version_check
    CHECK (attendance_policy_version IN (1, 2)),
  DROP CONSTRAINT IF EXISTS sessions_attendance_phase_check,
  ADD CONSTRAINT sessions_attendance_phase_check
    CHECK (attendance_phase IN ('OPEN', 'REVIEW', 'FINALIZED'));

ALTER TABLE public.attendance_evidence
  ADD COLUMN IF NOT EXISTS source_event_key TEXT,
  ADD COLUMN IF NOT EXISTS correction_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_evidence_source_event_unique
  ON public.attendance_evidence (session_id, source_event_key)
  WHERE source_event_key IS NOT NULL;

ALTER TABLE public.attendance_evidence
  DROP CONSTRAINT IF EXISTS attendance_evidence_one_subject_check,
  ADD CONSTRAINT attendance_evidence_one_subject_check CHECK (
    (user_id IS NOT NULL AND external_email IS NULL)
    OR (user_id IS NULL AND external_email IS NOT NULL)
  ) NOT VALID;

ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finalized_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_status_check
  CHECK (status IN ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED'));

CREATE TABLE IF NOT EXISTS public.session_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  external_email TEXT,
  display_name TEXT,
  participant_role TEXT NOT NULL DEFAULT 'ATTENDEE'
    CHECK (participant_role IN ('ATTENDEE', 'TEACHER')),
  expectation TEXT NOT NULL DEFAULT 'EXPECTED'
    CHECK (expectation IN ('EXPECTED', 'OPTIONAL', 'EXCUSED')),
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (user_id IS NOT NULL AND external_email IS NULL)
    OR (user_id IS NULL AND external_email IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS session_participants_user_unique
  ON public.session_participants (session_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS session_participants_email_unique
  ON public.session_participants (session_id, lower(external_email))
  WHERE external_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS session_participants_session_idx
  ON public.session_participants (session_id, expectation);

ALTER TABLE public.session_participants ENABLE ROW LEVEL SECURITY;
-- Deny-all: authorized application actions use the service DAL.

CREATE TABLE IF NOT EXISTS public.session_activity_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_external_email TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_activity_events_session_idx
  ON public.session_activity_events (session_id, created_at DESC);
ALTER TABLE public.session_activity_events ENABLE ROW LEVEL SECURITY;
-- Deny-all: authorized application actions use the service DAL.

-- v2 source validity. FEEDBACK and RECALL remain valid only for policy-v1
-- historical recomputation. MODERATOR_CONFIRMATION is a reviewed assertion.
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
      RETURN v_session.attendance_policy_version = 1
        AND p_observed_at >= v_session.date_end
        AND p_observed_at <= v_session.date_end + INTERVAL '21 days';
    WHEN 'TEACHER', 'TEAMS', 'MODERATOR_CONFIRMATION' THEN
      RETURN true;
    ELSE
      RETURN false;
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION public.record_attendance_evidence_v2(
  p_org_id UUID,
  p_session_id UUID,
  p_department_id UUID,
  p_user_id UUID,
  p_external_email TEXT,
  p_source evidence_source_type,
  p_observed_at TIMESTAMPTZ,
  p_metadata JSONB,
  p_created_by UUID,
  p_source_event_key TEXT DEFAULT NULL,
  p_correction_reason TEXT DEFAULT NULL
) RETURNS public.attendance AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_existing public.attendance_evidence%ROWTYPE;
  v_primary public.attendance_evidence%ROWTYPE;
  v_status TEXT;
  v_result public.attendance%ROWTYPE;
BEGIN
  IF (p_user_id IS NULL) = (p_external_email IS NULL) THEN
    RAISE EXCEPTION 'Exactly one attendance subject is required';
  END IF;

  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id AND org_id = p_org_id AND department_id = p_department_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF v_session.attendance_phase = 'FINALIZED' OR v_session.attendance_locked THEN
    RAISE EXCEPTION 'Attendance is finalized';
  END IF;
  IF NOT is_evidence_valid(p_session_id, p_source, p_observed_at) THEN
    RAISE EXCEPTION 'Evidence is outside its valid window';
  END IF;
  IF p_source = 'MODERATOR_CONFIRMATION'
     AND (p_correction_reason IS NULL OR length(trim(p_correction_reason)) < 3) THEN
    RAISE EXCEPTION 'Moderator confirmation requires a reason';
  END IF;

  IF p_source_event_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.attendance_evidence
    WHERE session_id = p_session_id AND source_event_key = p_source_event_key;
  END IF;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.attendance_evidence (
      org_id, session_id, department_id, user_id, external_email, source,
      observed_at, metadata, created_by, source_event_key, correction_reason
    ) VALUES (
      p_org_id, p_session_id, p_department_id, p_user_id,
      CASE WHEN p_external_email IS NULL THEN NULL ELSE lower(trim(p_external_email)) END,
      p_source, p_observed_at, COALESCE(p_metadata, '{}'::jsonb), p_created_by,
      p_source_event_key, NULLIF(trim(p_correction_reason), '')
    );
  END IF;

  INSERT INTO public.session_participants (
    org_id, department_id, session_id, user_id, external_email, added_by,
    participant_role, expectation
  ) VALUES (
    p_org_id, p_department_id, p_session_id, p_user_id,
    CASE WHEN p_external_email IS NULL THEN NULL ELSE lower(trim(p_external_email)) END,
    p_created_by, 'ATTENDEE', 'OPTIONAL'
  )
  ON CONFLICT DO NOTHING;

  SELECT ev.* INTO v_primary
  FROM public.attendance_evidence ev
  WHERE ev.session_id = p_session_id
    AND (
      (p_user_id IS NOT NULL AND ev.user_id = p_user_id)
      OR (p_external_email IS NOT NULL AND lower(ev.external_email) = lower(trim(p_external_email)))
    )
    AND is_evidence_valid(p_session_id, ev.source, ev.observed_at)
    AND NOT (
      v_session.attendance_policy_version = 2
      AND ev.source = 'TEACHER'
      AND COALESCE((ev.metadata->>'assigned_as_teacher')::BOOLEAN, false)
    )
  ORDER BY
    CASE ev.source
      WHEN 'MODERATOR_CONFIRMATION' THEN 6
      WHEN 'TEACHER' THEN 5
      WHEN 'TEAMS' THEN 4
      WHEN 'FEEDBACK' THEN 3
      WHEN 'GROUP_CODE' THEN 2
      WHEN 'SELF_CHECKIN' THEN 1
      WHEN 'RECALL' THEN 0
    END DESC,
    ev.observed_at ASC
  LIMIT 1;

  IF v_primary.id IS NULL THEN
    v_status := 'ABSENT';
  ELSIF v_primary.metadata ? 'status_override' THEN
    v_status := v_primary.metadata->>'status_override';
  ELSIF v_primary.observed_at > v_session.date_start
      + (COALESCE(v_session.late_after_mins, 10) || ' minutes')::INTERVAL THEN
    v_status := 'LATE';
  ELSE
    v_status := 'PRESENT';
  END IF;

  IF p_user_id IS NOT NULL THEN
    INSERT INTO public.attendance (
      org_id, session_id, department_id, user_id, external_email, status,
      primary_source, first_evidence_at, computed_at, locked, revision
    ) VALUES (
      p_org_id, p_session_id, p_department_id, p_user_id, NULL,
      v_status, v_primary.source, v_primary.observed_at, now(), false,
      v_session.attendance_revision
    )
    ON CONFLICT (session_id, user_id) WHERE user_id IS NOT NULL
    DO UPDATE SET
      status = EXCLUDED.status,
      primary_source = EXCLUDED.primary_source,
      first_evidence_at = EXCLUDED.first_evidence_at,
      computed_at = now(),
      locked = false,
      revision = EXCLUDED.revision
    RETURNING * INTO v_result;
  ELSE
    INSERT INTO public.attendance (
      org_id, session_id, department_id, user_id, external_email, status,
      primary_source, first_evidence_at, computed_at, locked, revision
    ) VALUES (
      p_org_id, p_session_id, p_department_id, NULL, lower(trim(p_external_email)),
      v_status, v_primary.source, v_primary.observed_at, now(), false,
      v_session.attendance_revision
    )
    ON CONFLICT (session_id, external_email) WHERE external_email IS NOT NULL
    DO UPDATE SET
      status = EXCLUDED.status,
      primary_source = EXCLUDED.primary_source,
      first_evidence_at = EXCLUDED.first_evidence_at,
      computed_at = now(),
      locked = false,
      revision = EXCLUDED.revision
    RETURNING * INTO v_result;
  END IF;

  INSERT INTO public.session_activity_events (
    org_id, department_id, session_id, event_type, actor_user_id,
    subject_user_id, subject_external_email, details
  ) VALUES (
    p_org_id, p_department_id, p_session_id, 'ATTENDANCE_EVIDENCE_RECORDED',
    p_created_by, p_user_id,
    CASE WHEN p_external_email IS NULL THEN NULL ELSE lower(trim(p_external_email)) END,
    jsonb_build_object('source', p_source, 'source_event_key', p_source_event_key)
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.finalize_session_attendance_v2(
  p_org_id UUID,
  p_session_id UUID,
  p_actor_user_id UUID
) RETURNS INTEGER AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_revision INTEGER;
BEGIN
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id AND org_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF v_session.status <> 'PUBLISHED' THEN RAISE EXCEPTION 'Only published sessions can be finalized'; END IF;
  IF v_session.date_end > now() THEN RAISE EXCEPTION 'Attendance cannot be finalized before the session ends'; END IF;

  v_revision := v_session.attendance_revision + 1;

  INSERT INTO public.session_participants (
    org_id, department_id, session_id, user_id, display_name,
    participant_role, expectation, added_by
  )
  SELECT v_session.org_id, v_session.department_id, v_session.id, dm.user_id,
         COALESCE(p.full_name, p.email), 'ATTENDEE', 'EXPECTED', p_actor_user_id
  FROM public.department_members dm
  LEFT JOIN public.profiles p ON p.user_id = dm.user_id
  WHERE dm.department_id = v_session.department_id
  ON CONFLICT DO NOTHING;

  INSERT INTO public.session_participants (
    org_id, department_id, session_id, user_id, display_name,
    participant_role, expectation, added_by
  )
  SELECT v_session.org_id, v_session.department_id, v_session.id, st.user_id,
         COALESCE(p.full_name, p.email), 'TEACHER', 'EXPECTED', p_actor_user_id
  FROM public.session_teachers st
  LEFT JOIN public.profiles p ON p.user_id = st.user_id
  WHERE st.session_id = v_session.id AND st.status = 'ACCEPTED'
  ON CONFLICT (session_id, user_id) WHERE user_id IS NOT NULL
  DO UPDATE SET participant_role = 'TEACHER', expectation = 'EXPECTED', updated_at = now();

  INSERT INTO public.attendance (
    org_id, department_id, session_id, user_id, external_email, status,
    primary_source, first_evidence_at, computed_at, locked, locked_by,
    locked_at, revision, finalized_at, finalized_by
  )
  SELECT sp.org_id, sp.department_id, sp.session_id, sp.user_id, sp.external_email,
         CASE WHEN sp.expectation = 'EXCUSED' THEN 'EXCUSED' ELSE 'ABSENT' END,
         NULL, NULL, now(), true, p_actor_user_id, now(), v_revision, now(), p_actor_user_id
  FROM public.session_participants sp
  WHERE sp.session_id = v_session.id
    AND sp.expectation IN ('EXPECTED', 'EXCUSED')
    AND NOT EXISTS (
      SELECT 1 FROM public.attendance a
      WHERE a.session_id = sp.session_id
        AND ((sp.user_id IS NOT NULL AND a.user_id = sp.user_id)
          OR (sp.external_email IS NOT NULL AND lower(a.external_email) = lower(sp.external_email)))
    )
  ON CONFLICT DO NOTHING;

  UPDATE public.attendance
  SET locked = true, locked_by = p_actor_user_id, locked_at = now(),
      revision = v_revision, finalized_at = now(), finalized_by = p_actor_user_id
  WHERE session_id = v_session.id;

  UPDATE public.sessions
  SET attendance_phase = 'FINALIZED', attendance_locked = true,
      attendance_locked_at = now(), attendance_locked_by = p_actor_user_id,
      attendance_revision = v_revision, attendance_finalized_at = now(),
      attendance_finalized_by = p_actor_user_id
  WHERE id = v_session.id;

  INSERT INTO public.session_activity_events (
    org_id, department_id, session_id, event_type, actor_user_id, details
  ) VALUES (
    v_session.org_id, v_session.department_id, v_session.id,
    'ATTENDANCE_FINALIZED', p_actor_user_id,
    jsonb_build_object('revision', v_revision)
  );

  RETURN v_revision;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.reopen_session_attendance_v2(
  p_org_id UUID,
  p_session_id UUID,
  p_actor_user_id UUID,
  p_reason TEXT
) RETURNS VOID AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'A reopening reason is required';
  END IF;
  SELECT * INTO v_session FROM public.sessions
  WHERE id = p_session_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF v_session.attendance_phase <> 'FINALIZED' THEN
    RAISE EXCEPTION 'Only finalized attendance can be reopened';
  END IF;

  UPDATE public.sessions
  SET attendance_phase = 'REVIEW', attendance_locked = false,
      attendance_locked_at = NULL, attendance_locked_by = NULL,
      attendance_reopened_at = now(), attendance_reopened_by = p_actor_user_id,
      attendance_reopen_reason = trim(p_reason)
  WHERE id = p_session_id;
  UPDATE public.attendance
  SET locked = false, locked_at = NULL, locked_by = NULL
  WHERE session_id = p_session_id;

  INSERT INTO public.session_activity_events (
    org_id, department_id, session_id, event_type, actor_user_id, details
  ) VALUES (
    v_session.org_id, v_session.department_id, v_session.id,
    'ATTENDANCE_REOPENED', p_actor_user_id,
    jsonb_build_object('reason', trim(p_reason), 'revision', v_session.attendance_revision)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.record_attendance_evidence_v2(
  UUID, UUID, UUID, UUID, TEXT, evidence_source_type, TIMESTAMPTZ,
  JSONB, UUID, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_session_attendance_v2(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reopen_session_attendance_v2(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_attendance_evidence_v2(
  UUID, UUID, UUID, UUID, TEXT, evidence_source_type, TIMESTAMPTZ,
  JSONB, UUID, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_session_attendance_v2(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reopen_session_attendance_v2(UUID, UUID, UUID, TEXT) TO service_role;
