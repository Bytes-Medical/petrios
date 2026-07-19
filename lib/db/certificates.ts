import type {
  Certificate,
  CertificateRecognitionBasis,
  CertificateRole,
} from '@/lib/types'
import { getDb, getServiceDb } from './client'
import { toDbError } from './errors'

// Shapes for reads that embed session / department joins. Kept local so the
// DAL owns the contract rather than leaking Supabase's join syntax upward.
export interface CertificateWithSession extends Certificate {
  sessions: {
    id: string
    title: string
    date_start: string
    description?: string | null
  } | null
  departments: {
    id: string
    name: string
    lead_name?: string | null
    certificate_coordinator_names?: string[] | null
  } | null
  organizations: {
    id: string
    name: string
  } | null
}

// -----------------------------------------------------------------------------
// Certificate rows
// -----------------------------------------------------------------------------

/**
 * Count of issued certificates for a session — the delete-session guard.
 * Service role justification: the caller is a moderator deciding whether a
 * session is deletable; RLS scopes certificate reads to their owners, so an
 * RLS count would undercount and let the guard pass wrongly.
 */
export async function countCertificatesForSession(
  sessionId: string,
  orgId: string
): Promise<number> {
  const db = await getServiceDb()
  const { count, error } = await db
    .from('certificates')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('org_id', orgId)

  if (error) throw toDbError('Failed to count session certificates', error)
  return count ?? 0
}

export async function insertCertificate(input: {
  orgId: string
  departmentId: string
  sessionId: string
  userId: string | null
  invitationId?: string | null
  role: CertificateRole
  certificateCode: string
  recipientName?: string
  issuedBy?: string | null
  issuedByName?: string | null
  recipientEmail?: string | null
  coordinatorNames?: string[]
  attendanceRevision?: number | null
  issuanceSource?: string
  recognitionBasis?: CertificateRecognitionBasis
}): Promise<Certificate> {
  const db = await getDb()

  const row: Record<string, unknown> = {
    org_id: input.orgId,
    department_id: input.departmentId,
    session_id: input.sessionId,
    user_id: input.userId,
    invitation_id: input.invitationId ?? null,
    certificate_role: input.role,
    certificate_code: input.certificateCode,
  }
  if (input.recipientName !== undefined) {
    row.recipient_name = input.recipientName
  }
  if (input.issuedBy !== undefined) {
    row.issued_by = input.issuedBy
  }
  if (input.issuedByName !== undefined) {
    row.issued_by_name = input.issuedByName
  }
  if (input.recipientEmail !== undefined) row.recipient_email = input.recipientEmail
  if (input.coordinatorNames !== undefined) row.coordinator_names = input.coordinatorNames
  if (input.attendanceRevision !== undefined) row.attendance_revision = input.attendanceRevision
  if (input.issuanceSource !== undefined) row.issuance_source = input.issuanceSource
  row.recognition_basis = input.recognitionBasis ?? (
    input.role === 'TEACHER' ? 'TEACHING_ASSIGNMENT' : 'LIVE_ATTENDANCE'
  )
  row.status = 'VALID'

  const { data, error } = await db
    .from('certificates')
    .insert(row)
    .select()
    .single()

  if (error) throw toDbError('Failed to create certificate', error)
  return data as Certificate
}

/**
 * Service-role: used by the post-session cron and the explicitly authorized
 * moderator batch. The database eligibility trigger remains authoritative.
 */
