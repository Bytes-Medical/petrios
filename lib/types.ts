export type LocationType = 'MS_TEAMS' | 'IN_PERSON' | 'HYBRID' | 'JITSI'
export type SessionStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED'
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED'
export type AttendanceMethod = 'SELF_CHECKIN' | 'MANUAL'
export type CertificateRole = 'ATTENDEE' | 'TEACHER'
export type CertificateRecognitionBasis =
  | 'LIVE_ATTENDANCE'
  | 'AUDIO_RECAP_CATCH_UP'
  | 'TEACHING_ASSIGNMENT'
export type UserRole = 'org_admin' | 'department_admin' | 'faculty' | 'trainee'
export type EmailType = 'INVITATION' | 'REMINDER'
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED'
export type OnboardingLinkType = 'invite' | 'magiclink'
export type OnboardingRequestStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED'
export type FeedbackFieldType = 'rating' | 'textarea' | 'text'
export type TraineeGrade = 'Level 1 Trainee' | 'Level 2 Trainee' | 'Consultant'
export type SessionType = 'STEPP' | 'CLINICAL_SKILLS' | 'SIMULATION' | 'ACADEMIC'

export const TRAINEE_GRADES: TraineeGrade[] = ['Level 1 Trainee', 'Level 2 Trainee', 'Consultant']

// Long form for emails and detail pages; short form for chips and list rows.
export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  MS_TEAMS: 'Microsoft Teams (Online)',
  IN_PERSON: 'In Person',
  HYBRID: 'Hybrid (In Person + Online)',
  JITSI: 'Petrios Meet (Video)',
}

export const LOCATION_TYPE_LABELS_SHORT: Record<LocationType, string> = {
  MS_TEAMS: 'Online',
  IN_PERSON: 'In Person',
  HYBRID: 'Hybrid',
  JITSI: 'Video',
}
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
  lead_name?: string | null
  certificate_coordinator_names?: string[]
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
  attendance_policy_version?: 1 | 2
  attendance_phase?: 'OPEN' | 'REVIEW' | 'FINALIZED'
  attendance_revision?: number
  attendance_finalized_at?: string | null
  attendance_finalized_by?: string | null
  attendance_reopened_at?: string | null
  attendance_reopened_by?: string | null
  attendance_reopen_reason?: string | null
  group_code_hash?: string | null
  report_sent_at?: string | null
  reminder_sent_at?: string | null
}

export interface SessionTeacher {
  id: string
  org_id: string
  session_id: string
  user_id: string
  status: InvitationStatus
  invited_by: string | null
  responded_at: string | null
}

