export type LocationType = 'MS_TEAMS' | 'IN_PERSON' | 'HYBRID'
export type SessionStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED'
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE'
export type AttendanceMethod = 'SELF_CHECKIN' | 'MANUAL'
export type CertificateRole = 'ATTENDEE' | 'TEACHER'
export type UserRole = 'org_admin' | 'department_admin' | 'faculty' | 'trainee'
export type EmailType = 'INVITATION' | 'REMINDER'
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED'
export type OnboardingLinkType = 'invite' | 'magiclink'
export type OnboardingRequestStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED'
export type FeedbackFieldType = 'rating' | 'textarea' | 'text'
export type TraineeGrade = 'FY1' | 'FY2' | 'ST1' | 'ST2' | 'ST3' | 'ST4' | 'ST5' | 'ST6' | 'ST7' | 'ST8' | 'Consultant'
export type SessionType = 'STEPP' | 'CLINICAL_SKILLS' | 'SIMULATION' | 'ACADEMIC'

export const TRAINEE_GRADES: TraineeGrade[] = ['FY1', 'FY2', 'ST1', 'ST2', 'ST3', 'ST4', 'ST5', 'ST6', 'ST7', 'ST8', 'Consultant']
export const SESSION_TYPES: SessionType[] = ['STEPP', 'CLINICAL_SKILLS', 'SIMULATION', 'ACADEMIC']

export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  STEPP: 'STEPP',
  CLINICAL_SKILLS: 'Clinical Skills',
  SIMULATION: 'Simulation',
  ACADEMIC: 'Academic',
}

export const SESSION_TYPE_COLORS: Record<SessionType, string> = {
  STEPP: 'border-l-blue-500',
  CLINICAL_SKILLS: 'border-l-green-500',
  SIMULATION: 'border-l-orange-500',
  ACADEMIC: 'border-l-purple-500',
}

export const SESSION_TYPE_BG_COLORS: Record<SessionType, string> = {
  STEPP: 'bg-blue-100 text-blue-800',
  CLINICAL_SKILLS: 'bg-green-100 text-green-800',
  SIMULATION: 'bg-orange-100 text-orange-800',
  ACADEMIC: 'bg-purple-100 text-purple-800',
}

export interface Department {
  id: string
  org_id: string
  name: string
  department_code: string
  created_by: string
  created_at: string
  feedback_form_fields?: DepartmentFeedbackField[]
}

export interface DepartmentFeedbackField {
  id: string
  type: FeedbackFieldType
  label: string
  required: boolean
  commentLabel?: string | null
  placeholder?: string | null
}

export interface FeedbackAnswerInput {
  fieldId: string
  value?: string
  comment?: string
}

export interface SubmittedFeedbackAnswer {
  fieldId: string
  type: FeedbackFieldType
  label: string
  value: string | null
  commentLabel: string | null
  comment: string | null
}

export interface DepartmentMember {
  id: string
  org_id: string
  department_id: string
  user_id: string
  role: UserRole
  grade: TraineeGrade | null
  created_at: string
}

export interface Profile {
  user_id: string
  email: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  grade: TraineeGrade | null
  email_verified_at: string | null
  created_at: string
  updated_at: string
}

export interface DepartmentInviteLink {
  id: string
  org_id: string
  department_id: string
  invite_code: string
  created_by: string | null
  rotated_at: string | null
  created_at: string
  updated_at: string
}

export interface MemberOnboardingRequest {
  id: string
  org_id: string
  department_id: string
  invite_link_id: string
  email: string
  first_name: string
  last_name: string
  grade: TraineeGrade | null
  requested_role: UserRole
  link_type: OnboardingLinkType
  status: OnboardingRequestStatus
  requested_user_id: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface ManagedDepartmentInviteLink {
  department_id: string
  department_name: string
  department_code: string
  invite_code: string
  invite_url: string
  rotated_at: string | null
}

export interface ManagedOrgMember {
  user_id: string
  email: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  role: UserRole
  joined_at: string
  department_names: string[]
  removable: boolean
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
  session_type: SessionType | null
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
  report_sent_at?: string | null
  reminder_sent_at?: string | null
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

export interface TeacherEmail {
  id: string
  org_id: string
  session_id: string
  user_id: string
  email_type: EmailType
  recipient_email: string
  sent_at: string
  sent_by: string
  resend_id: string | null
  created_at: string
}

export interface TeacherInvitation {
  id: string
  org_id: string
  session_id: string
  email: string
  first_name: string | null
  last_name: string | null
  invite_code: string
  status: InvitationStatus
  sent_by: string
  sent_at: string
  responded_at: string | null
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
  recipient_name: string | null
  issued_by: string | null
  issued_by_name: string | null
  created_at: string
}

// -----------------------------------------------------------------------------
// Presentations (teaching slide decks)
// -----------------------------------------------------------------------------

export type SlideBlockType = 'text' | 'image' | 'shape'

export type SlideShapeKind = 'rectangle' | 'ellipse' | 'rounded' | 'triangle'

// Colour values may be a raw hex/CSS colour OR a theme token like `theme:accent1`
// resolved at render via resolveColor() — so changing theme recolours decks and
// existing hex values stay valid (backward-compatible).
export interface SlideBlockStyle {
  fontSize?: number
  fontWeight?: 'normal' | 'bold'
  italic?: boolean
  align?: 'left' | 'center' | 'right'
  color?: string
  background?: string
  highlight?: string
  fontFamily?: string
  lineHeight?: number
  shape?: SlideShapeKind
  borderColor?: string
  borderWidth?: number
  borderStyle?: 'solid' | 'dashed' | 'dotted'
  radius?: number
}

export interface SlideGradient {
  type: 'linear'
  angle: number
  stops: { color: string; pos: number }[]
}

// Block geometry is in stage pixels against a fixed design stage (see
// lib/slides.ts SLIDE_STAGE_WIDTH/HEIGHT); the editor and present view scale the
// whole stage to fit their container so layouts stay resolution-independent.
export interface SlideBlock {
  id: string
  type: SlideBlockType
  x: number
  y: number
  w: number
  h: number
  z: number
  content: string // text for text blocks; image URL for image; '' for shape
  html?: string // rich-text HTML (supersedes content when present)
  rotation?: number // degrees
  opacity?: number // 0..1
  style?: SlideBlockStyle
}

export interface Slide {
  id: string
  background?: string
  backgroundGradient?: SlideGradient
  notes?: string
  layout?: string
  blocks: SlideBlock[]
}

export interface Presentation {
  id: string
  org_id: string
  department_id: string
  session_id: string | null
  title: string
  theme: string
  slides: Slide[]
  customColors?: string[]
  created_by: string
  created_at: string
  updated_at: string
}
