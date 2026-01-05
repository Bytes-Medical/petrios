-- Department join requests
CREATE TABLE IF NOT EXISTS department_join_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  requested_role TEXT NOT NULL CHECK (requested_role IN ('org_admin', 'department_admin', 'faculty', 'trainee')) DEFAULT 'trainee',
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')) DEFAULT 'PENDING',
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dept_join_requests_pending_unique
  ON department_join_requests(department_id, user_id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_dept_join_requests_org_id
  ON department_join_requests(org_id);

CREATE INDEX IF NOT EXISTS idx_dept_join_requests_department_id
  ON department_join_requests(department_id);

CREATE INDEX IF NOT EXISTS idx_dept_join_requests_user_id
  ON department_join_requests(user_id);

ALTER TABLE department_join_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create department join requests for themselves"
  ON department_join_requests FOR INSERT
  WITH CHECK (user_id = auth.uid() AND status = 'PENDING');

CREATE POLICY "Users can view their own department join requests"
  ON department_join_requests FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Org admins can view department join requests in their org"
  ON department_join_requests FOR SELECT
  USING (org_id = get_user_org_id() AND is_org_admin());

CREATE POLICY "Org admins can update department join requests in their org"
  ON department_join_requests FOR UPDATE
  USING (org_id = get_user_org_id() AND is_org_admin())
  WITH CHECK (org_id = get_user_org_id() AND is_org_admin());

CREATE POLICY "Super admins can manage department join requests"
  ON department_join_requests FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());
