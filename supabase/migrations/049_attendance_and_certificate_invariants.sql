-- 049: Close legacy bypasses around attendance v2 and make certificate state
-- follow attendance finalization automatically.

-- v2 evidence must pass through the transactional service-role RPC. Direct
-- client inserts remain available only for policy-v1 historical sessions.
DROP POLICY IF EXISTS "Users can create self check-in evidence" ON public.attendance_evidence;
CREATE POLICY "Users can create self check-in evidence"
  ON public.attendance_evidence FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.organization_members WHERE user_id = auth.uid()
    )
    AND source = 'SELF_CHECKIN'
    AND user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = attendance_evidence.session_id
        AND s.org_id = attendance_evidence.org_id
        AND s.department_id = attendance_evidence.department_id
        AND s.attendance_policy_version = 1
    )
  );

DROP POLICY IF EXISTS "Users can create group code evidence" ON public.attendance_evidence;
CREATE POLICY "Users can create group code evidence"
  ON public.attendance_evidence FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.organization_members WHERE user_id = auth.uid()
    )
    AND source = 'GROUP_CODE'
    AND user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = attendance_evidence.session_id
        AND s.org_id = attendance_evidence.org_id
        AND s.department_id = attendance_evidence.department_id
        AND s.status = 'PUBLISHED'
        AND s.group_code_enabled = true
        AND s.attendance_policy_version = 1
    )
  );

DROP POLICY IF EXISTS "Users can create feedback evidence" ON public.attendance_evidence;
CREATE POLICY "Users can create feedback evidence"
  ON public.attendance_evidence FOR INSERT
  WITH CHECK (
    source = 'FEEDBACK'
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = attendance_evidence.session_id
        AND s.org_id = attendance_evidence.org_id
        AND s.department_id = attendance_evidence.department_id
        AND s.status = 'PUBLISHED'
        AND s.attendance_policy_version = 1
    )
  );

DROP POLICY IF EXISTS "Faculty can create teacher evidence" ON public.attendance_evidence;
CREATE POLICY "Faculty can create teacher evidence"
  ON public.attendance_evidence FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.organization_members WHERE user_id = auth.uid()
    )
    AND source = 'TEACHER'
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = attendance_evidence.session_id
        AND s.org_id = attendance_evidence.org_id
        AND s.department_id = attendance_evidence.department_id
        AND s.attendance_policy_version = 1
        AND (
          is_org_admin()
          OR is_department_admin(s.department_id)
          OR EXISTS (
            SELECT 1 FROM public.session_teachers st
            WHERE st.session_id = s.id AND st.user_id = auth.uid()
          )
        )
    )
  );

-- Attendance evidence is append-only for every role. Corrections are new
-- MODERATOR_CONFIRMATION rows with a required reason.
DROP POLICY IF EXISTS "Only org admins can delete evidence" ON public.attendance_evidence;

-- The deterministic legacy helper is no longer part of the runtime. New codes
-- are random and only a salted scrypt verifier is stored.
REVOKE ALL ON FUNCTION public.generate_group_code(UUID, INTEGER) FROM PUBLIC;

-- In-app attendance notifications are idempotent per user and lifecycle event.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_user_dedupe_unique'
      AND conrelid = 'public.notifications'::regclass
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_user_dedupe_unique UNIQUE (user_id, dedupe_key);
  END IF;
END
$$;

-- A VALID certificate cannot be inserted unless it matches the current,
-- finalized attendance revision. This database gate protects every issue path,
-- including future jobs and direct application writes.
CREATE OR REPLACE FUNCTION public.enforce_valid_certificate_eligibility()
RETURNS TRIGGER AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_attendance public.attendance%ROWTYPE;
BEGIN
  IF NEW.status <> 'VALID' THEN RETURN NEW; END IF;
  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'Valid certificates require a registered user';
  END IF;

  SELECT * INTO v_session FROM public.sessions WHERE id = NEW.session_id;
  IF NOT FOUND
     OR v_session.status <> 'PUBLISHED'
     OR v_session.date_end > now()
     OR v_session.attendance_phase <> 'FINALIZED' THEN
    RAISE EXCEPTION 'Certificate session is not eligible';
  END IF;

  SELECT * INTO v_attendance
  FROM public.attendance
  WHERE session_id = NEW.session_id
    AND user_id = NEW.user_id
    AND status IN ('PRESENT', 'LATE')
    AND finalized_at IS NOT NULL
    AND revision = v_session.attendance_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Certificate requires current finalized attendance';
  END IF;

  IF NEW.certificate_role = 'TEACHER' AND NOT EXISTS (
    SELECT 1 FROM public.session_teachers st
    WHERE st.session_id = NEW.session_id
      AND st.user_id = NEW.user_id
      AND st.status = 'ACCEPTED'
  ) THEN
    RAISE EXCEPTION 'Teacher certificate requires an accepted assignment';
  END IF;

  NEW.attendance_revision := v_session.attendance_revision;
  NEW.recipient_email := CASE
    WHEN NEW.recipient_email IS NULL THEN NULL
    ELSE lower(trim(NEW.recipient_email))
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS certificates_valid_eligibility ON public.certificates;
CREATE TRIGGER certificates_valid_eligibility
  BEFORE INSERT OR UPDATE OF status, attendance_revision, user_id,
    session_id, certificate_role
  ON public.certificates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_valid_certificate_eligibility();

