-- Update department join request policies to allow department moderators
DROP POLICY IF EXISTS "Org admins can view department join requests in their org" ON department_join_requests;
DROP POLICY IF EXISTS "Org admins can update department join requests in their org" ON department_join_requests;

CREATE POLICY "Department moderators can view department join requests"
  ON department_join_requests FOR SELECT
  USING (is_department_admin(department_id));

CREATE POLICY "Department moderators can update department join requests"
  ON department_join_requests FOR UPDATE
  USING (is_department_admin(department_id))
  WITH CHECK (is_department_admin(department_id));
