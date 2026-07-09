'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireOrg } from '@/lib/auth'
import { getAppUrl } from '@/lib/app-url'
import { buildTeacherResponseEmailHtml } from '@/lib/email-templates'
import { notifyUser } from '@/lib/notify'
import { profileDisplayName } from '@/lib/contacts'
import * as sessionsDb from '@/lib/db/sessions'
import * as attendanceDb from '@/lib/db/attendance'
import * as onboardingDb from '@/lib/db/onboarding'
import * as traineeDb from '@/lib/db/trainee-dashboard'
import { DbNotFoundError } from '@/lib/db'

export async function getMyTeachingAssignments() {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  return traineeDb.listTeachingAssignmentsForUser(userId, orgId)
}

/**
 * A teacher accepting or declining their own PENDING assignment. On accept,
 * TEACHER attendance evidence is recorded and the inviting moderator is
 * notified by email and in-app notification.
 */
export async function respondToTeachingAssignment(
  sessionId: string,
  accept: boolean
) {
  const userId = await requireAuth()
  const orgId = await requireOrg()

  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }

  const assignment = await sessionsDb.findSessionTeacher(sessionId, userId, orgId)
  if (!assignment) {
    throw new DbNotFoundError('Teaching invitation not found')
  }
  if (assignment.status !== 'PENDING') {
    throw new Error('This invitation has already been responded to')
  }

  const status = accept ? 'ACCEPTED' : 'DECLINED'
  const updated = await sessionsDb.updateSessionTeacherResponse({
    sessionId,
    userId,
    status,
  })
  if (!updated) {
    throw new Error('This invitation has already been responded to')
  }

  if (accept) {
    // Teaching a session counts as attending it; recorded here (not at
    // invite time) so declined teachers are never marked present.
    try {
      await attendanceDb.insertAttendanceEvidence({
        orgId,
        sessionId,
        departmentId: session.department_id,
        userId,
        externalEmail: null,
        source: 'TEACHER',
        observedAt: new Date().toISOString(),
        metadata: { assigned_as_teacher: true },
        createdBy: userId,
      })
    } catch {
      // Non-fatal — evidence may already exist
    }
  }

  // Notify the inviter (fall back to the session creator). Non-fatal.
  const inviterId = assignment.invited_by ?? session.created_by
  if (inviterId && inviterId !== userId) {
    const profile = await onboardingDb.findProfileByUserId(userId).catch(() => null)
    const teacherName = profileDisplayName(profile, 'A teacher')
    const dateStr = new Date(session.date_start).toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    await notifyUser({
      orgId,
      userId: inviterId,
      notification: {
        type: accept ? 'TEACHER_ACCEPTED' : 'TEACHER_DECLINED',
        title: `${teacherName} ${accept ? 'accepted' : 'declined'} a teaching invitation`,
        body: `${session.title} — ${dateStr}`,
        link: `/sessions/${sessionId}/manage`,
      },
      email: {
        subject: `${teacherName} ${accept ? 'accepted' : 'declined'}: ${session.title}`,
        html: buildTeacherResponseEmailHtml({
          teacherName,
          accepted: accept,
          sessionTitle: session.title,
          dateStr,
          manageUrl: `${getAppUrl()}/sessions/${sessionId}/manage`,
        }),
      },
    })
  }

  revalidatePath('/dashboard')
  revalidatePath(`/sessions/${sessionId}/manage`)
  revalidatePath(`/sessions/${sessionId}`)
  return { success: true, status }
}
