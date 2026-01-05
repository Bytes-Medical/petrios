-- Super admins table
CREATE TABLE IF NOT EXISTS super_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view themselves"
  ON super_admins FOR SELECT
  USING (user_id = auth.uid());

-- Helper function to check if user is super admin
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM super_admins WHERE user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Organization join requests
CREATE TABLE IF NOT EXISTS organization_join_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  requested_role TEXT NOT NULL CHECK (requested_role IN ('org_admin', 'department_admin', 'faculty', 'trainee')) DEFAULT 'trainee',
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')) DEFAULT 'PENDING',
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_join_requests_pending_unique
  ON organization_join_requests(org_id, user_id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_join_requests_org_id
  ON organization_join_requests(org_id);

CREATE INDEX IF NOT EXISTS idx_join_requests_user_id
  ON organization_join_requests(user_id);

ALTER TABLE organization_join_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create join requests for themselves"
  ON organization_join_requests FOR INSERT
  WITH CHECK (user_id = auth.uid() AND status = 'PENDING');

CREATE POLICY "Users can view their own join requests"
  ON organization_join_requests FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Org admins can view join requests in their org"
  ON organization_join_requests FOR SELECT
  USING (org_id = get_user_org_id() AND is_org_admin());

CREATE POLICY "Org admins can update join requests in their org"
  ON organization_join_requests FOR UPDATE
  USING (org_id = get_user_org_id() AND is_org_admin())
  WITH CHECK (org_id = get_user_org_id() AND is_org_admin());

-- Super admin privileges for organizations and departments
CREATE POLICY "Super admins can create organizations"
  ON organizations FOR INSERT
  WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update organizations"
  ON organizations FOR UPDATE
  USING (is_super_admin());

CREATE POLICY "Super admins can manage organization members"
  ON organization_members FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can create departments"
  ON departments FOR INSERT
  WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update departments"
  ON departments FOR UPDATE
  USING (is_super_admin());

CREATE POLICY "Super admins can delete departments"
  ON departments FOR DELETE
  USING (is_super_admin());

-- Allow authenticated users to list organizations for join requests
CREATE POLICY "Authenticated users can view organizations"
  ON organizations FOR SELECT
  USING (auth.uid() IS NOT NULL);