export async function insertCertificateAsSystem(input: {
  orgId: string
  departmentId: string
  sessionId: string
  userId: string | null
  invitationId?: string | null
  role: CertificateRole
  certificateCode: string
  recipientName: string
  recipientEmail?: string | null
  issuedBy?: string | null
  issuedByName?: string | null
  coordinatorNames?: string[]
  attendanceRevision?: number | null
  issuanceSource?: string
  recognitionBasis?: CertificateRecognitionBasis
}): Promise<Certificate> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()

  const { data, error } = await db
    .from('certificates')
    .insert({
      org_id: input.orgId,
      department_id: input.departmentId,
      session_id: input.sessionId,
      user_id: input.userId,
      invitation_id: input.invitationId ?? null,
      certificate_role: input.role,
      certificate_code: input.certificateCode,
      recipient_name: input.recipientName,
      recipient_email: input.recipientEmail ?? null,
      issued_by: input.issuedBy ?? null,
      issued_by_name: input.issuedByName ?? null,
      coordinator_names: input.coordinatorNames ?? [],
      attendance_revision: input.attendanceRevision ?? null,
      issuance_source: input.issuanceSource ?? 'POST_SESSION_REPORT',
      recognition_basis: input.recognitionBasis ?? (
        input.role === 'TEACHER' ? 'TEACHING_ASSIGNMENT' : 'LIVE_ATTENDANCE'
      ),
      status: 'VALID',
    })
    .select()
    .single()

  if (error) throw toDbError('Failed to create certificate', error)
  return data as Certificate
}

export async function listMyCertificates(
  orgId: string,
  userId: string
): Promise<CertificateWithSession[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('certificates')
    .select(
      `*,
       sessions:session_id (id, title, date_start),
       departments:department_id (id, name)`
    )
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .order('issued_at', { ascending: false })

  if (error) throw toDbError('Failed to list certificates', error)
  return (data as CertificateWithSession[] | null) ?? []
}

export interface CertificateForDownload extends Certificate {
  sessions: { id: string; title: string; date_start: string } | null
  departments: {
    id: string
    name: string
    lead_name?: string | null
    certificate_coordinator_names?: string[] | null
  } | null
  organizations: { id: string; name: string } | null
}

/**
 * Full certificate row with org/department/session joins, scoped to the
 * caller's org. Used by the certificate download route to render the PDF.
 */
export async function findCertificateForDownload(
  id: string,
  orgId: string
): Promise<CertificateForDownload | null> {
  const db = await getDb()
  const { data, error } = await db
    .from('certificates')
    .select(
      `*,
       sessions:session_id (id, title, date_start),
       departments:department_id (id, name, lead_name, certificate_coordinator_names),
       organizations:org_id (id, name)`
    )
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch certificate for download', error)
  return (data as CertificateForDownload | null) ?? null
}

export async function findCertificateByCode(
  code: string
): Promise<CertificateWithSession | null> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()
  const { data, error } = await db
    .from('certificates')
    .select(
      `*,
       sessions:session_id (id, title, date_start, description),
       departments:department_id (id, name, lead_name, certificate_coordinator_names),
       organizations:org_id (id, name)`
    )
    .eq('certificate_code', code)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch certificate', error)
  if (!data) return null

  // Flatten array embeds from Supabase
  const row = data as Record<string, unknown>
  const flatten = <T,>(v: T | T[] | null): T | null =>
    !v ? null : Array.isArray(v) ? v[0] ?? null : v

  return {
    ...data,
    sessions: flatten(row.sessions as CertificateWithSession['sessions']),
    departments: flatten(row.departments as CertificateWithSession['departments']),
    organizations: flatten(row.organizations as CertificateWithSession['organizations']),
  } as CertificateWithSession
}

// -----------------------------------------------------------------------------
// Helpers for certificate-generation flows
// -----------------------------------------------------------------------------

export interface SessionWithCertificateContext {
  id: string
  org_id: string
  department_id: string
  title: string
  date_start: string
  date_end: string
  status: string
  require_feedback_for_certificate?: boolean
  attendance_phase?: 'OPEN' | 'REVIEW' | 'FINALIZED'
  attendance_revision?: number
  departments: {
    id: string
    name: string
    lead_name?: string | null
    certificate_coordinator_names?: string[] | null
  } | null
  organizations: { id: string; name: string } | null
}

/**
 * Fetch a session with the department + org names needed to render a
 * certificate. Read-only; the caller is responsible for authorization.
 */
export async function findSessionForCertificate(
  sessionId: string,
  orgId: string
): Promise<SessionWithCertificateContext | null> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()
  const { data, error } = await db
    .from('sessions')
    .select(
      `*,
       departments:department_id (id, name, lead_name, certificate_coordinator_names),
       organizations:org_id (id, name)`
    )
    .eq('id', sessionId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch session for certificate', error)
  return (data as SessionWithCertificateContext | null) ?? null
}

