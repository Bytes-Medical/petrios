import type { Certificate, CertificateRole } from '@/lib/types'
import { getDb } from './client'
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
  } | null
  organizations: {
    id: string
    name: string
  } | null
}

// -----------------------------------------------------------------------------
// Certificate rows
// -----------------------------------------------------------------------------

export async function insertCertificate(input: {
  orgId: string
  departmentId: string
  sessionId: string
  userId: string | null
  role: CertificateRole
  certificateCode: string
  recipientName?: string
  issuedBy?: string | null
  issuedByName?: string | null
}): Promise<Certificate> {
  const db = await getDb()

  const row: Record<string, unknown> = {
    org_id: input.orgId,
    department_id: input.departmentId,
    session_id: input.sessionId,
    user_id: input.userId,
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

  const { data, error } = await db
    .from('certificates')
    .insert(row)
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
  departments: { id: string; name: string; lead_name?: string | null } | null
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
       departments:department_id (id, name, lead_name),
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
       departments:department_id (id, name, lead_name),
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
  departments: { id: string; name: string; lead_name?: string | null } | null
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
  const db = await getDb()
  const { data, error } = await db
    .from('sessions')
    .select(
      `*,
       departments:department_id (id, name, lead_name),
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

  if (error) throw toDbError('Failed to list session teachers', error)
  return ((data as { user_id: string }[] | null) ?? []).map((r) => r.user_id)
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

export async function findCertificateByUserAndSession(
  userId: string,
  sessionId: string
): Promise<{ certificate_code: string; certificate_role: string; issued_at: string; recipient_name: string | null; issued_by_name: string | null } | null> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()
  const { data, error } = await db
    .from('certificates')
    .select('certificate_code, certificate_role, issued_at, recipient_name, issued_by_name')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .maybeSingle()

  if (error) throw toDbError('Failed to find certificate', error)
  return data
}

export async function findSessionForCertificateById(
  sessionId: string
): Promise<{ title: string; date_start: string; org_name: string | null; department_name: string | null; lead_name: string | null } | null> {
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
