import type { LocationType, Session, SessionStatus, SessionTeacher } from '@/lib/types'
import { getDb } from './client'
import { DbNotFoundError, toDbError } from './errors'

// -----------------------------------------------------------------------------
// Sessions
// -----------------------------------------------------------------------------

export interface InsertSessionInput {
  orgId: string
  departmentId: string
  title: string
  description?: string | null
  dateStart: string
  dateEnd: string
  locationType: LocationType
  sessionType?: string | null
  createdBy: string
}

export async function insertSession(input: InsertSessionInput): Promise<Session> {
  const db = await getDb()
  const { data, error } = await db
    .from('sessions')
    .insert({
      org_id: input.orgId,
      department_id: input.departmentId,
      title: input.title,
      description: input.description ?? null,
      date_start: input.dateStart,
      date_end: input.dateEnd,
      location_type: input.locationType,
      session_type: input.sessionType ?? null,
      teams_meeting_url: null,
      status: 'DRAFT' as SessionStatus,
      tags: null,
      capacity: null,
      created_by: input.createdBy,
    })
    .select()
    .single()

  if (error) throw toDbError('Failed to create session', error)
  return data as Session
}

export async function listSessionsByOrg(
  orgId: string,
  options: { departmentId?: string } = {}
): Promise<Session[]> {
  const db = await getDb()
  let query = db
    .from('sessions')
    .select('*')
    .eq('org_id', orgId)
    .order('date_start', { ascending: true })

  if (options.departmentId) {
    query = query.eq('department_id', options.departmentId)
  }

  const { data, error } = await query
  if (error) throw toDbError('Failed to list sessions', error)
  return (data as Session[] | null) ?? []
}

export async function findSession(id: string, orgId: string): Promise<Session | null> {
  const db = await getDb()
  const { data, error } = await db
    .from('sessions')
    .select('*')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch session', error)
  return (data as Session | null) ?? null
}

export async function getSessionOrThrow(id: string, orgId: string): Promise<Session> {
  const row = await findSession(id, orgId)
  if (!row) throw new DbNotFoundError(`Session ${id} not found`)
  return row
}

/**
 * Fetch a session by id without an org filter. The caller is expected to
 * verify authorization separately — this is used in attendance flows where
 * the org context comes from the user and RLS then acts as a safety net.
 */
export async function findSessionById(id: string): Promise<Session | null> {
  const db = await getDb()
  const { data, error } = await db
    .from('sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch session', error)
  return (data as Session | null) ?? null
}

/**
 * Public read of a session with the embedded department's feedback form
 * fields. Used from the anonymous feedback page so attendees can submit
 * feedback without being signed in.
 */
export interface SessionWithDepartmentFeedback extends Session {
  departments: { feedback_form_fields: unknown } | null
}

export async function findPublishedSessionWithFeedbackFields(
  id: string
): Promise<SessionWithDepartmentFeedback | null> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()
  const { data, error } = await db
    .from('sessions')
    .select('*, departments:department_id (feedback_form_fields)')
    .eq('id', id)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch session with feedback fields', error)
  return (data as SessionWithDepartmentFeedback | null) ?? null
}

/**
 * Public read of all published sessions for a department, used by the
 * department-level feedback landing page to pick the currently "active"
 * session based on its time window.
 */
export async function listPublishedSessionsForDepartmentPublic(
  departmentId: string
): Promise<Session[]> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()
  const { data, error } = await db
    .from('sessions')
    .select('*')
    .eq('department_id', departmentId)
    .eq('status', 'PUBLISHED')
    .order('date_start', { ascending: false })

  if (error) throw toDbError('Failed to fetch department sessions', error)
  return (data as Session[] | null) ?? []
}

/**
 * Service-role read of published sessions for an org. Used by the public
 * ICS calendar feed, which validates a signed token instead of a session.
 */
export async function listPublishedSessionsForOrgPublic(
  orgId: string,
  departmentId?: string
): Promise<Session[]> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()
  let query = db
    .from('sessions')
    .select('*')
    .eq('org_id', orgId)
    .eq('status', 'PUBLISHED')
    .order('date_start', { ascending: true })
  if (departmentId) query = query.eq('department_id', departmentId)

  const { data, error } = await query
  if (error) throw toDbError('Failed to fetch published sessions', error)
  return (data as Session[] | null) ?? []
}

/**
 * Fetch just the scoping fields on a session. Cheap read used by mutations
 * that need to check department/org/status before doing the real work.
 */
export async function findSessionScope(
  id: string,
  orgId: string
): Promise<
  | {
      id: string
      department_id: string
      date_start: string
      date_end: string
      status: SessionStatus
    }
  | null
> {
  const db = await getDb()
  const { data, error } = await db
    .from('sessions')
    .select('id, department_id, date_start, date_end, status')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch session scope', error)
  return (
    (data as {
      id: string
      department_id: string
      date_start: string
      date_end: string
      status: SessionStatus
    } | null) ?? null
  )
}

export async function updateSessionById(
  id: string,
  orgId: string,
  updates: Partial<Session>
): Promise<Session> {
  const db = await getDb()
  const { data, error } = await db
    .from('sessions')
    .update(updates)
    .eq('id', id)
    .eq('org_id', orgId)
    .select()
    .single()

  if (error) throw toDbError('Failed to update session', error)
  return data as Session
}

export async function deleteSessionById(id: string, orgId: string): Promise<void> {
  const db = await getDb()
  const { error } = await db
    .from('sessions')
    .delete()
    .eq('id', id)
    .eq('org_id', orgId)

  if (error) throw toDbError('Failed to delete session', error)
}

