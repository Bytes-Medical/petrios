export type LocationType = 'MS_TEAMS' | 'IN_PERSON' | 'HYBRID'
export type SessionStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED'
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE'
export type AttendanceMethod = 'SELF_CHECKIN' | 'MANUAL'
export type CertificateRole = 'ATTENDEE' | 'TEACHER'
export type UserRole = 'org_admin' | 'department_admin' | 'faculty' | 'trainee'

export interface Department {
  id: string
  org_id: string
  name: string
  created_by: string
  created_at: string
}

export interface DepartmentMember {
  id: string
  org_id: string
  department_id: string
  user_id: string
  role: UserRole
  created_at: string
}

export interface Session {
  id: string
  org_id: string
  department_id: string
  title: string
  description: string | null
  date_start: string
  date_end: string
  location_type: LocationType
  teams_meeting_url: string | null
  status: SessionStatus
  created_by: string
  created_at: string
  updated_at: string
  tags: string[] | null
  capacity: number | null
  // Evidence-based attendance fields
  attendance_mode?: 'SELF_CHECKIN' | 'EVIDENCE_AGGREGATION'
  checkin_open_mins_before?: number
  checkin_close_mins_after?: number
  feedback_valid_mins_after_end?: number
  late_after_mins?: number
  require_feedback_for_certificate?: boolean
  group_code_enabled?: boolean
  group_code_version?: number | null
  group_code_expires_at?: string | null
  strict_token_enabled?: boolean
  strict_token_hash?: string | null
  strict_token_rotates_mins?: number
  attendance_locked?: boolean
  attendance_locked_at?: string | null
  attendance_locked_by?: string | null
}

export interface SessionTeacher {
  id: string
  org_id: string
  session_id: string
  user_id: string
}

export interface Attendance {
  id: string
  org_id: string
  session_id: string
  user_id: string | null
  external_email: string | null
  status: AttendanceStatus
  primary_source: 'SELF_CHECKIN' | 'GROUP_CODE' | 'FEEDBACK' | 'TEACHER' | 'TEAMS' | null
  first_evidence_at: string | null
  computed_at: string
  locked: boolean
  locked_by: string | null
  locked_at: string | null
  created_at: string
}

export interface Certificate {
  id: string
  org_id: string
  department_id: string
  session_id: string
  user_id: string
  certificate_role: CertificateRole
  issued_at: string
  pdf_storage_path: string | null
  certificate_code: string
  created_at: string
}
