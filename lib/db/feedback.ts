import type { DepartmentFeedbackField, SubmittedFeedbackAnswer } from '@/lib/types'
import { getDb, getServiceDb } from './client'
import { toDbError } from './errors'

/**
 * A row returned from session_feedback. The `answers` column is stored as
 * JSONB so we type it loosely here — callers should normalise it through
 * `normalizeSubmittedFeedbackAnswers` before use.
 */
export interface StoredFeedbackRow {
  id: string
  attendee_first_name: string | null
  attendee_last_name: string | null
  attendee_email: string | null
  rating: number | null
  comment: string | null
  answers: unknown
  created_at: string
}

// -----------------------------------------------------------------------------
// Department feedback template
// -----------------------------------------------------------------------------

export async function findDepartmentFeedbackFormFields(
  departmentId: string,
  orgId: string
): Promise<unknown> {
  const db = await getDb()
  const { data, error } = await db
    .from('departments')
    .select('feedback_form_fields')
    .eq('id', departmentId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch feedback template', error)
  return (data as { feedback_form_fields: unknown } | null)?.feedback_form_fields ?? null
}

export async function updateDepartmentFeedbackFormFields(
  departmentId: string,
  orgId: string,
  fields: DepartmentFeedbackField[]
): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('departments')
    .update({ feedback_form_fields: fields })
    .eq('id', departmentId)
    .eq('org_id', orgId)

  if (error) throw toDbError('Failed to update feedback template', error)
}

// -----------------------------------------------------------------------------
// Feedback submission context lookups (service-role, used in public flows)
// -----------------------------------------------------------------------------

export interface FeedbackSessionContext {
  id: string
  org_id: string
  department_id: string
  title: string
  date_start: string
  date_end: string
  checkin_open_mins_before: number | null
  feedback_valid_mins_after_end: number | null
  status: string
}

export async function findSessionForFeedbackSubmission(
  sessionId: string
): Promise<FeedbackSessionContext | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('sessions')
    .select('id, org_id, status, department_id, title, date_start, date_end, checkin_open_mins_before, feedback_valid_mins_after_end')
    .eq('id', sessionId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch session for feedback', error)
  return (data as FeedbackSessionContext | null) ?? null
}

export interface FeedbackDepartmentContext {
  name: string
  lead_name: string | null
  feedback_form_fields: unknown
}

export async function findDepartmentForFeedbackSubmission(
  departmentId: string
): Promise<FeedbackDepartmentContext | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('departments')
    .select('name, lead_name, feedback_form_fields')
    .eq('id', departmentId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch department for feedback', error)
  return (data as FeedbackDepartmentContext | null) ?? null
}

export async function findOrganizationName(orgId: string): Promise<string | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch organization name', error)
  return (data as { name: string } | null)?.name ?? null
}

// -----------------------------------------------------------------------------
// Session feedback rows
// -----------------------------------------------------------------------------

export interface InsertSessionFeedbackInput {
  orgId: string
  sessionId: string
  userId?: string | null
  rating: number | null
  comment: string | null
  answers: SubmittedFeedbackAnswer[]
  firstName: string
  lastName: string
  email: string
  isAnonymous?: boolean
  submissionKey?: string
}

export async function insertSessionFeedback(
  input: InsertSessionFeedbackInput
): Promise<{ id: string }> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_feedback')
    .insert({
      org_id: input.orgId,
      session_id: input.sessionId,
      user_id: input.userId ?? null,
      rating: input.rating,
      comment: input.comment,
      answers: input.answers,
      is_anonymous: input.isAnonymous ?? false,
      attendee_first_name: input.firstName,
      attendee_last_name: input.lastName,
      attendee_email: input.email,
      submission_key: input.submissionKey ?? null,
    })
    .select('id')
    .single()

  if (error) throw toDbError('Failed to submit feedback', error)
  return data as { id: string }
}

export async function listSessionFeedback(
  orgId: string,
  sessionId: string
): Promise<StoredFeedbackRow[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('session_feedback')
    .select('*')
    .eq('org_id', orgId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })

  if (error) throw toDbError('Failed to list session feedback', error)
  return (data as StoredFeedbackRow[] | null) ?? []
}

export async function listSessionFeedbackAudit(
  sessionId: string
): Promise<StoredFeedbackRow[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_feedback')
    .select(
      'id, attendee_first_name, attendee_last_name, attendee_email, rating, comment, answers, created_at'
    )
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })

  if (error) throw toDbError('Failed to fetch feedback audit', error)
  return (data as StoredFeedbackRow[] | null) ?? []
}

export interface FeedbackCommentRow {
  attendee_first_name: string | null
  attendee_last_name: string | null
  comment: string | null
}

export async function listSessionFeedbackComments(
  sessionId: string
): Promise<FeedbackCommentRow[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_feedback')
    .select('attendee_first_name, attendee_last_name, comment')
    .eq('session_id', sessionId)
    .not('comment', 'is', null)
    .order('created_at', { ascending: false })

  if (error) throw toDbError('Failed to fetch feedback comments', error)
  return (data as FeedbackCommentRow[] | null) ?? []
}

// -----------------------------------------------------------------------------
// Helpers for teacher feedback release
// -----------------------------------------------------------------------------

export interface AcceptedTeacherInvitation {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
}

export async function listAcceptedTeacherInvitations(
  sessionId: string
): Promise<AcceptedTeacherInvitation[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('teacher_invitations')
    .select('id, email, first_name, last_name')
    .eq('session_id', sessionId)
    .eq('status', 'ACCEPTED')

  if (error) throw toDbError('Failed to list accepted teacher invitations', error)
  return (data as AcceptedTeacherInvitation[] | null) ?? []
}

export async function listRegisteredSessionTeachers(
  sessionId: string
): Promise<{ id: string; user_id: string }[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_teachers')
    .select('id, user_id')
    .eq('session_id', sessionId)
    .eq('status', 'ACCEPTED')

  if (error) throw toDbError('Failed to list registered session teachers', error)
  return (data as { id: string; user_id: string }[] | null) ?? []
}

export interface TeacherProfile {
  email: string | null
  full_name: string | null
}

export async function findTeacherProfile(
  userId: string
): Promise<TeacherProfile | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('profiles')
    .select('email, full_name')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch teacher profile', error)
  return (data as TeacherProfile | null) ?? null
}

/** Service-role: post-session report recipients (PRESENT registered users). */
export async function listPresentAttendeeUserIds(sessionId: string): Promise<string[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('attendance')
    .select('user_id')
    .eq('session_id', sessionId)
    .eq('status', 'PRESENT')
    .not('user_id', 'is', null)

  if (error) throw toDbError('Failed to list present attendees', error)
  return (((data as { user_id: string | null }[] | null) ?? [])
    .map((r) => r.user_id)
    .filter((id): id is string => !!id))
}
