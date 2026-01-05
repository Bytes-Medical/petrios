-- Evidence-based attendance system migration
-- This replaces the simple check-in system with an auditable evidence aggregation pipeline

-- Create enums for evidence sources and attendance modes
CREATE TYPE attendance_mode_type AS ENUM ('SELF_CHECKIN', 'EVIDENCE_AGGREGATION');
CREATE TYPE evidence_source_type AS ENUM ('SELF_CHECKIN', 'GROUP_CODE', 'FEEDBACK', 'TEACHER', 'TEAMS');

-- Add attendance configuration to sessions table
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS attendance_mode attendance_mode_type DEFAULT 'EVIDENCE_AGGREGATION',
  ADD COLUMN IF NOT EXISTS checkin_open_mins_before INTEGER DEFAULT 15,
  ADD COLUMN IF NOT EXISTS checkin_close_mins_after INTEGER DEFAULT 45,
  ADD COLUMN IF NOT EXISTS feedback_valid_mins_after_end INTEGER DEFAULT 120,
  ADD COLUMN IF NOT EXISTS late_after_mins INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS require_feedback_for_certificate BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS group_code_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS group_code_version INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS group_code_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS strict_token_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS strict_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS strict_token_rotates_mins INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attendance_locked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS attendance_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendance_locked_by UUID REFERENCES auth.users(id);

-- Create attendance_evidence table (append-only audit trail)
CREATE TABLE attendance_evidence (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  external_email TEXT,
  source evidence_source_type NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Indexes for attendance_evidence
CREATE INDEX idx_attendance_evidence_session_id ON attendance_evidence(session_id);
CREATE INDEX idx_attendance_evidence_user_id ON attendance_evidence(user_id);
CREATE INDEX idx_attendance_evidence_org_id ON attendance_evidence(org_id);
CREATE INDEX idx_attendance_evidence_source ON attendance_evidence(source);
CREATE INDEX idx_attendance_evidence_observed_at ON attendance_evidence(observed_at);

-- Update attendance table to be computed/materialized
-- Note: method column will be removed, but we'll do it carefully
DO $$ 
BEGIN
  -- Drop method column if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'attendance' AND column_name = 'method'
  ) THEN
    ALTER TABLE attendance DROP COLUMN method;
  END IF;
END $$;

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS external_email TEXT,
  ADD COLUMN IF NOT EXISTS primary_source evidence_source_type,
  ADD COLUMN IF NOT EXISTS first_evidence_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS locked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- Update unique constraint to support external_email
ALTER TABLE attendance
  DROP CONSTRAINT IF EXISTS attendance_session_id_user_id_key;

-- Create unique constraints for attendance
CREATE UNIQUE INDEX IF NOT EXISTS attendance_session_user_unique 
  ON attendance(session_id, user_id) 
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_session_email_unique 
  ON attendance(session_id, external_email) 
  WHERE external_email IS NOT NULL;

-- Helper function to generate deterministic group code from session and version
CREATE OR REPLACE FUNCTION generate_group_code(p_session_id UUID, p_version INTEGER) RETURNS TEXT AS $$
DECLARE
  v_chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_hash TEXT;
  v_code TEXT := '';
  i INTEGER;
  v_char_idx INTEGER;
BEGIN
  -- Generate deterministic code from session ID and version
  v_hash := MD5(p_session_id::TEXT || p_version::TEXT || NOW()::DATE::TEXT);
  
  -- Convert hash to 6-character code using character set
  FOR i IN 1..6 LOOP
    -- Extract 2 hex chars, convert to integer, mod by char set length
    v_char_idx := (MOD(('x' || SUBSTRING(v_hash FROM (i-1)*2+1 FOR 2))::BIT(16)::INTEGER, LENGTH(v_chars)) + 1);
    v_code := v_code || SUBSTRING(v_chars FROM v_char_idx FOR 1);
  END LOOP;
  
  RETURN v_code;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to check if evidence is valid based on time windows
CREATE OR REPLACE FUNCTION is_evidence_valid(
  p_session_id UUID,
  p_source evidence_source_type,
  p_observed_at TIMESTAMPTZ
) RETURNS BOOLEAN AS $$
DECLARE
  v_session sessions%ROWTYPE;
  v_checkin_start TIMESTAMPTZ;
  v_checkin_end TIMESTAMPTZ;
  v_feedback_end TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id;
  
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  -- Calculate time windows
  v_checkin_start := v_session.date_start - (v_session.checkin_open_mins_before || ' minutes')::INTERVAL;
  v_checkin_end := v_session.date_start + (v_session.checkin_close_mins_after || ' minutes')::INTERVAL;
  v_feedback_end := v_session.date_end + (v_session.feedback_valid_mins_after_end || ' minutes')::INTERVAL;
  
  -- Validate based on source
  CASE p_source
    WHEN 'SELF_CHECKIN', 'GROUP_CODE' THEN
      RETURN p_observed_at >= v_checkin_start AND p_observed_at <= v_checkin_end;
    WHEN 'FEEDBACK' THEN
      RETURN p_observed_at >= v_checkin_start AND p_observed_at <= v_feedback_end;
    WHEN 'TEACHER', 'TEAMS' THEN
      RETURN true; -- Teacher/Teams evidence is always valid if created
    ELSE
      RETURN false;
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE;
