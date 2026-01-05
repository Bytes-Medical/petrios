-- Harden sessions policy against RLS recursion
CREATE OR REPLACE FUNCTION can_view_session(
  sess_id UUID,
  sess_org_id UUID,
  sess_department_id UUID,
  sess_created_by UUID,
  sess_status TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = sess_org_id AND user_id = auth.uid()
  ) THEN
    RETURN FALSE;
  END IF;

  IF sess_status = 'PUBLISHED' OR sess_created_by = auth.uid() THEN
    RETURN TRUE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM session_teachers
    WHERE session_id = sess_id AND user_id = auth.uid()
  ) THEN
    RETURN TRUE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = sess_org_id AND user_id = auth.uid() AND role = 'org_admin'
  ) THEN
    RETURN TRUE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM department_members
    WHERE org_id = sess_org_id
      AND department_id = sess_department_id
      AND user_id = auth.uid()
      AND role IN ('org_admin', 'department_admin')
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

DROP POLICY IF EXISTS "Users can view published sessions in their org" ON sessions;
CREATE POLICY "Users can view published sessions in their org"
  ON sessions FOR SELECT
  USING (
    can_view_session(id, org_id, department_id, created_by, status)
  );
