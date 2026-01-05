-- Session feedback table
CREATE TABLE session_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  is_anonymous BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_session_feedback_session_id ON session_feedback(session_id);
CREATE INDEX idx_session_feedback_org_id ON session_feedback(org_id);

-- RLS Policies
-- Allow public feedback submission for published sessions
CREATE POLICY "Anyone can submit feedback for published sessions"
  ON session_feedback FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = session_feedback.session_id
      AND sessions.status = 'PUBLISHED'
    )
  );

CREATE POLICY "Users can view their own feedback"
  ON session_feedback FOR SELECT
  USING (
    org_id = get_user_org_id() AND
    (user_id = auth.uid() OR is_org_admin() OR is_department_admin(
      (SELECT department_id FROM sessions WHERE sessions.id = session_feedback.session_id)
    ))
  );

CREATE POLICY "Department admins and org admins can view all feedback"
  ON session_feedback FOR SELECT
  USING (
    org_id = get_user_org_id() AND (
      is_org_admin() OR
      is_department_admin(
        (SELECT department_id FROM sessions WHERE sessions.id = session_feedback.session_id)
      )
    )
  );
