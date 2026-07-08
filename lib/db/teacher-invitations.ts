import type { InvitationStatus, TeacherInvitation } from '@/lib/types'
import { getServiceDb } from './client'
import { toDbError } from './errors'

/**
 * Teacher invitation flow — external people invited by email to teach a
 * session. The table uses an invite_code as a capability token that is
 * shared in emails, so all reads/writes use the service role client.
 * Callers must gate by role for admin operations; the one exception is
 * `findByCode`, which is hit from the public RSVP page.
 */

export async function findInvitationForEmail(input: {
  sessionId: string
  email: string
}): Promise<{ id: string; status: InvitationStatus } | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('teacher_invitations')
    .select('id, status')
    .eq('session_id', input.sessionId)
    .eq('email', input.email)
    .maybeSingle()

  if (error) throw toDbError('Failed to look up invitation', error)
  return (data as { id: string; status: InvitationStatus } | null) ?? null
}

export async function findInvitationByCode(
  inviteCode: string
): Promise<TeacherInvitation | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('teacher_invitations')
    .select('*')
    .eq('invite_code', inviteCode)
    .maybeSingle()

  if (error) throw toDbError('Failed to look up invitation by code', error)
  return (data as TeacherInvitation | null) ?? null
}

export async function findInvitationByCodeAndSession(input: {
  inviteCode: string
  sessionId: string
}): Promise<TeacherInvitation | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('teacher_invitations')
    .select('*')
    .eq('invite_code', input.inviteCode)
    .eq('session_id', input.sessionId)
    .maybeSingle()

  if (error) throw toDbError('Failed to look up invitation', error)
  return (data as TeacherInvitation | null) ?? null
}

export async function insertInvitation(input: {
  orgId: string
  sessionId: string
  email: string
  inviteCode: string
  sentBy: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('teacher_invitations').insert({
    org_id: input.orgId,
    session_id: input.sessionId,
    email: input.email,
    invite_code: input.inviteCode,
    sent_by: input.sentBy,
  })

  if (error) throw toDbError('Failed to create invitation', error)
}

export async function listInvitationsForSession(
  orgId: string,
  sessionId: string
): Promise<TeacherInvitation[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('teacher_invitations')
    .select('*')
    .eq('session_id', sessionId)
    .eq('org_id', orgId)
    .order('sent_at', { ascending: false })

  if (error) throw toDbError('Failed to list session invitations', error)
  return (data as TeacherInvitation[] | null) ?? []
}

export async function deleteInvitation(input: {
  orgId: string
  sessionId: string
  invitationId: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('teacher_invitations')
    .delete()
    .eq('id', input.invitationId)
    .eq('session_id', input.sessionId)
    .eq('org_id', input.orgId)

  if (error) throw toDbError('Failed to delete invitation', error)
}

export async function updateInvitationResponse(input: {
  invitationId: string
  firstName: string
  lastName: string
  status: InvitationStatus
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('teacher_invitations')
    .update({
      first_name: input.firstName,
      last_name: input.lastName,
      status: input.status,
      responded_at: new Date().toISOString(),
    })
    .eq('id', input.invitationId)

  if (error) throw toDbError('Failed to update invitation response', error)
}

/**
 * Fetch just the department name for a department id. Used from the emails
 * and invitations flows which only need the name for email template
 * rendering. Uses the user-scoped client (RLS-safe).
 */
export async function findDepartmentName(
  departmentId: string
): Promise<string | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('departments')
    .select('name')
    .eq('id', departmentId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch department name', error)
  return (data as { name: string } | null)?.name ?? null
}

/**
 * Service-role: used by the session-reminder cron, which runs without a user
 * session. External teachers who accepted their invitation for this session.
 */
export async function listAcceptedInvitationRecipientsAsSystem(
  sessionId: string
): Promise<{ email: string; first_name: string | null; last_name: string | null }[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('teacher_invitations')
    .select('email, first_name, last_name')
    .eq('session_id', sessionId)
    .eq('status', 'ACCEPTED')

  if (error) throw toDbError('Failed to list accepted invitations', error)
  return (
    (data as { email: string; first_name: string | null; last_name: string | null }[] | null) ??
    []
  )
}
