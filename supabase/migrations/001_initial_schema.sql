-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Departments table
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Department members table
CREATE TABLE department_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('org_admin', 'department_admin', 'faculty', 'trainee')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(department_id, user_id)
);

-- Sessions table
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  date_start TIMESTAMPTZ NOT NULL,
  date_end TIMESTAMPTZ NOT NULL,
  location_type TEXT NOT NULL CHECK (location_type IN ('MS_TEAMS', 'IN_PERSON', 'HYBRID')),
  teams_meeting_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'CANCELLED')) DEFAULT 'DRAFT',
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tags TEXT[],
  capacity INTEGER
);

-- Session teachers table
CREATE TABLE session_teachers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(session_id, user_id)
);

-- Attendance table
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('PRESENT', 'ABSENT', 'LATE')),
  method TEXT NOT NULL CHECK (method IN ('SELF_CHECKIN', 'MANUAL')),
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, user_id)
);

-- Certificates table
CREATE TABLE certificates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  certificate_role TEXT NOT NULL CHECK (certificate_role IN ('ATTENDEE', 'TEACHER')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pdf_storage_path TEXT,
  certificate_code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_departments_org_id ON departments(org_id);
CREATE INDEX idx_department_members_org_id ON department_members(org_id);
CREATE INDEX idx_department_members_department_id ON department_members(department_id);
CREATE INDEX idx_department_members_user_id ON department_members(user_id);
CREATE INDEX idx_sessions_org_id ON sessions(org_id);
CREATE INDEX idx_sessions_department_id ON sessions(department_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_date_start ON sessions(date_start);
CREATE INDEX idx_session_teachers_session_id ON session_teachers(session_id);
CREATE INDEX idx_session_teachers_user_id ON session_teachers(user_id);
CREATE INDEX idx_attendance_session_id ON attendance(session_id);
CREATE INDEX idx_attendance_user_id ON attendance(user_id);
CREATE INDEX idx_certificates_org_id ON certificates(org_id);
CREATE INDEX idx_certificates_user_id ON certificates(user_id);
CREATE INDEX idx_certificates_certificate_code ON certificates(certificate_code);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for sessions updated_at
CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
