import type { Session } from '@/lib/types'
import { getServiceDb } from './client'
import { toDbError } from './errors'

/**
 * Data access for the public API (/api/v1). Service-role by necessity:
 * bearer tokens carry no user session, so RLS clients would return nothing.
 * Org scope ALWAYS comes from the authenticated token (lib/api/auth.ts) —
 * every function here takes orgId first and filters on it.
 */

const API_SESSION_COLUMNS =
  'id, org_id, department_id, title, description, date_start, date_end, location_type, teams_meeting_url, status, session_type, created_at, updated_at'

export async function listSessionsForApi(
  orgId: string,
  filters: { fromIso?: string; toIso?: string; departmentId?: string; status?: string; limit?: number }
): Promise<Session[]> {
  const db = await getServiceDb()
  let query = db
    .from('sessions')
    .select(API_SESSION_COLUMNS)
    .eq('org_id', orgId)
    .order('date_start', { ascending: true })
    .limit(Math.min(filters.limit ?? 100, 500))

  if (filters.fromIso) query = query.gte('date_start', filters.fromIso)
  if (filters.toIso) query = query.lte('date_start', filters.toIso)
  if (filters.departmentId) query = query.eq('department_id', filters.departmentId)
  if (filters.status) query = query.eq('status', filters.status)

  const { data, error } = await query
  if (error) throw toDbError('Failed to list sessions', error)
  return (data as Session[] | null) ?? []
}

export async function findSessionForApi(orgId: string, sessionId: string): Promise<Session | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('sessions')
    .select(API_SESSION_COLUMNS)
    .eq('org_id', orgId)
    .eq('id', sessionId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch session', error)
  return (data as Session | null) ?? null
}

export interface ApiAttendanceRow {
  user_id: string | null
  external_email: string | null
  status: string
  primary_source: string | null
  first_evidence_at: string | null
}

export async function listAttendanceForApi(sessionId: string): Promise<ApiAttendanceRow[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('attendance')
    .select('user_id, external_email, status, primary_source, first_evidence_at')
    .eq('session_id', sessionId)

  if (error) throw toDbError('Failed to list attendance', error)
  return (data as ApiAttendanceRow[] | null) ?? []
}

export interface ApiDepartmentRow {
  id: string
  name: string
  department_code: string
}

export async function listDepartmentsForApi(orgId: string): Promise<ApiDepartmentRow[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('departments')
    .select('id, name, department_code')
    .eq('org_id', orgId)
    .order('name', { ascending: true })

  if (error) throw toDbError('Failed to list departments', error)
  return (data as ApiDepartmentRow[] | null) ?? []
}

export interface ApiSlotRow {
  id: string
  department_id: string
  date_start: string
  date_end: string
  location_type: string
  status: string
}

export async function listOpenSlotsForApi(orgId: string): Promise<ApiSlotRow[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('teaching_slots')
    .select('id, department_id, date_start, date_end, location_type, status')
    .eq('org_id', orgId)
    .eq('status', 'OPEN')
    .gt('date_start', new Date().toISOString())
    .order('date_start', { ascending: true })

  if (error) throw toDbError('Failed to list slots', error)
  return (data as ApiSlotRow[] | null) ?? []
}

/** DRAFT session creation from the API (write:sessions scope). */
export async function insertDraftSessionForApi(input: {
  orgId: string
  departmentId: string
  title: string
  description: string | null
  dateStart: string
  dateEnd: string
  locationType: string
}): Promise<Session> {
  const db = await getServiceDb()

  // The department must belong to the token's org — never trust the payload.
  const { data: dept, error: deptError } = await db
    .from('departments')
    .select('id, created_by')
    .eq('id', input.departmentId)
    .eq('org_id', input.orgId)
    .maybeSingle()
  if (deptError) throw toDbError('Failed to verify department', deptError)
  if (!dept) throw new Error('Department not found in this organization')

  const { data, error } = await db
    .from('sessions')
    .insert({
      org_id: input.orgId,
      department_id: input.departmentId,
      title: input.title,
      description: input.description,
      date_start: input.dateStart,
      date_end: input.dateEnd,
      location_type: input.locationType,
      status: 'DRAFT',
      // sessions.created_by is NOT NULL and references auth.users; API tokens
      // have no user, so attribute to the department creator (an org admin).
      created_by: (dept as { created_by: string }).created_by,
    })
    .select(API_SESSION_COLUMNS)
    .single()

  if (error) throw toDbError('Failed to create session', error)
  return data as Session
}

export async function publishSessionForApi(orgId: string, sessionId: string): Promise<Session> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('sessions')
    .update({ status: 'PUBLISHED' })
    .eq('id', sessionId)
    .eq('org_id', orgId)
    .select(API_SESSION_COLUMNS)
    .single()

  if (error) throw toDbError('Failed to publish session', error)
  return data as Session
}
