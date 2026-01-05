-- Ensure super admins can manage departments regardless of org membership
DROP POLICY IF EXISTS "Super admins can create departments" ON departments;
DROP POLICY IF EXISTS "Super admins can update departments" ON departments;
DROP POLICY IF EXISTS "Super admins can delete departments" ON departments;

CREATE POLICY "Super admins can create departments"
  ON departments FOR INSERT
  WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update departments"
  ON departments FOR UPDATE
  USING (is_super_admin());

CREATE POLICY "Super admins can delete departments"
  ON departments FOR DELETE
  USING (is_super_admin());
