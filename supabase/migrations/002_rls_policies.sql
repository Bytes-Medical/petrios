-- Enable Row Level Security
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;

-- Helper function to get user's org_id (from organization_members)
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS UUID AS $$
DECLARE
  user_org_id UUID;
BEGIN
  SELECT org_id INTO user_org_id
  FROM organization_members
  WHERE user_id = auth.uid()
  LIMIT 1;
  
  RETURN user_org_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper function to check if user is org_admin
CREATE OR REPLACE FUNCTION is_org_admin()
RETURNS BOOLEAN AS $$
DECLARE
  user_org_id UUID;
BEGIN
  user_org_id := get_user_org_id();
  
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = user_org_id
    AND user_id = auth.uid()
    AND role = 'org_admin'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper function to check if user is department_admin for a department
CREATE OR REPLACE FUNCTION is_department_admin(dept_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  user_org_id UUID;
BEGIN
  user_org_id := get_user_org_id();
  
  RETURN EXISTS (
    SELECT 1 FROM department_members
    WHERE org_id = user_org_id
    AND department_id = dept_id
    AND user_id = auth.uid()
    AND role IN ('org_admin', 'department_admin')
  ) OR is_org_admin();
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper function to check if user is faculty for a session
CREATE OR REPLACE FUNCTION is_session_faculty(sess_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  user_org_id UUID;
BEGIN
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
$$ LANGUAGE plpgsql STABLE;

-- Organizations RLS Policies
CREATE POLICY "Users can view organizations they belong to"
  ON organizations FOR SELECT
  USING (
    id IN (
      SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create organizations"
  ON organizations FOR INSERT
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Org admins can update their organizations"
  ON organizations FOR UPDATE
  USING (is_org_admin());

-- Organization Members RLS Policies
CREATE POLICY "Users can view members of their organizations"
  ON organization_members FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Org admins can manage organization members"
  ON organization_members FOR ALL
  USING (is_org_admin())
  WITH CHECK (is_org_admin());

-- Departments RLS Policies
CREATE POLICY "Users can view departments in their org"
  ON departments FOR SELECT
  USING (org_id = get_user_org_id());

CREATE POLICY "Org admins can create departments"
  ON departments FOR INSERT
  WITH CHECK (org_id = get_user_org_id() AND is_org_admin());

CREATE POLICY "Org admins can update departments"
  ON departments FOR UPDATE
  USING (org_id = get_user_org_id() AND is_org_admin());

CREATE POLICY "Org admins can delete departments"
  ON departments FOR DELETE
  USING (org_id = get_user_org_id() AND is_org_admin());

-- Department Members RLS Policies
CREATE POLICY "Users can view department members in their org"
  ON department_members FOR SELECT
  USING (org_id = get_user_org_id());

CREATE POLICY "Org admins can manage department members"
  ON department_members FOR ALL
  USING (org_id = get_user_org_id() AND is_org_admin())
  WITH CHECK (org_id = get_user_org_id() AND is_org_admin());

-- Sessions RLS Policies
CREATE POLICY "Users can view published sessions in their org"
  ON sessions FOR SELECT
  USING (
    org_id = get_user_org_id() AND (
      status = 'PUBLISHED' OR
      created_by = auth.uid() OR
      EXISTS (
        SELECT 1 FROM session_teachers st
        WHERE st.session_id = sessions.id AND st.user_id = auth.uid()
      ) OR
      is_org_admin() OR
      is_department_admin(department_id)
    )
  );

CREATE POLICY "Department admins and org admins can create sessions"
  ON sessions FOR INSERT
  WITH CHECK (
    org_id = get_user_org_id() AND (
      is_org_admin() OR
      is_department_admin(department_id)
    )
  );

CREATE POLICY "Department admins and org admins can update sessions"
  ON sessions FOR UPDATE
  USING (
    org_id = get_user_org_id() AND (
      is_org_admin() OR
      is_department_admin(department_id)
    )
  );

CREATE POLICY "Department admins and org admins can delete sessions"
  ON sessions FOR DELETE
  USING (
    org_id = get_user_org_id() AND (
      is_org_admin() OR
      is_department_admin(department_id)
    )
  );

-- Session Teachers RLS Policies
CREATE POLICY "Users can view session teachers in their org"
  ON session_teachers FOR SELECT
  USING (org_id = get_user_org_id());

CREATE POLICY "Department admins and org admins can manage session teachers"
  ON session_teachers FOR ALL
  USING (
    org_id = get_user_org_id() AND (
      is_org_admin() OR
      EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.id = session_teachers.session_id
        AND is_department_admin(s.department_id)
      )
    )
  )
  WITH CHECK (
    org_id = get_user_org_id() AND (
      is_org_admin() OR
      EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.id = session_teachers.session_id
        AND is_department_admin(s.department_id)
      )
    )
  );

-- Attendance RLS Policies
CREATE POLICY "Users can view their own attendance"
  ON attendance FOR SELECT
  USING (
    org_id = get_user_org_id() AND (
      user_id = auth.uid() OR
      is_org_admin() OR
      EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.id = attendance.session_id
        AND (
          is_department_admin(s.department_id) OR
          is_session_faculty(s.id)
        )
      )
    )
  );

CREATE POLICY "Users can check in themselves"
  ON attendance FOR INSERT
  WITH CHECK (
    org_id = get_user_org_id() AND
    user_id = auth.uid()
  );

CREATE POLICY "Faculty and admins can manage attendance"
  ON attendance FOR ALL
  USING (
    org_id = get_user_org_id() AND (
      is_org_admin() OR
      EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.id = attendance.session_id
        AND (
          is_department_admin(s.department_id) OR
          is_session_faculty(s.id)
        )
      )
    )
  )
  WITH CHECK (
    org_id = get_user_org_id() AND (
      is_org_admin() OR
      EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.id = attendance.session_id
        AND (
          is_department_admin(s.department_id) OR
          is_session_faculty(s.id)
        )
      )
    )
  );

-- Certificates RLS Policies
CREATE POLICY "Users can view their own certificates"
  ON certificates FOR SELECT
  USING (
    org_id = get_user_org_id() AND (
      user_id = auth.uid() OR
      is_org_admin() OR
      is_department_admin(department_id)
    )
  );

CREATE POLICY "Department admins and org admins can create certificates"
  ON certificates FOR INSERT
  WITH CHECK (
    org_id = get_user_org_id() AND (
      is_org_admin() OR
      is_department_admin(department_id)
    )
  );

-- Public certificate verification (no auth required)
CREATE POLICY "Anyone can verify certificates by code"
  ON certificates FOR SELECT
  USING (true);
