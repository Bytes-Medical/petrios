'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireOrg, requireDepartmentModerator } from '@/lib/auth'
import { getEmailClient, getFromAddress } from '@/lib/email'
import { buildInvitationEmailHtml } from '@/lib/email-templates'
import type { Session } from '@/lib/types'
import * as sessionsDb from '@/lib/db/sessions'
import * as teacherInvitationsDb from '@/lib/db/teacher-invitations'
import * as teacherEmailsDb from '@/lib/db/teacher-emails'
import { DbNotFoundError } from '@/lib/db'

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

export async function inviteExternalTeacher(sessionId: string, email: string) {
  const currentUserId = await requireAuth()
  const orgId = await requireOrg()

  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }

  await requireDepartmentModerator(session.department_id)

  const normalizedEmail = email.toLowerCase()
  const existing = await teacherInvitationsDb.findInvitationForEmail({
    sessionId,
    email: normalizedEmail,
  })
  if (existing && existing.status === 'PENDING') {
    throw new Error('An invitation has already been sent to this email')
  }

  const inviteCode = generateInviteCode()

  await teacherInvitationsDb.insertInvitation({
    orgId,
    sessionId,
    email: normalizedEmail,
    inviteCode,
    sentBy: currentUserId,
  })

  const departmentName =
    (await teacherInvitationsDb.findDepartmentName(session.department_id)) || ''

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const rsvpUrl = `${baseUrl}/sessions/${sessionId}/teacher-rsvp/${inviteCode}`

  const mailer = getEmailClient()
  const htmlBody = buildInvitationEmailHtml(session as Session, departmentName, rsvpUrl)
  const fromAddress = getFromAddress()

  const { data: emailResult, error: emailError } = await mailer.emails.send({
    from: fromAddress,
    to: normalizedEmail,
    subject: `You're invited to teach: ${session.title}`,
    html: htmlBody,
  })

  if (emailError) {
    console.error('Failed to send invitation email:', emailError.message)
    revalidatePath(`/sessions/${sessionId}/manage`)
    return { success: true, emailSent: false, emailError: emailError.message }
  }

  try {
    await teacherEmailsDb.insertTeacherEmail({
      orgId,
      sessionId,
      userId: currentUserId,
      emailType: 'INVITATION',
      recipientEmail: normalizedEmail,
      sentBy: currentUserId,
      resendId: emailResult?.id || null,
    })
  } catch (recordError) {
    console.error('Failed to record email send:', recordError)
  }

  revalidatePath(`/sessions/${sessionId}/manage`)
  return { success: true, emailSent: true }
}

export async function getSessionInvitations(sessionId: string) {
  await requireAuth()
  const orgId = await requireOrg()
  return teacherInvitationsDb.listInvitationsForSession(orgId, sessionId)
}

export async function deleteTeacherInvitation(sessionId: string, invitationId: string) {
  await requireAuth()
  const orgId = await requireOrg()

  const scope = await sessionsDb.findSessionScope(sessionId, orgId)
  if (!scope) {
    throw new DbNotFoundError('Session not found')
  }

  await requireDepartmentModerator(scope.department_id)

  await teacherInvitationsDb.deleteInvitation({
    orgId,
    sessionId,
    invitationId,
  })

  revalidatePath(`/sessions/${sessionId}/manage`)
}

export async function respondToInvitation(
  inviteCode: string,
  firstName: string,
  lastName: string,
  accepted: boolean
) {
  const invitation = await teacherInvitationsDb.findInvitationByCode(inviteCode)
  if (!invitation) {
    throw new DbNotFoundError('Invitation not found')
  }

  if (invitation.status !== 'PENDING') {
    throw new Error('This invitation has already been responded to')
  }

  const status = accepted ? 'ACCEPTED' : 'DECLINED'

  await teacherInvitationsDb.updateInvitationResponse({
    invitationId: invitation.id,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    status,
  })

  return { success: true, status }
}