export async function listSessionTeacherIds(sessionId: string): Promise<string[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('session_teachers')
    .select('user_id')
    .eq('session_id', sessionId)
    .eq('status', 'ACCEPTED')

  if (error) throw toDbError('Failed to list session teachers', error)
  return ((data as { user_id: string }[] | null) ?? []).map((r) => r.user_id)
}

export async function listAcceptedRegisteredTeacherIdsAsSystem(
  sessionId: string
): Promise<string[]> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_teachers')
    .select('user_id')
    .eq('session_id', sessionId)
    .eq('status', 'ACCEPTED')

  if (error) throw toDbError('Failed to list accepted registered teachers', error)
  return ((data as { user_id: string }[] | null) ?? []).map((row) => row.user_id)
}

export interface ExternalTeacherCertificateCandidate {
  invitationId: string
  email: string
  recipientName: string
}

export async function listAcceptedExternalTeachersAsSystem(
  sessionId: string
): Promise<ExternalTeacherCertificateCandidate[]> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()
  const { data, error } = await db
    .from('teacher_invitations')
    .select('id, email, first_name, last_name')
    .eq('session_id', sessionId)
    .eq('status', 'ACCEPTED')

  if (error) throw toDbError('Failed to list accepted external teachers', error)
  const candidates = ((data as {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }[] | null) ?? []).map((invitation) => {
    const email = invitation.email.trim().toLowerCase()
    return {
      invitationId: invitation.id,
      email,
      recipientName:
        [invitation.first_name, invitation.last_name].filter(Boolean).join(' ').trim() || email,
    }
  })
  return [...new Map(candidates.map((candidate) => [candidate.email, candidate])).values()]
}

export async function listSessionAttendeeUserIds(
  sessionId: string,
  statuses: ('PRESENT' | 'LATE')[] = ['PRESENT', 'LATE']
): Promise<string[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('attendance')
    .select('user_id')
    .eq('session_id', sessionId)
    .in('status', statuses)

  if (error) throw toDbError('Failed to list session attendees', error)
  return ((data as { user_id: string | null }[] | null) ?? [])
    .map((r) => r.user_id)
    .filter((id): id is string => !!id)
}

export async function hasUserSubmittedFeedback(
  sessionId: string,
  userId: string
): Promise<boolean> {
  const db = await getDb()
  const { data, error } = await db
    .from('session_feedback')
    .select('id')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw toDbError('Failed to check feedback', error)
  return !!data
}

export interface CertificateLookup {
  id: string
  certificate_code: string
  certificate_role: string
  issued_at: string
  recipient_name: string | null
  recipient_email: string | null
  issued_by_name: string | null
  coordinator_names: string[]
  status: 'VALID' | 'REVOKED' | 'LEGACY'
  attendance_revision: number | null
  recognition_basis: CertificateRecognitionBasis
}

export async function findCertificateByUserAndSession(
  userId: string,
  sessionId: string,
  options: { role?: CertificateRole; includeLegacy?: boolean } = {}
): Promise<CertificateLookup | null> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()
  let query = db
    .from('certificates')
    .select('id, certificate_code, certificate_role, issued_at, recipient_name, recipient_email, issued_by_name, coordinator_names, status, attendance_revision, recognition_basis')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .in('status', options.includeLegacy === false ? ['VALID'] : ['VALID', 'LEGACY'])
    .order('issued_at', { ascending: false })
    .limit(1)
  if (options.role) query = query.eq('certificate_role', options.role)
  const { data, error } = await query.maybeSingle()

  if (error) throw toDbError('Failed to find certificate', error)
  return data as CertificateLookup | null
}