// -----------------------------------------------------------------------------
// Session teachers
// -----------------------------------------------------------------------------

export async function listSessionTeachers(
  orgId: string,
  sessionId: string
): Promise<SessionTeacher[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('session_teachers')
    .select('*')
    .eq('org_id', orgId)
    .eq('session_id', sessionId)

  if (error) throw toDbError('Failed to list session teachers', error)
  return (data as SessionTeacher[] | null) ?? []
}

export async function insertSessionTeacher(input: {
  orgId: string
  sessionId: string
  userId: string
}): Promise<SessionTeacher> {
  const db = await getDb()
  const { data, error } = await db
    .from('session_teachers')
    .insert({
      org_id: input.orgId,
      session_id: input.sessionId,
      user_id: input.userId,
    })
    .select()
    .single()

  if (error) throw toDbError('Failed to add session teacher', error)
  return data as SessionTeacher
}

export async function deleteSessionTeacher(input: {
  orgId: string
  sessionId: string
  userId: string
}): Promise<void> {
  const db = await getDb()
  const { error } = await db
    .from('session_teachers')
    .delete()
    .eq('org_id', input.orgId)
    .eq('session_id', input.sessionId)
    .eq('user_id', input.userId)

  if (error) throw toDbError('Failed to remove session teacher', error)
}

/**
 * Check whether a user is a member of the given department. Used when
 * adding a session teacher to ensure the assigned user actually belongs
 * to the department that owns the session.
 */
export async function isDepartmentMember(
  departmentId: string,
  userId: string
): Promise<boolean> {
  const db = await getDb()
  const { data, error } = await db
    .from('department_members')
    .select('id')
    .eq('department_id', departmentId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw toDbError('Failed to check department membership', error)
  return !!data
}

export interface OrgMemberProfile {
  user_id: string
  email: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
}

export async function searchOrgMemberProfiles(
  orgId: string,
  query: string
): Promise<OrgMemberProfile[]> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()

  // Get user IDs in this org
  const { data: members } = await db
    .from('organization_members')
    .select('user_id')
    .eq('org_id', orgId)

  if (!members || members.length === 0) return []

  const userIds = members.map((m) => m.user_id)
  const q = `%${query}%`

  const { data: profiles, error } = await db
    .from('profiles')
    .select('user_id, email, full_name, first_name, last_name')
    .in('user_id', userIds)
    .or(`full_name.ilike.${q},first_name.ilike.${q},last_name.ilike.${q},email.ilike.${q}`)
    .limit(8)

  if (error) throw toDbError('Failed to search org members', error)
  return (profiles ?? []) as OrgMemberProfile[]
}

export interface SessionNeedingReport {
  id: string
  org_id: string
  department_id: string
  title: string
  date_start: string
  date_end: string
  checkin_open_mins_before: number | null
  checkin_close_mins_after: number | null
  feedback_valid_mins_after_end: number | null
  late_after_mins: number | null
  attendance_locked: boolean | null
}

export async function listSessionsNeedingReport(): Promise<SessionNeedingReport[]> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await db
    .from('sessions')
    .select(
      'id, org_id, department_id, title, date_start, date_end, checkin_open_mins_before, checkin_close_mins_after, feedback_valid_mins_after_end, late_after_mins, attendance_locked'
    )
    .eq('status', 'PUBLISHED')
    .lte('date_end', cutoff)
    .is('report_sent_at', null)
    .order('date_end', { ascending: true })
    .limit(10)

  if (error) throw toDbError('Failed to list sessions needing report', error)
  return (data as SessionNeedingReport[] | null) ?? []
}

export interface SessionNeedingReminder {
  id: string
  org_id: string
  department_id: string
  title: string
  date_start: string
  date_end: string
  location_type: string
  teams_meeting_url: string | null
}

/**
 * Service-role: used by the session-reminder cron, which runs without a user
 * session. Published sessions starting within the next 24 hours that have
 * not been reminded yet.
 */
export async function listSessionsNeedingReminder(): Promise<SessionNeedingReminder[]> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()

  const now = new Date()
  const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  const { data, error } = await db
    .from('sessions')
    .select('id, org_id, department_id, title, date_start, date_end, location_type, teams_meeting_url')
    .eq('status', 'PUBLISHED')
    .gt('date_start', now.toISOString())
    .lte('date_start', windowEnd.toISOString())
    .is('reminder_sent_at', null)
    .order('date_start', { ascending: true })
    .limit(20)

  if (error) throw toDbError('Failed to list sessions needing reminder', error)
  return (data as SessionNeedingReminder[] | null) ?? []
}

/** Service-role: see listSessionsNeedingReminder. */
export async function markSessionReminderSent(sessionId: string): Promise<void> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()

  const { error } = await db
    .from('sessions')
    .update({ reminder_sent_at: new Date().toISOString() })
    .eq('id', sessionId)

  if (error) throw toDbError('Failed to mark session reminder sent', error)
}

/**
 * Service-role: used by the post-session cron, which runs without a user
 * session. The caller is the CRON_SECRET-authenticated route.
 */
export async function listSessionTeacherIdsAsSystem(
  sessionId: string
): Promise<string[]> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()

  const { data, error } = await db
    .from('session_teachers')
    .select('user_id')
    .eq('session_id', sessionId)

  if (error) throw toDbError('Failed to list session teachers', error)
  return ((data as { user_id: string }[] | null) ?? []).map((r) => r.user_id)
}

export async function markSessionReportSent(sessionId: string): Promise<void> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()

  const { error } = await db
    .from('sessions')
    .update({ report_sent_at: new Date().toISOString() })
    .eq('id', sessionId)

  if (error) throw toDbError('Failed to mark session report sent', error)
}