CREATE OR REPLACE FUNCTION public.record_certificate_issuance_activity()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.session_activity_events (
    org_id, department_id, session_id, event_type, actor_user_id,
    subject_user_id, subject_external_email, details
  ) VALUES (
    NEW.org_id, NEW.department_id, NEW.session_id, 'CERTIFICATE_ISSUED',
    NEW.issued_by, NEW.user_id, NEW.recipient_email,
    jsonb_build_object(
      'certificate_id', NEW.id,
      'certificate_code', NEW.certificate_code,
      'certificate_role', NEW.certificate_role,
      'issuance_source', NEW.issuance_source,
      'attendance_revision', NEW.attendance_revision,
      'status', NEW.status
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS certificates_issuance_activity ON public.certificates;
CREATE TRIGGER certificates_issuance_activity
  AFTER INSERT ON public.certificates
  FOR EACH ROW EXECUTE FUNCTION public.record_certificate_issuance_activity();

-- Reopening attendance immediately revokes every canonical certificate for the
-- old revision and clears the post-session watermark. Finalization rejects
-- duplicate calls, normalizes the expected roster, and revokes any canonical
-- certificate that no longer has an eligible result.
CREATE OR REPLACE FUNCTION public.apply_attendance_lifecycle_invariants()
RETURNS TRIGGER AS $$
DECLARE
  v_revoked INTEGER := 0;
BEGIN
  IF OLD.attendance_phase = 'FINALIZED'
     AND NEW.attendance_phase = 'FINALIZED'
     AND NEW.attendance_revision IS DISTINCT FROM OLD.attendance_revision THEN
    RAISE EXCEPTION 'Attendance is already finalized; reopen it before creating a new revision';
  END IF;

  IF OLD.attendance_phase = 'FINALIZED' AND NEW.attendance_phase = 'REVIEW' THEN
    NEW.report_sent_at := NULL;
    UPDATE public.certificates
    SET status = 'REVOKED', revoked_at = now(), revoked_by = NEW.attendance_reopened_by,
        revocation_reason = 'Attendance reopened for documented review'
    WHERE session_id = NEW.id AND status = 'VALID';
    GET DIAGNOSTICS v_revoked = ROW_COUNT;

    INSERT INTO public.session_activity_events (
      org_id, department_id, session_id, event_type, actor_user_id, details
    ) VALUES (
      NEW.org_id, NEW.department_id, NEW.id, 'CERTIFICATES_REVOKED_FOR_REVIEW',
      NEW.attendance_reopened_by,
      jsonb_build_object('attendance_revision', OLD.attendance_revision, 'revoked_count', v_revoked)
    );
  ELSIF NEW.attendance_phase = 'FINALIZED'
        AND OLD.attendance_phase IS DISTINCT FROM 'FINALIZED' THEN
    UPDATE public.session_participants sp
    SET expectation = CASE WHEN sp.expectation = 'EXCUSED' THEN 'EXCUSED' ELSE 'EXPECTED' END,
        updated_at = now()
    WHERE sp.session_id = NEW.id
      AND sp.user_id IN (
        SELECT dm.user_id FROM public.department_members dm
        WHERE dm.department_id = NEW.department_id
      );

    UPDATE public.certificates c
    SET status = 'REVOKED', revoked_at = now(), revoked_by = NEW.attendance_finalized_by,
        revocation_reason = 'Recipient is not eligible in the finalized attendance revision'
    WHERE c.session_id = NEW.id
      AND c.status = 'VALID'
      AND NOT EXISTS (
        SELECT 1 FROM public.attendance a
        WHERE a.session_id = NEW.id
          AND a.user_id = c.user_id
          AND a.status IN ('PRESENT', 'LATE')
          AND a.revision = NEW.attendance_revision
          AND a.finalized_at IS NOT NULL
      );
    GET DIAGNOSTICS v_revoked = ROW_COUNT;

    INSERT INTO public.session_activity_events (
      org_id, department_id, session_id, event_type, actor_user_id, details
    ) VALUES (
      NEW.org_id, NEW.department_id, NEW.id, 'CERTIFICATE_ELIGIBILITY_RECONCILED',
      NEW.attendance_finalized_by,
      jsonb_build_object('attendance_revision', NEW.attendance_revision, 'revoked_count', v_revoked)
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS sessions_attendance_lifecycle_invariants ON public.sessions;
CREATE TRIGGER sessions_attendance_lifecycle_invariants
  BEFORE UPDATE OF attendance_phase, attendance_revision ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.apply_attendance_lifecycle_invariants();