export async function findCertificateByExternalEmailAndSession(
  externalEmail: string,
  sessionId: string,
  options: { role?: CertificateRole; includeLegacy?: boolean } = {}
): Promise<CertificateLookup | null> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()
  let query = db
    .from('certificates')
    .select('id, certificate_code, certificate_role, issued_at, recipient_name, recipient_email, issued_by_name, coordinator_names, status, attendance_revision, recognition_basis')
    .eq('session_id', sessionId)
    .is('user_id', null)
    .eq('recipient_email', externalEmail.trim().toLowerCase())
    .in('status', options.includeLegacy === false ? ['VALID'] : ['VALID', 'LEGACY'])
    .order('issued_at', { ascending: false })
    .limit(1)
  if (options.role) query = query.eq('certificate_role', options.role)
  const { data, error } = await query.maybeSingle()

  if (error) throw toDbError('Failed to find external teacher certificate', error)
  return data as CertificateLookup | null
}

export async function findFinalizedAttendanceForUserAsSystem(
  sessionId: string,
  userId: string
): Promise<{
  status: 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED'
  revision: number
  primary_source: string | null
} | null> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()
  const { data, error } = await db
    .from('attendance')
    .select('status, revision, primary_source')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .not('finalized_at', 'is', null)
    .maybeSingle()
  if (error) throw toDbError('Failed to read finalized attendance', error)
  return data as {
    status: 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED'
    revision: number
    primary_source: string | null
  } | null
}

export async function userIsAcceptedTeacherAsSystem(
  sessionId: string,
  userId: string
): Promise<boolean> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_teachers')
    .select('id')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .eq('status', 'ACCEPTED')
    .maybeSingle()
  if (error) throw toDbError('Failed to verify accepted teacher', error)
  return !!data
}

export async function externalInvitationIsAcceptedAsSystem(input: {
  sessionId: string
  invitationId: string
  externalEmail: string
}): Promise<boolean> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()
  const { data, error } = await db
    .from('teacher_invitations')
    .select('id, email')
    .eq('id', input.invitationId)
    .eq('session_id', input.sessionId)
    .eq('status', 'ACCEPTED')
    .maybeSingle()
  if (error) throw toDbError('Failed to verify accepted external teacher', error)
  return !!data && data.email.trim().toLowerCase() === input.externalEmail.trim().toLowerCase()
}

export async function revokeCertificateAsSystem(input: {
  certificateId: string
  actorUserId: string
  reason: string
}): Promise<void> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()
  const { error } = await db
    .from('certificates')
    .update({
      status: 'REVOKED',
      revoked_at: new Date().toISOString(),
      revoked_by: input.actorUserId,
      revocation_reason: input.reason,
    })
    .eq('id', input.certificateId)
    .eq('status', 'VALID')
  if (error) throw toDbError('Failed to revoke certificate', error)
}

export async function findSessionForCertificateById(
  sessionId: string
): Promise<{
  title: string
  date_start: string
  org_name: string | null
  department_name: string | null
  lead_name: string | null
} | null> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()
  const { data, error } = await db
    .from('sessions')
    .select('title, date_start, organizations:org_id(name), departments:department_id(name, lead_name)')
    .eq('id', sessionId)
    .maybeSingle()

  if (error) throw toDbError('Failed to find session for certificate', error)
  if (!data) return null

  const org = Array.isArray(data.organizations) ? data.organizations[0] : data.organizations
  const dept = Array.isArray(data.departments) ? data.departments[0] : data.departments

  return {
    title: data.title,
    date_start: data.date_start,
    org_name: org?.name ?? null,
    department_name: dept?.name ?? null,
    lead_name: (dept as Record<string, unknown>)?.lead_name as string | null ?? null,
  }
}

/**
 * Service-role read for the CRON_SECRET-authenticated certificate worker. The
 * returned department names are snapshotted onto newly issued certificates.
 */
export async function findCertificateCoordinatorNamesAsSystem(
  departmentId: string
): Promise<{ coordinator_names: string[]; lead_name: string | null }> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()
  const { data, error } = await db
    .from('departments')
    .select('certificate_coordinator_names, lead_name')
    .eq('id', departmentId)
    .maybeSingle()

  if (error) throw toDbError('Failed to load certificate coordinator settings', error)
  return {
    coordinator_names:
      (data as { certificate_coordinator_names?: string[] } | null)
        ?.certificate_coordinator_names ?? [],
    lead_name: (data as { lead_name?: string | null } | null)?.lead_name ?? null,
  }
}
