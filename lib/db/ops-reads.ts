import { getServiceDb } from './client'
import { toDbError } from './errors'

/**
 * Read-only core-table queries for the Petrios Ops layer (crons + assistant
 * tools). Kept separate from both the core entity modules (so the ops layer
 * stays droppable) and lib/db/ops.ts (which touches ops_* tables only).
 *
 * Service-role by necessity — crons have no user session and the assistant
 * aggregates across users. Every function here is a SELECT; the ops layer
 * never writes core tables. Callers gate authorization (requireOrgManager or
 * CRON_SECRET).
 */

export interface OpsSessionRow {
  id: string
  org_id: string
  department_id: string
  title: string
  description: string | null
  date_start: string
  date_end: string
  location_type: string
  status: string
  session_type: string | null
}

const SESSION_COLUMNS =
  'id, org_id, department_id, title, description, date_start, date_end, location_type, status, session_type'

/** Published sessions (platform-wide) starting within the next N days. */
export async function listUpcomingPublishedSessions(
  withinDays: number,
  limit = 50
): Promise<OpsSessionRow[]> {
  const db = await getServiceDb()
  const now = new Date()
  const windowEnd = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000)

  const { data, error } = await db
    .from('sessions')
    .select(SESSION_COLUMNS)
    .eq('status', 'PUBLISHED')
    .gt('date_start', now.toISOString())
    .lte('date_start', windowEnd.toISOString())
    .order('date_start', { ascending: true })
    .limit(limit)

  if (error) throw toDbError('Failed to list upcoming sessions', error)
  return (data as OpsSessionRow[] | null) ?? []
}

/** Published sessions for one org starting within the next N days. */
export async function listUpcomingSessionsForOrg(
  orgId: string,
  withinDays: number,
  limit = 20
): Promise<OpsSessionRow[]> {
  const db = await getServiceDb()
  const now = new Date()
  const windowEnd = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000)

  const { data, error } = await db
    .from('sessions')
    .select(SESSION_COLUMNS)
    .eq('org_id', orgId)
    .eq('status', 'PUBLISHED')
    .gt('date_start', now.toISOString())
    .lte('date_start', windowEnd.toISOString())
    .order('date_start', { ascending: true })
    .limit(limit)

  if (error) throw toDbError('Failed to list upcoming org sessions', error)
  return (data as OpsSessionRow[] | null) ?? []
}

/** Published sessions for an org whose end date falls inside [startIso, endIso). */
export async function listSessionsEndedInWindow(
  orgId: string,
  startIso: string,
  endIso: string,
  limit = 30
): Promise<OpsSessionRow[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('sessions')
    .select(SESSION_COLUMNS)
    .eq('org_id', orgId)
    .eq('status', 'PUBLISHED')
    .gte('date_end', startIso)
    .lt('date_end', endIso)
    .order('date_start', { ascending: true })
    .limit(limit)

  if (error) throw toDbError('Failed to list delivered sessions', error)
  return (data as OpsSessionRow[] | null) ?? []
}

/** Published sessions for an org starting inside [startIso, endIso). */
export async function listSessionsStartingInWindow(
  orgId: string,
  startIso: string,
  endIso: string,
  limit = 30
): Promise<OpsSessionRow[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('sessions')
    .select(SESSION_COLUMNS)
    .eq('org_id', orgId)
    .eq('status', 'PUBLISHED')
    .gte('date_start', startIso)
    .lt('date_start', endIso)
    .order('date_start', { ascending: true })
    .limit(limit)

  if (error) throw toDbError('Failed to list upcoming window sessions', error)
  return (data as OpsSessionRow[] | null) ?? []
}

/**
 * Published sessions that ended between `minDaysAgo` and `maxDaysAgo` days
 * ago (platform-wide) — the synthesis cron's candidate pool. The recency
 * floor keeps old history from being re-scanned forever.
 */
