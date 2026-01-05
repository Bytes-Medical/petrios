-- Allow super admins to view all departments
CREATE POLICY "Super admins can view departments"
  ON departments FOR SELECT
  USING (is_super_admin());
