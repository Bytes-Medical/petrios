import type { Attendance, AttendanceStatus } from '@/lib/types'
import { getDb, getServiceDb } from './client'
import { toDbError } from './errors'

// Evidence sources for attendance_evidence rows. Kept here (not in lib/types)
// so the DAL owns its own storage vocabulary.
export type EvidenceSource =
  | 'SELF_CHECKIN'
  | 'GROUP_CODE'
  | 'FEEDBACK'
  | 'TEACHER'
  | 'TEAMS'

export interface EvidenceMetadata {
  code_version?: number
  feedback_id?: string
  actor_user_id?: string
  status_override?: 'PRESENT' | 'LATE' | 'ABSENT'
  ip_hash?: string
  user_agent?: string
  [key: string]: unknown
}

export interface AttendanceEvidence {
  id: string
  org_id: string
  session_id: string
  department_id: string
  user_id: string | null
  external_email: string | null
  source: EvidenceSource
  observed_at: string
  metadata: EvidenceMetadata | null
  created_by: string | null
}

// -----------------------------------------------------------------------------
// Attendance reads
// -----------------------------------------------------------------------------

export async function listAttendance(
  orgId: string,
  sessionId: string,
  options: { orderBy?: 'created_at' | 'first_evidence_at' } = {}
): Promise<Attendance[]> {
  const db = await getDb()
  const order = options.orderBy ?? 'created_at'
  const ascending = order === 'first_evidence_at'

  const { data, error } = await db
    .from('attendance')
    .select('*')
    .eq('org_id', orgId)
    .eq('session_id', sessionId)
    .order(order, { ascending })

  if (error) throw toDbError('Failed to list attendance', error)
  return (data as Attendance[] | null) ?? []
}

// -----------------------------------------------------------------------------
// Attendance evidence
// -----------------------------------------------------------------------------

export async function insertAttendanceEvidence(input: {
  orgId: string
  sessionId: string
  departmentId: string
  userId: string | null
  externalEmail: string | null
  source: EvidenceSource
  observedAt: string
  metadata: EvidenceMetadata
  createdBy: string | null
}): Promise<AttendanceEvidence> {
  const db = await getDb()
  const { data, error } = await db
    .from('attendance_evidence')
    .insert({
      org_id: input.orgId,
      session_id: input.sessionId,
      department_id: input.departmentId,
      user_id: input.userId,
      external_email: input.externalEmail,
      source: input.source,
      observed_at: input.observedAt,
      metadata: input.metadata,
      created_by: input.createdBy,
    })
    .select()
    .single()

  if (error) throw toDbError('Failed to add attendance evidence', error)
  return data as AttendanceEvidence
}

export async function listEvidenceForAttendee(input: {
  orgId: string
  sessionId: string
  userId?: string | null
  externalEmail?: string | null
}): Promise<AttendanceEvidence[]> {
  const db = await getServiceDb()
  let query = db
    .from('attendance_evidence')
    .select('*')
    .eq('session_id', input.sessionId)
    .eq('org_id', input.orgId)
    .order('observed_at', { ascending: true })

  if (input.userId) {
    query = query.eq('user_id', input.userId)
  } else if (input.externalEmail) {
    query = query.eq('external_email', input.externalEmail)
  }

  const { data, error } = await query
  if (error) throw toDbError('Failed to list attendee evidence', error)
  return (data as AttendanceEvidence[] | null) ?? []
}

export async function listSessionEvidence(
  orgId: string,
  sessionId: string
): Promise<AttendanceEvidence[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('attendance_evidence')
    .select('*')
    .eq('session_id', sessionId)
    .eq('org_id', orgId)
    .order('observed_at', { ascending: false })

  if (error) throw toDbError('Failed to list session evidence', error)
  return (data as AttendanceEvidence[] | null) ?? []
}

// -----------------------------------------------------------------------------
// System (cron) variants — service-role, no user session
// -----------------------------------------------------------------------------

/**
 * Service-role: used by the post-session cron, which runs without a user
 * session (RLS would reject every query). The caller is the CRON_SECRET-
 * authenticated route; it operates on sessions it selected itself.
 */
export async function evidenceExistsAsSystem(input: {
  sessionId: string
  userId: string
  source: EvidenceSource
}): Promise<boolean> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('attendance_evidence')
    .select('id')
    .eq('session_id', input.sessionId)
    .eq('user_id', input.userId)
    .eq('source', input.source)
    .maybeSingle()

  if (error) throw toDbError('Failed to check evidence', error)
  return !!data
}

