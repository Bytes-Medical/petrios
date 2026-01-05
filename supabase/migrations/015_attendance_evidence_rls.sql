-- RLS Policies for attendance_evidence (append-only audit trail)

-- Enable RLS
ALTER TABLE attendance_evidence ENABLE ROW LEVEL SECURITY;

-- Users can view evidence for sessions they have access to
CREATE POLICY "Users can view evidence for accessible sessions"
  ON attendance_evidence FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    ) AND (
      -- Can view own evidence
      user_id = auth.uid() OR
      -- Or if they're admin/moderator/faculty for the session
      is_org_admin() OR
      EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.id = attendance_evidence.session_id
        AND (
          is_department_admin(s.department_id) OR
          EXISTS (
            SELECT 1 FROM session_teachers st
            WHERE st.session_id = s.id AND st.user_id = auth.uid()
          )
        )
      )
    )
  );

-- Users can create SELF_CHECKIN evidence for themselves
CREATE POLICY "Users can create self check-in evidence"
  ON attendance_evidence FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    ) AND
    source = 'SELF_CHECKIN' AND
    user_id = auth.uid()
  );

-- Users can create GROUP_CODE evidence (public for published sessions)
CREATE POLICY "Users can create group code evidence"
  ON attendance_evidence FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    ) AND
    source = 'GROUP_CODE' AND
    EXISTS (
      SELECT 1 FROM sessions s
      WHERE s.id = attendance_evidence.session_id
      AND s.status = 'PUBLISHED'
      AND s.group_code_enabled = true
    )
  );

-- Users can create FEEDBACK evidence (public for published sessions, but validated)
CREATE POLICY "Users can create feedback evidence"
  ON attendance_evidence FOR INSERT
  WITH CHECK (
    source = 'FEEDBACK' AND
    EXISTS (
      SELECT 1 FROM sessions s
      WHERE s.id = attendance_evidence.session_id
      AND s.status = 'PUBLISHED'
    )
  );

-- Faculty/teachers can create TEACHER evidence
CREATE POLICY "Faculty can create teacher evidence"
  ON attendance_evidence FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    ) AND
    source = 'TEACHER' AND
    (
      is_org_admin() OR
      EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.id = attendance_evidence.session_id
        AND (
          is_department_admin(s.department_id) OR
          EXISTS (
            SELECT 1 FROM session_teachers st
            WHERE st.session_id = s.id AND st.user_id = auth.uid()
          )
        )
      )
    )
  );

-- Only org admins can delete evidence (for audit integrity, prefer no deletes)
CREATE POLICY "Only org admins can delete evidence"
  ON attendance_evidence FOR DELETE
  USING (is_org_admin());

-- No updates allowed (append-only)
CREATE POLICY "No updates to evidence"
  ON attendance_evidence FOR UPDATE
  USING (false);

-- Update attendance RLS policies
DROP POLICY IF EXISTS "Users can view their own attendance" ON attendance;
DROP POLICY IF EXISTS "Users can check in themselves" ON attendance;
DROP POLICY IF EXISTS "Faculty and admins can manage attendance" ON attendance;

-- New attendance policies for computed attendance
CREATE POLICY "Users can view computed attendance"
  ON attendance FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    ) AND (
      user_id = auth.uid() OR
      is_org_admin() OR
      EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.id = attendance.session_id
        AND (
          is_department_admin(s.department_id) OR
          EXISTS (
            SELECT 1 FROM session_teachers st
            WHERE st.session_id = s.id AND st.user_id = auth.uid()
          )
        )
      )
    )
  );

-- Only system can insert/update computed attendance (via server actions with service role)
-- Regular users cannot directly modify computed attendance
CREATE POLICY "System can manage computed attendance"
  ON attendance FOR ALL
  USING (false)
  WITH CHECK (false);

-- Department admins and faculty can lock/unlock attendance
CREATE POLICY "Admins can lock attendance"
  ON attendance FOR UPDATE
  USING (
    org_id IN (
      SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    ) AND (
      is_org_admin() OR
      EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.id = attendance.session_id
        AND (
          is_department_admin(s.department_id) OR
          EXISTS (
            SELECT 1 FROM session_teachers st
            WHERE st.session_id = s.id AND st.user_id = auth.uid()
          )
        )
      )
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    ) AND (
      is_org_admin() OR
      EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.id = attendance.session_id
        AND (
          is_department_admin(s.department_id) OR
          EXISTS (
            SELECT 1 FROM session_teachers st
            WHERE st.session_id = s.id AND st.user_id = auth.uid()
          )
        )
      )
    )
  );