export interface ExternalContact {
  id: string
  org_id: string
  email: string
  first_name: string | null
  last_name: string | null
  role_note: string | null
  archived_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ContactGroup {
  id: string
  org_id: string
  name: string
  created_by: string | null
  created_at: string
}

export interface ContactGroupWithCount extends ContactGroup {
  member_count: number
}

export type SlotStatus = 'OPEN' | 'CLAIMED' | 'CLOSED'
export type SlotDisplayStatus = SlotStatus | 'EXPIRED'

export interface TeachingSlot {
  id: string
  org_id: string
  department_id: string
  date_start: string
  date_end: string
  location_type: LocationType
  status: SlotStatus
  session_id: string | null
  claimed_by_user_id: string | null
  claimed_by_contact_id: string | null
  claimed_name: string | null
  claimed_at: string | null
  topic_suggestion: string | null
  created_by: string
  created_at: string
}

/** Lightweight slot shape for calendar rendering. */
export interface SlotEvent {
  id: string
  department_id: string
  date_start: string
  date_end: string
  location_type: LocationType
  status: SlotStatus
}

export interface AppNotification {
  id: string
  org_id: string
  user_id: string
  type: string
  title: string
  body: string | null
  link: string | null
  dedupe_key?: string | null
  read_at: string | null
  created_at: string
}

export interface Attendance {
  id: string
  org_id: string
  department_id: string
  session_id: string
  user_id: string | null
  invitation_id?: string | null
  external_email: string | null
  status: AttendanceStatus
  primary_source: 'SELF_CHECKIN' | 'GROUP_CODE' | 'FEEDBACK' | 'TEACHER' | 'TEAMS' | 'RECALL' | 'MODERATOR_CONFIRMATION' | null
  first_evidence_at: string | null
  computed_at: string
  locked: boolean
  locked_by: string | null
  locked_at: string | null
  created_at: string
  revision?: number
  finalized_at?: string | null
  finalized_by?: string | null
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
  user_id: string | null
  certificate_role: CertificateRole
  issued_at: string
  pdf_storage_path: string | null
  certificate_code: string
  recipient_name: string | null
  issued_by: string | null
  issued_by_name: string | null
  coordinator_names: string[]
  created_at: string
  recipient_email?: string | null
  status?: 'VALID' | 'REVOKED' | 'LEGACY'
  attendance_revision?: number | null
  issuance_source?: string | null
  recognition_basis?: CertificateRecognitionBasis
  revoked_at?: string | null
  revoked_by?: string | null
  revocation_reason?: string | null
}


// ---------------------------------------------------------------------------
// Petrios Ops (AI agent layer) — rows live in deny-all-RLS ops_* tables and are
// only reachable through lib/db/ops.ts.
// ---------------------------------------------------------------------------

export type OpsActionType =
  | 'SPEAKER_CHASE_EMAIL'
  | 'THANK_YOU_EMAIL'
  | 'NEWSLETTER_ISSUE'
  | 'CUSTOM_EMAIL'
export type OpsActionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed'

export const OPS_ACTION_TYPE_LABELS: Record<OpsActionType, string> = {
  SPEAKER_CHASE_EMAIL: 'Speaker chase',
  THANK_YOU_EMAIL: 'Thank you',
  NEWSLETTER_ISSUE: 'Newsletter',
  CUSTOM_EMAIL: 'Email',
}

export interface OpsPendingAction {
  id: string
  org_id: string
  department_id: string | null
  type: OpsActionType
  payload: Record<string, unknown>
  preview_title: string
  preview_body: string
  status: OpsActionStatus
  created_by: string
  reviewed_by: string | null
  reviewed_at: string | null
  executed_at: string | null
  error: string | null
  created_at: string
}

export interface OpsAgentRun {
  id: string
  org_id: string | null
  kind: string
  trigger: string
  status: 'running' | 'succeeded' | 'failed'
  summary: string | null
  started_at: string
  finished_at: string | null
}

export interface OpsAgentRunStep {
  id: string
  run_id: string
  seq: number
  name: string
  detail: Record<string, unknown> | null
  purpose: string | null
  model: string | null
  prompt_hash: string | null
  input_tokens: number | null
  output_tokens: number | null
  created_at: string
}

export interface OpsSynthesisTheme {
  title: string
  detail: string
  count?: number
}

export interface OpsFeedbackSynthesis {
  id: string
  org_id: string
  department_id: string
  session_id: string
  themes: OpsSynthesisTheme[]
  sentiment: 'positive' | 'mixed' | 'negative'
  suggestions: string[]
  quotes: string[]
  requires_human_review: boolean
  response_count: number
  average_rating: number | null
  model: string | null
  created_at: string
}

export interface OpsSpeakerChase {
  id: string
  org_id: string
  session_id: string
  target_user_id: string | null
  target_invitation_id: string | null
  target_email: string
  chase_count: number
  last_chased_at: string | null
  created_at: string
}

export interface OpsMemoryEntry {
  id: string
  org_id: string
  department_id: string | null
  key: string
  value: string
  source: string
  created_by: string | null
  updated_at: string
}

export type OpsNewsletterStatus = 'draft' | 'approved' | 'sent' | 'failed'

export interface OpsNewsletterSessionSection {
  session_id: string
  title: string
  date_label: string
  overview: string
  learning_points: string[]
}

export interface OpsNewsletterContent {
  subject: string
  intro: string
  sessions: OpsNewsletterSessionSection[]
  closing: string
}

export interface OpsNewsletterSourceDocument {
  sessionId: string
  sessionTitle: string
  id: string
  filename: string
  mimeType: string
  byteSize: number
  sha256: string
}

export interface OpsNewsletterIssue {
  id: string
  org_id: string
  department_id: string | null
  week_start: string
  subject: string
  html: string
  summary_points: { title: string; detail: string }[]
  content: OpsNewsletterContent | null
  source_session_ids: string[]
  source_documents: OpsNewsletterSourceDocument[]
  content_revision: number
  generated_by: string | null
  status: OpsNewsletterStatus
  pending_action_id: string | null
  sent_count: number
  created_at: string
  updated_at: string
}

export interface OpsNewsletterDelivery {
  id: string
  issue_id: string
  org_id: string
  department_id: string
  recipient_user_id: string
  recipient_email: string
  content_revision: number
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED'
  attempt_count: number
  provider_message_id: string | null
  last_error: string | null
  claimed_at: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

export interface OpsChatThread {
  id: string
  org_id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
}

export interface OpsChatMessage {
  id: string
  thread_id: string
  role: 'user' | 'assistant'
  content: string
  tool_summary: { name: string; ok: boolean }[] | null
  created_at: string
}
