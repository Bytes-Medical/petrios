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
  | 'RECALL'
  | 'MODERATOR_CONFIRMATION'

export interface EvidenceMetadata {
  code_version?: number
  feedback_id?: string
  actor_user_id?: string
  status_override?: 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED'
  assigned_as_teacher?: boolean
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
  source_event_key?: string | null
  correction_reason?: string | null
}

export interface SessionParticipant {
  id: string
  org_id: string
  department_id: string
  session_id: string
  user_id: string | null
  external_email: string | null
  display_name: string | null
  participant_role: 'ATTENDEE' | 'TEACHER'
  expectation: 'EXPECTED' | 'OPTIONAL' | 'EXCUSED'
  created_at: string
}

export interface SessionActivityEvent {
  id: number
  event_type: string
  actor_user_id: string | null
  subject_user_id: string | null
  subject_external_email: string | null
  details: Record<string, unknown>
  created_at: string
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

/**
 * Service-role transactional evidence path. The caller must authorize the
 * actor/source before calling; the RPC locks the session, validates the
 * source/window, inserts idempotently, recomputes, and records activity in one
 * database transaction.
 */
export async function recordAttendanceEvidenceV2(input: {
  orgId: string
  sessionId: string
  departmentId: string
  userId: string | null
  externalEmail: string | null
  source: EvidenceSource
  observedAt: string
  metadata: EvidenceMetadata
  createdBy: string | null
  sourceEventKey?: string | null
  correctionReason?: string | null
}): Promise<Attendance> {
  const db = await getServiceDb()
  const { data, error } = await db
    .rpc('record_attendance_evidence_v2', {
      p_org_id: input.orgId,
      p_session_id: input.sessionId,
      p_department_id: input.departmentId,
      p_user_id: input.userId,
      p_external_email: input.externalEmail,
      p_source: input.source,
      p_observed_at: input.observedAt,
      p_metadata: input.metadata,
      p_created_by: input.createdBy,
      p_source_event_key: input.sourceEventKey ?? null,
      p_correction_reason: input.correctionReason ?? null,
    })
    .single()

  if (error) throw toDbError('Failed to record attendance evidence', error)
  return data as Attendance
}

export async function finalizeSessionAttendanceV2(input: {
  orgId: string
  sessionId: string
  actorUserId: string
}): Promise<number> {
  const db = await getServiceDb()
  const { data, error } = await db.rpc('finalize_session_attendance_v2', {
    p_org_id: input.orgId,
    p_session_id: input.sessionId,
    p_actor_user_id: input.actorUserId,
  })
  if (error) throw toDbError('Failed to finalize attendance', error)
  return Number(data)
}

export async function reopenSessionAttendanceV2(input: {
  orgId: string
  sessionId: string
  actorUserId: string
  reason: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.rpc('reopen_session_attendance_v2', {
    p_org_id: input.orgId,
    p_session_id: input.sessionId,
    p_actor_user_id: input.actorUserId,
    p_reason: input.reason,
  })
  if (error) throw toDbError('Failed to reopen attendance', error)
}

export async function listSessionParticipantsAsSystem(
  sessionId: string
): Promise<SessionParticipant[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_participants')
    .select('*')
    .eq('session_id', sessionId)
    .order('display_name', { ascending: true })
  if (error) throw toDbError('Failed to list session participants', error)
  return (data as SessionParticipant[] | null) ?? []
}

export async function listSessionActivityAsSystem(
  sessionId: string,
  limit = 100
): Promise<SessionActivityEvent[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_activity_events')
    .select('id, event_type, actor_user_id, subject_user_id, subject_external_email, details, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw toDbError('Failed to list session activity', error)
  return (data as SessionActivityEvent[] | null) ?? []
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

/** Service-role: recall answer flow resolves attendee vs absentee status. */
export async function findAttendanceForUserAsSystem(
  sessionId: string,
  userId: string
): Promise<{ status: AttendanceStatus } | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('attendance')
    .select('status')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch attendance row', error)
  return (data as { status: AttendanceStatus } | null) ?? null
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

export async function listAttendeeUserIdsBySourceAsSystem(
  sessionId: string,
  source: EvidenceSource
): Promise<string[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('attendance')
    .select('user_id')
    .eq('session_id', sessionId)
    .eq('primary_source', source)
    .not('user_id', 'is', null)
  if (error) throw toDbError('Failed to list attendance by source', error)
  return ((data as { user_id: string | null }[] | null) ?? [])
    .map((row) => row.user_id)
    .filter((userId): userId is string => Boolean(userId))
}

/** Finalization roster snapshot used by post-session catch-up delivery. */
export async function listExpectedAttendeeUserIdsAsSystem(
  sessionId: string
): Promise<string[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_participants')
    .select('user_id')
    .eq('session_id', sessionId)
    .eq('participant_role', 'ATTENDEE')
    .eq('expectation', 'EXPECTED')
    .not('user_id', 'is', null)
  if (error) throw toDbError('Failed to list expected attendee roster', error)
  return ((data as { user_id: string | null }[] | null) ?? [])
    .map((row) => row.user_id)
    .filter((userId): userId is string => Boolean(userId))
}

export async function isExpectedAttendeeAsSystem(
  sessionId: string,
  userId: string
): Promise<boolean> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_participants')
    .select('id')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .eq('participant_role', 'ATTENDEE')
    .eq('expectation', 'EXPECTED')
    .maybeSingle()
  if (error) throw toDbError('Failed to verify expected attendee', error)
  return Boolean(data)
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
  orgId: string
  departmentId: string
  sessionId: string
  actorUserId: string
  version: number
  expiresAt: string
  codeHash: string
}): Promise<{ group_code_expires_at: string | null }> {
  const db = await getServiceDb()
  const { data, error } = await db.rpc('rotate_session_group_code_v2', {
    p_org_id: input.orgId,
    p_department_id: input.departmentId,
    p_session_id: input.sessionId,
    p_actor_user_id: input.actorUserId,
    p_version: input.version,
    p_expires_at: input.expiresAt,
    p_verifier: input.codeHash,
  })

  if (error) throw toDbError('Failed to update group code', error)
  return { group_code_expires_at: (data as string | null) ?? null }
}

export async function findSessionGroupCodeVerifierAsSystem(input: {
  orgId: string
  sessionId: string
}): Promise<string | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_attendance_secrets')
    .select('group_code_verifier')
    .eq('org_id', input.orgId)
    .eq('session_id', input.sessionId)
    .maybeSingle()
  if (error) throw toDbError('Failed to read group-code verifier', error)
  return data?.group_code_verifier ?? null
}