/** Service-role: see evidenceExistsAsSystem. */
export async function insertAttendanceEvidenceAsSystem(input: {
  orgId: string
  sessionId: string
  departmentId: string
  userId: string
  source: EvidenceSource
  observedAt: string
  metadata: EvidenceMetadata
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('attendance_evidence').insert({
    org_id: input.orgId,
    session_id: input.sessionId,
    department_id: input.departmentId,
    user_id: input.userId,
    source: input.source,
    observed_at: input.observedAt,
    metadata: input.metadata,
  })

  if (error) throw toDbError('Failed to add attendance evidence', error)
}

/** Service-role: see evidenceExistsAsSystem. */
export async function listSessionEvidenceAsSystem(
  sessionId: string
): Promise<AttendanceEvidence[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('attendance_evidence')
    .select('*')
    .eq('session_id', sessionId)
    .order('observed_at', { ascending: true })

  if (error) throw toDbError('Failed to list session evidence', error)
  return (data as AttendanceEvidence[] | null) ?? []
}

/** Service-role: see evidenceExistsAsSystem. */
export async function listAttendeeUserIdsByStatusAsSystem(
  sessionId: string,
  statuses: AttendanceStatus[]
): Promise<string[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('attendance')
    .select('user_id')
    .eq('session_id', sessionId)
    .in('status', statuses)
    .not('user_id', 'is', null)

  if (error) throw toDbError('Failed to list session attendees', error)
  return ((data as { user_id: string | null }[] | null) ?? [])
    .map((r) => r.user_id)
    .filter((id): id is string => !!id)
}

// -----------------------------------------------------------------------------
// Attendance computation (upserts)
// -----------------------------------------------------------------------------

export interface UpsertAttendanceInput {
  orgId: string
  sessionId: string
  departmentId: string
  userId: string | null
  externalEmail: string | null
  status: AttendanceStatus
  primarySource: EvidenceSource | null
  firstEvidenceAt: string | null
}

export async function upsertAttendance(
  input: UpsertAttendanceInput
): Promise<Attendance> {
  const db = await getServiceDb()
  const onConflict = input.userId
    ? 'session_id,user_id'
    : 'session_id,external_email'

  const { data, error } = await db
    .from('attendance')
    .upsert(
      {
        org_id: input.orgId,
        session_id: input.sessionId,
        department_id: input.departmentId,
        user_id: input.userId,
        external_email: input.externalEmail,
        status: input.status,
        primary_source: input.primarySource,
        first_evidence_at: input.firstEvidenceAt,
        computed_at: new Date().toISOString(),
      },
      { onConflict }
    )
    .select()
    .single()

  if (error) throw toDbError('Failed to upsert attendance', error)
  return data as Attendance
}

// -----------------------------------------------------------------------------
// Attendance lock / unlock
// -----------------------------------------------------------------------------

export async function setSessionAttendanceLock(input: {
  sessionId: string
  locked: boolean
  lockedBy: string | null
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('sessions')
    .update({
      attendance_locked: input.locked,
      attendance_locked_at: input.locked ? new Date().toISOString() : null,
      attendance_locked_by: input.locked ? input.lockedBy : null,
    })
    .eq('id', input.sessionId)

  if (error) throw toDbError('Failed to update session attendance lock', error)
}

export async function setAttendanceRowsLock(input: {
  orgId: string
  sessionId: string
  locked: boolean
  lockedBy: string | null
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('attendance')
    .update({
      locked: input.locked,
      locked_at: input.locked ? new Date().toISOString() : null,
      locked_by: input.locked ? input.lockedBy : null,
    })
    .eq('session_id', input.sessionId)
    .eq('org_id', input.orgId)

  if (error) throw toDbError('Failed to update attendance rows lock', error)
}

// -----------------------------------------------------------------------------
// Group code
// -----------------------------------------------------------------------------

export async function updateSessionGroupCode(input: {
  sessionId: string
  version: number
  expiresAt: string
}): Promise<{ group_code_expires_at: string | null }> {
  const db = await getDb()
  const { data, error } = await db
    .from('sessions')
    .update({
      group_code_version: input.version,
      group_code_expires_at: input.expiresAt,
    })
    .eq('id', input.sessionId)
    .select('group_code_expires_at')
    .single()

  if (error) throw toDbError('Failed to update group code', error)
  return data as { group_code_expires_at: string | null }
}

/**
 * Call the Postgres function `generate_group_code`. The function lives in a
 * migration and returns a short human-friendly code derived from the session
 * id + version. Returns null on RPC failure so callers can fall back to
 * client-side generation.
 */
export async function callGenerateGroupCode(
  sessionId: string,
  version: number
): Promise<string | null> {
  const db = await getDb()
  const { data, error } = await db.rpc('generate_group_code', {
    p_session_id: sessionId,
    p_version: version,
  })

  if (error) return null
  return (data as string | null) ?? null
}
