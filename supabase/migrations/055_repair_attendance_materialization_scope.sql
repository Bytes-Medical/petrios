-- 055: Repair the attendance materialization schema expected by the policy-v2
-- RPCs introduced in migration 045. Those functions and the application DAL
-- write department_id, but the column was never added to public.attendance.
-- The original user_id NOT NULL constraint also prevented the documented
-- external-email subject shape.

ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS department_id UUID;

-- session_id is the authoritative tenant/scope relationship. Reconcile every
-- historical row rather than trusting a possibly partial earlier write.
UPDATE public.attendance AS attendance_row
SET org_id = session_row.org_id,
    department_id = session_row.department_id
FROM public.sessions AS session_row
WHERE attendance_row.session_id = session_row.id
  AND (
    attendance_row.org_id IS DISTINCT FROM session_row.org_id
    OR attendance_row.department_id IS DISTINCT FROM session_row.department_id
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.attendance
    WHERE department_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot repair attendance scope: a row has no session department';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'attendance_department_id_fkey'
      AND conrelid = 'public.attendance'::regclass
  ) THEN
    ALTER TABLE public.attendance
      ADD CONSTRAINT attendance_department_id_fkey
      FOREIGN KEY (department_id)
      REFERENCES public.departments(id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.attendance
  VALIDATE CONSTRAINT attendance_department_id_fkey;

ALTER TABLE public.attendance
  ALTER COLUMN department_id SET NOT NULL,
  ALTER COLUMN user_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_department_id
  ON public.attendance (department_id);

-- Preserve malformed historical rows for investigation, while enforcing the
-- exactly-one-subject contract for every new or changed row.
ALTER TABLE public.attendance
  DROP CONSTRAINT IF EXISTS attendance_one_subject_check,
  ADD CONSTRAINT attendance_one_subject_check CHECK (
    (user_id IS NOT NULL AND external_email IS NULL)
    OR (user_id IS NULL AND external_email IS NOT NULL)
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.enforce_attendance_session_scope()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
  v_department_id UUID;
BEGIN
  SELECT org_id, department_id
  INTO v_org_id, v_department_id
  FROM public.sessions
  WHERE id = NEW.session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance session not found';
  END IF;
  IF NEW.org_id IS DISTINCT FROM v_org_id
     OR NEW.department_id IS DISTINCT FROM v_department_id THEN
    RAISE EXCEPTION 'Attendance scope does not match its session';
  END IF;

  IF NEW.external_email IS NOT NULL THEN
    NEW.external_email := lower(trim(NEW.external_email));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS attendance_session_scope ON public.attendance;
CREATE TRIGGER attendance_session_scope
  BEFORE INSERT OR UPDATE OF org_id, department_id, session_id, user_id, external_email
  ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.enforce_attendance_session_scope();

COMMENT ON COLUMN public.attendance.department_id IS
  'Materialized department scope; enforced to match attendance.session_id through attendance_session_scope.';
