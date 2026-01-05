-- Fix RLS recursion by running helper functions with row_security disabled
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS UUID AS $$
DECLARE
  user_org_id UUID;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  SELECT org_id INTO user_org_id
  FROM organization_members
  WHERE user_id = auth.uid()
  LIMIT 1;

  RETURN user_org_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_org_admin()
RETURNS BOOLEAN AS $$
DECLARE
  user_org_id UUID;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  user_org_id := get_user_org_id();

  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = user_org_id
    AND user_id = auth.uid()
    AND role = 'org_admin'
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_department_admin(dept_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  user_org_id UUID;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  user_org_id := get_user_org_id();

  RETURN EXISTS (
    SELECT 1 FROM department_members
    WHERE org_id = user_org_id
    AND department_id = dept_id
    AND user_id = auth.uid()
    AND role IN ('org_admin', 'department_admin')
  ) OR is_org_admin();
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_session_faculty(sess_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  user_org_id UUID;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  user_org_id := get_user_org_id();

  RETURN EXISTS (
    SELECT 1 FROM session_teachers
    WHERE org_id = user_org_id
    AND session_id = sess_id
    AND user_id = auth.uid()
  ) OR is_org_admin() OR EXISTS (
    SELECT 1 FROM sessions s
    JOIN department_members dm ON s.department_id = dm.department_id
    WHERE s.id = sess_id
    AND s.org_id = user_org_id
    AND dm.user_id = auth.uid()
    AND dm.role IN ('org_admin', 'department_admin')
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  PERFORM set_config('row_security', 'off', true);
  RETURN EXISTS (
    SELECT 1 FROM super_admins WHERE user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- Replace recursive org member policy
DROP POLICY IF EXISTS "Users can view members of their organizations" ON organization_members;
CREATE POLICY "Users can view members of their organizations"
  ON organization_members FOR SELECT
  USING (org_id = get_user_org_id());
