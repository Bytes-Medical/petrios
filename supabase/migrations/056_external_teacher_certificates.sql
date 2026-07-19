-- 056: Make accepted external teachers first-class attendance-roster and
-- teaching-certificate subjects without requiring an auth account. Invitation
-- acceptance proves assignment only; finalized PRESENT/LATE external-email
-- attendance remains mandatory for a VALID teaching certificate.

CREATE OR REPLACE FUNCTION public.sync_external_teacher_participant()
RETURNS TRIGGER AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_display_name TEXT;
BEGIN
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = NEW.session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Teacher invitation session not found'; END IF;

  -- If an invitation email is ever corrected, the old identity must no longer
  -- remain expected. Evidence/history is retained under the old identity.
  IF TG_OP = 'UPDATE' AND lower(trim(OLD.email)) <> lower(trim(NEW.email)) THEN
    UPDATE public.session_participants
    SET expectation = 'OPTIONAL', updated_at = now()
    WHERE session_id = NEW.session_id
      AND lower(external_email) = lower(trim(OLD.email));
  END IF;

  IF NEW.status = 'ACCEPTED' THEN
    v_display_name := NULLIF(trim(concat_ws(' ', NEW.first_name, NEW.last_name)), '');
    INSERT INTO public.session_participants (
      org_id, department_id, session_id, user_id, external_email, display_name,
      participant_role, expectation, added_by
    ) VALUES (
      v_session.org_id, v_session.department_id, v_session.id, NULL,
      lower(trim(NEW.email)), COALESCE(v_display_name, lower(trim(NEW.email))),
      'TEACHER', 'EXPECTED', NEW.sent_by
    )
    ON CONFLICT (session_id, lower(external_email)) WHERE external_email IS NOT NULL
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      participant_role = 'TEACHER',
      expectation = 'EXPECTED',
      updated_at = now();
  ELSE
    UPDATE public.session_participants
    SET expectation = 'OPTIONAL', updated_at = now()
    WHERE session_id = NEW.session_id
      AND lower(external_email) = lower(trim(NEW.email));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS teacher_invitations_sync_participant
  ON public.teacher_invitations;
CREATE TRIGGER teacher_invitations_sync_participant
  AFTER INSERT OR UPDATE OF status, email, first_name, last_name
  ON public.teacher_invitations
  FOR EACH ROW EXECUTE FUNCTION public.sync_external_teacher_participant();

-- Backfill already-accepted invitations so they can be marked before the next
-- finalization and become explicit ABSENT when no physical evidence exists.
INSERT INTO public.session_participants (
  org_id, department_id, session_id, user_id, external_email, display_name,
  participant_role, expectation, added_by
)
SELECT
  session_row.org_id,
  session_row.department_id,
  invitation.session_id,
  NULL,
  lower(trim(invitation.email)),
  COALESCE(
    NULLIF(trim(concat_ws(' ', invitation.first_name, invitation.last_name)), ''),
    lower(trim(invitation.email))
  ),
  'TEACHER',
  'EXPECTED',
  invitation.sent_by
FROM public.teacher_invitations AS invitation
JOIN public.sessions AS session_row ON session_row.id = invitation.session_id
WHERE invitation.status = 'ACCEPTED'
ON CONFLICT (session_id, lower(external_email)) WHERE external_email IS NOT NULL
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  participant_role = 'TEACHER',
  expectation = 'EXPECTED',
  updated_at = now();

-- Replace the certificate database gate with a dual identity protocol:
-- registered users use user_id; external teachers use invitation_id plus the
-- normalized invitation/attendance email. Both require the current finalized
-- PRESENT/LATE revision.
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

  IF NEW.user_id IS NOT NULL THEN
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
      SELECT 1 FROM public.session_teachers AS teacher
      WHERE teacher.session_id = NEW.session_id
        AND teacher.user_id = NEW.user_id
        AND teacher.status = 'ACCEPTED'
    ) THEN
      RAISE EXCEPTION 'Teacher certificate requires an accepted teacher assignment';
    END IF;
  ELSE
    IF NEW.certificate_role <> 'TEACHER'
       OR NEW.invitation_id IS NULL
       OR NEW.recipient_email IS NULL
       OR NULLIF(trim(NEW.recipient_name), '') IS NULL THEN
      RAISE EXCEPTION 'External certificates require an identified teacher invitation';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.teacher_invitations AS invitation
      WHERE invitation.id = NEW.invitation_id
        AND invitation.session_id = NEW.session_id
        AND invitation.org_id = NEW.org_id
        AND invitation.status = 'ACCEPTED'
        AND lower(trim(invitation.email)) = NEW.recipient_email
    ) THEN
      RAISE EXCEPTION 'External teacher certificate requires the matching accepted invitation';
    END IF;

    SELECT * INTO v_attendance
    FROM public.attendance
    WHERE session_id = NEW.session_id
      AND user_id IS NULL
      AND lower(external_email) = NEW.recipient_email
      AND status IN ('PRESENT', 'LATE')
      AND finalized_at IS NOT NULL
      AND revision = v_session.attendance_revision;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'External teacher certificate requires current finalized attendance';
    END IF;
  END IF;

  NEW.attendance_revision := v_session.attendance_revision;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

COMMENT ON FUNCTION public.enforce_valid_certificate_eligibility() IS
  'Enforces finalized attendance plus accepted registered or external teacher identity for VALID certificates.';
