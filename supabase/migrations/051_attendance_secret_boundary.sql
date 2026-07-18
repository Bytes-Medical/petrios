-- 051: Keep short-code verifiers outside member-readable session rows and
-- constrain reviewed attendance evidence to a legitimate session subject.

CREATE TABLE IF NOT EXISTS public.session_attendance_secrets (
  session_id UUID PRIMARY KEY REFERENCES public.sessions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  group_code_verifier TEXT NOT NULL,
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (group_code_verifier ~ '^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$')
);
ALTER TABLE public.session_attendance_secrets ENABLE ROW LEVEL SECURITY;
-- Deny-all: the verifier is reachable only through service-role DAL/RPC paths.

-- Preserve a verifier if migrations 045–050 were already deployed and used,
-- then erase it from the member-readable sessions projection.
INSERT INTO public.session_attendance_secrets (
  session_id, org_id, department_id, group_code_verifier
)
SELECT id, org_id, department_id, group_code_hash
FROM public.sessions
WHERE group_code_hash ~ '^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$'
ON CONFLICT (session_id) DO NOTHING;
UPDATE public.sessions SET group_code_hash = NULL WHERE group_code_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.rotate_session_group_code_v2(
  p_org_id UUID,
  p_department_id UUID,
  p_session_id UUID,
  p_actor_user_id UUID,
  p_version INTEGER,
  p_expires_at TIMESTAMPTZ,
  p_verifier TEXT
) RETURNS TIMESTAMPTZ AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id
    AND org_id = p_org_id
    AND department_id = p_department_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF v_session.status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'Group codes require a published session';
  END IF;
  IF NOT COALESCE(v_session.group_code_enabled, false) THEN
    RAISE EXCEPTION 'Group code is not enabled for this session';
  END IF;
  IF now() > v_session.date_start
      + (COALESCE(v_session.checkin_close_mins_after, 45) || ' minutes')::INTERVAL THEN
    RAISE EXCEPTION 'The group-code check-in window has closed';
  END IF;
  IF p_version <> COALESCE(v_session.group_code_version, 0) + 1 THEN
    RAISE EXCEPTION 'Group-code version is stale';
  END IF;
  IF p_expires_at <= now() THEN RAISE EXCEPTION 'Group-code expiry must be in the future'; END IF;
  IF p_verifier !~ '^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid group-code verifier';
  END IF;

  UPDATE public.sessions
  SET group_code_version = p_version,
      group_code_expires_at = p_expires_at,
      group_code_hash = NULL
  WHERE id = p_session_id;

  INSERT INTO public.session_attendance_secrets (
    session_id, org_id, department_id, group_code_verifier, rotated_at, rotated_by
  ) VALUES (
    p_session_id, p_org_id, p_department_id, p_verifier, now(), p_actor_user_id
  )
  ON CONFLICT (session_id) DO UPDATE SET
    org_id = EXCLUDED.org_id,
    department_id = EXCLUDED.department_id,
    group_code_verifier = EXCLUDED.group_code_verifier,
    rotated_at = now(),
    rotated_by = EXCLUDED.rotated_by;

  INSERT INTO public.session_activity_events (
    org_id, department_id, session_id, event_type, actor_user_id, details
  ) VALUES (
    p_org_id, p_department_id, p_session_id, 'GROUP_CODE_ROTATED', p_actor_user_id,
    jsonb_build_object('version', p_version, 'expires_at', p_expires_at)
  );
  RETURN p_expires_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.rotate_session_group_code_v2(
  UUID, UUID, UUID, UUID, INTEGER, TIMESTAMPTZ, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rotate_session_group_code_v2(
  UUID, UUID, UUID, UUID, INTEGER, TIMESTAMPTZ, TEXT
) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_attendance_evidence_scope()
RETURNS TRIGGER AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM public.sessions WHERE id = NEW.session_id;
  IF NOT FOUND
     OR NEW.org_id <> v_session.org_id
     OR NEW.department_id <> v_session.department_id THEN
    RAISE EXCEPTION 'Attendance evidence tenant/session scope does not match';
  END IF;

  IF v_session.attendance_policy_version = 2
     AND NEW.source IN ('MODERATOR_CONFIRMATION', 'TEAMS') THEN
    IF NEW.user_id IS NOT NULL AND NOT (
      EXISTS (
        SELECT 1 FROM public.department_members dm
        WHERE dm.department_id = v_session.department_id AND dm.user_id = NEW.user_id
      )
      OR EXISTS (
        SELECT 1 FROM public.session_teachers st
        WHERE st.session_id = NEW.session_id
          AND st.user_id = NEW.user_id
          AND st.status = 'ACCEPTED'
      )
      OR EXISTS (
        SELECT 1 FROM public.session_participants sp
        WHERE sp.session_id = NEW.session_id AND sp.user_id = NEW.user_id
      )
      OR EXISTS (
        SELECT 1 FROM public.attendance a
        WHERE a.session_id = NEW.session_id AND a.user_id = NEW.user_id
      )
    ) THEN
      RAISE EXCEPTION 'Reviewed evidence subject is not part of this session scope';
    ELSIF NEW.external_email IS NOT NULL AND NOT (
      EXISTS (
        SELECT 1 FROM public.session_participants sp
        WHERE sp.session_id = NEW.session_id
          AND lower(sp.external_email) = lower(NEW.external_email)
      )
      OR EXISTS (
        SELECT 1 FROM public.attendance a
        WHERE a.session_id = NEW.session_id
          AND lower(a.external_email) = lower(NEW.external_email)
      )
    ) THEN
      RAISE EXCEPTION 'Reviewed external subject is not part of this session scope';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS attendance_evidence_scope ON public.attendance_evidence;
CREATE TRIGGER attendance_evidence_scope
  BEFORE INSERT ON public.attendance_evidence
  FOR EACH ROW EXECUTE FUNCTION public.enforce_attendance_evidence_scope();