export async function listSessionsEndedBetween(
  minDaysAgo: number,
  maxDaysAgo: number,
  limit = 30
): Promise<OpsSessionRow[]> {
  const db = await getServiceDb()
  const now = Date.now()
  const newest = new Date(now - minDaysAgo * 24 * 60 * 60 * 1000).toISOString()
  const oldest = new Date(now - maxDaysAgo * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await db
    .from('sessions')
    .select(SESSION_COLUMNS)
    .eq('status', 'PUBLISHED')
    .gte('date_end', oldest)
    .lte('date_end', newest)
    .order('date_end', { ascending: true })
    .limit(limit)

  if (error) throw toDbError('Failed to list ended sessions', error)
  return (data as OpsSessionRow[] | null) ?? []
}

/** One session, org-scoped (returns null rather than leaking across orgs). */
export async function findSessionInOrg(
  sessionId: string,
  orgId: string
): Promise<OpsSessionRow | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('sessions')
    .select(SESSION_COLUMNS)
    .eq('id', sessionId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch session', error)
  return (data as OpsSessionRow | null) ?? null
}

export interface OpsSessionTeacherRow {
  session_id: string
  user_id: string
  status: string
}

export async function listTeachersForSessions(
  sessionIds: string[]
): Promise<OpsSessionTeacherRow[]> {
  if (sessionIds.length === 0) return []
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_teachers')
    .select('session_id, user_id, status')
    .in('session_id', sessionIds)

  if (error) throw toDbError('Failed to list session teachers', error)
  return (data as OpsSessionTeacherRow[] | null) ?? []
}

export interface OpsInvitationRow {
  id: string
  session_id: string
  email: string
  first_name: string | null
  last_name: string | null
  invite_code: string
  status: string
}

export async function listInvitationsForSessions(
  sessionIds: string[]
): Promise<OpsInvitationRow[]> {
  if (sessionIds.length === 0) return []
  const db = await getServiceDb()
  const { data, error } = await db
    .from('teacher_invitations')
    .select('id, session_id, email, first_name, last_name, invite_code, status')
    .in('session_id', sessionIds)

  if (error) throw toDbError('Failed to list session invitations', error)
  return (data as OpsInvitationRow[] | null) ?? []
}

export interface OpsOrganizationRow {
  id: string
  name: string
  is_personal: boolean | null
}

export async function listOrganizations(): Promise<OpsOrganizationRow[]> {
  const db = await getServiceDb()
  const { data, error } = await db.from('organizations').select('id, name, is_personal')

  if (error) throw toDbError('Failed to list organizations', error)
  return (data as OpsOrganizationRow[] | null) ?? []
}

/** Department admins for a department — the moderator notification audience. */
export async function listDepartmentModeratorUserIds(
  departmentId: string
): Promise<string[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('department_members')
    .select('user_id')
    .eq('department_id', departmentId)
    .eq('role', 'department_admin')

  if (error) throw toDbError('Failed to list department moderators', error)
  return ((data as { user_id: string }[] | null) ?? []).map((r) => r.user_id)
}

export async function listOrgAdminUserIds(orgId: string): Promise<string[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'org_admin')

  if (error) throw toDbError('Failed to list org admins', error)
  return ((data as { user_id: string }[] | null) ?? []).map((r) => r.user_id)
}

/** Published sessions for an org since a given date — curriculum mapping pool. */
export async function listPublishedSessionsForOrgSince(
  orgId: string,
  sinceIso: string,
  limit = 100
): Promise<OpsSessionRow[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('sessions')
    .select(SESSION_COLUMNS)
    .eq('org_id', orgId)
    .eq('status', 'PUBLISHED')
    .gte('date_start', sinceIso)
    .order('date_start', { ascending: false })
    .limit(limit)

  if (error) throw toDbError('Failed to list org sessions', error)
  return (data as OpsSessionRow[] | null) ?? []
}
