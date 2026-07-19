'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireOrg, requireDepartmentModerator } from '@/lib/auth'
import { getEmailClient, getFromAddress } from '@/lib/email'
import { buildInvitationEmailHtml } from '@/lib/email-templates'
import type { Session } from '@/lib/types'
import * as sessionsDb from '@/lib/db/sessions'
import * as teacherInvitationsDb from '@/lib/db/teacher-invitations'
import * as slotsDb from '@/lib/db/teaching-slots'
import * as contactsDb from '@/lib/db/external-contacts'
import * as teacherEmailsDb from '@/lib/db/teacher-emails'
import { DbNotFoundError } from '@/lib/db'
import { generateCode } from '@/lib/codes'
import { normalizeContactEmail } from '@/lib/contacts'

export async function inviteExternalTeacher(
  sessionId: string,
  email: string,
  names?: { firstName?: string; lastName?: string }
) {
  const currentUserId = await requireAuth()
  const orgId = await requireOrg()

  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }

  await requireDepartmentModerator(session.department_id)

  const normalizedEmail = normalizeContactEmail(email)
  const existing = await teacherInvitationsDb.findInvitationForEmail({
    sessionId,
    email: normalizedEmail,
  })
  if (existing && existing.status === 'PENDING') {
    throw new Error('An invitation has already been sent to this email')
  }

  const inviteCode = generateCode(8)

  await teacherInvitationsDb.insertInvitation({
    orgId,
    sessionId,
    email: normalizedEmail,
    inviteCode,
    sentBy: currentUserId,
  })

  // Address book auto-capture: fills blanks only (the moderator typed these,
  // the contact's own RSVP later overwrites). Non-fatal.
  try {
    await contactsDb.upsertContactByEmail({
      orgId,
      email: normalizedEmail,
      firstName: names?.firstName,
      lastName: names?.lastName,
      createdBy: currentUserId,
      overwriteNames: false,
    })
  } catch (err) {
    console.error('Failed to capture contact in address book:', err)
  }

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

  // An external who claimed a teaching slot is attached to the session ONLY
  // by their ACCEPTED invitation. Deleting it would silently detach them
  // while the schedule still shows the slot claimed by them and their
  // reminder emails stop. Block with guidance instead of a silent cascade.
  const invitation = await teacherInvitationsDb.findInvitationById({
    orgId,
    sessionId,
    invitationId,
  })
  if (invitation?.status === 'ACCEPTED') {
    const claimedSlot = await slotsDb.findClaimedSlotForSession(sessionId, orgId)
    if (claimedSlot?.claimed_by_contact_id) {
      const contactEmail = await contactsDb.findContactEmail(
        claimedSlot.claimed_by_contact_id,
        orgId
      )
      if (
        contactEmail &&
        normalizeContactEmail(contactEmail) === normalizeContactEmail(invitation.email)
      ) {
        throw new Error(
          'This teacher claimed this teaching slot — cancel or delete the session instead of removing their invitation.'
        )
      }
    }
  }

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

  // Self-reported names are authoritative — overwrite the address book entry.
  try {
    await contactsDb.upsertContactByEmail({
      orgId: invitation.org_id,
      email: invitation.email,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      overwriteNames: true,
    })
  } catch (err) {
    console.error('Failed to update address book from RSVP:', err)
  }

  return { success: true, status }
}
