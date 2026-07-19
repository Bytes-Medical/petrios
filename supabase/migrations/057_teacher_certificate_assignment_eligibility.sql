-- 057: Teaching certificates recognize an accepted teaching assignment after
-- the session has ended and attendance governance has been finalized. They do
-- not assert that the teacher was an attendee and therefore do not require or
-- manufacture a PRESENT/LATE attendance row. Attendee certificates retain the
-- current finalized-attendance requirement.

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
    IF NEW.user_id IS NOT NULL THEN
      IF NEW.invitation_id IS NOT NULL THEN
        RAISE EXCEPTION 'Registered teacher certificates cannot use an external invitation';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.session_teachers AS teacher
        WHERE teacher.session_id = NEW.session_id
          AND teacher.user_id = NEW.user_id
          AND teacher.status = 'ACCEPTED'
      ) THEN
        RAISE EXCEPTION 'Teacher certificate requires an accepted teacher assignment';
      END IF;
    ELSE
      IF NEW.invitation_id IS NULL
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
    END IF;

    -- attendance_revision is the finalized governance snapshot for a teaching
    -- certificate; it does not imply an attendance result for the teacher.
    NEW.attendance_revision := v_session.attendance_revision;
    RETURN NEW;
  END IF;

  IF NEW.certificate_role <> 'ATTENDEE'
     OR NEW.user_id IS NULL
     OR NEW.invitation_id IS NOT NULL THEN
    RAISE EXCEPTION 'Attendee certificates require a registered user';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.session_teachers AS teacher
    WHERE teacher.session_id = NEW.session_id
      AND teacher.user_id = NEW.user_id
      AND teacher.status = 'ACCEPTED'
  ) THEN
    RAISE EXCEPTION 'Accepted teachers receive teaching certificates, not attendee certificates';
  END IF;

  SELECT * INTO v_attendance
  FROM public.attendance
  WHERE session_id = NEW.session_id
    AND user_id = NEW.user_id
    AND status IN ('PRESENT', 'LATE')
    AND finalized_at IS NOT NULL
    AND revision = v_session.attendance_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendee certificate requires current finalized attendance';
  END IF;

  NEW.attendance_revision := v_session.attendance_revision;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS certificates_valid_eligibility ON public.certificates;
CREATE TRIGGER certificates_valid_eligibility
  BEFORE INSERT OR UPDATE OF status, attendance_revision, user_id,
    invitation_id, recipient_email, recipient_name, org_id, department_id,
    session_id, certificate_role
  ON public.certificates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_valid_certificate_eligibility();

-- Finalization reconciliation follows the same split rule. Reopening still
-- revokes every current certificate because it invalidates the shared
-- governance snapshot; a subsequent finalization may issue replacements.
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
    UPDATE public.session_participants AS participant
    SET expectation = CASE
          WHEN participant.expectation = 'EXCUSED' THEN 'EXCUSED'
          ELSE 'EXPECTED'
        END,
        updated_at = now()
    WHERE participant.session_id = NEW.id
      AND participant.user_id IN (
        SELECT member.user_id FROM public.department_members AS member
        WHERE member.department_id = NEW.department_id
      );

    UPDATE public.certificates AS certificate
    SET status = 'REVOKED', revoked_at = now(), revoked_by = NEW.attendance_finalized_by,
        revocation_reason = 'Recipient is not eligible in the finalized session revision'
    WHERE certificate.session_id = NEW.id
      AND certificate.status = 'VALID'
      AND (
        (
          certificate.certificate_role = 'ATTENDEE'
          AND (
            certificate.user_id IS NULL
            OR EXISTS (
              SELECT 1 FROM public.session_teachers AS teacher
              WHERE teacher.session_id = NEW.id
                AND teacher.user_id = certificate.user_id
                AND teacher.status = 'ACCEPTED'
            )
            OR NOT EXISTS (
              SELECT 1 FROM public.attendance AS attendance_row
              WHERE attendance_row.session_id = NEW.id
                AND attendance_row.user_id = certificate.user_id
                AND attendance_row.status IN ('PRESENT', 'LATE')
                AND attendance_row.revision = NEW.attendance_revision
                AND attendance_row.finalized_at IS NOT NULL
            )
          )
        )
        OR (
          certificate.certificate_role = 'TEACHER'
          AND (
            (
              certificate.user_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM public.session_teachers AS teacher
                WHERE teacher.session_id = NEW.id
                  AND teacher.user_id = certificate.user_id
                  AND teacher.status = 'ACCEPTED'
              )
            )
            OR (
              certificate.user_id IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM public.teacher_invitations AS invitation
                WHERE invitation.id = certificate.invitation_id
                  AND invitation.session_id = NEW.id
                  AND invitation.org_id = NEW.org_id
                  AND invitation.status = 'ACCEPTED'
                  AND lower(trim(invitation.email)) = lower(trim(certificate.recipient_email))
              )
            )
          )
        )
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

COMMENT ON FUNCTION public.enforce_valid_certificate_eligibility() IS
  'Requires finalized session governance plus accepted assignment for teachers or finalized physical attendance for attendees.';

