'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { requireAuth, requireDepartmentModerator, requireOrg, requireOrgScope } from '@/lib/auth'
import {
  assertSessionCanBePublished,
  assertValidSessionDates,
  normalizeSessionMeetingUrl,
} from '@/lib/session-validation'
import {
  computeDateEnd,
  isAllowedNewSessionDuration,
} from '@/lib/session-duration'
import { MAX_SESSION_OCCURRENCES } from '@/lib/session-recurrence'
import { pickEditableSessionUpdates } from '@/lib/session-updates'
import type { LocationType, Session, SessionStatus } from '@/lib/types'
import * as sessionsDb from '@/lib/db/sessions'
import * as slotsDb from '@/lib/db/teaching-slots'
import * as certificatesDb from '@/lib/db/certificates'
import { DbNotFoundError } from '@/lib/db'
import { emitWebhook } from '@/lib/webhooks'

export async function createSession(sessionData: {
  department_id: string
  title: string
  description?: string
  date_starts: string[]
  duration_mins: number
  location_type: LocationType
  teams_meeting_url?: string | null
  session_type?: string
}) {
  const userId = await requireAuth()
  // Sessions are created under the organisation that owns the department
  // (resolved on the server), never a department of another tenant.
  const { orgId } = await requireDepartmentModerator(sessionData.department_id)
  if (!isAllowedNewSessionDuration(sessionData.duration_mins)) {
    throw new Error('Choose a duration between 30 minutes and 4 hours, or Full day')
  }
  if (
    sessionData.date_starts.length === 0 ||
    sessionData.date_starts.length > MAX_SESSION_OCCURRENCES
  ) {
    throw new Error(`Create between 1 and ${MAX_SESSION_OCCURRENCES} sessions at a time`)
  }

  const dateStarts = Array.from(new Set(sessionData.date_starts))
  if (dateStarts.length !== sessionData.date_starts.length) {
    throw new Error('Repeated session dates must be unique')
  }

  const meetingUrl =
    sessionData.location_type === 'MS_TEAMS' ||
    sessionData.location_type === 'HYBRID'
      ? normalizeSessionMeetingUrl(sessionData.teams_meeting_url)
      : null

  const occurrences = dateStarts.map((dateStart) => {
    const dateEnd = computeDateEnd(dateStart, sessionData.duration_mins)
    assertValidSessionDates(dateStart, dateEnd)
    return { dateStart, dateEnd }
  })

  const sessions = await sessionsDb.insertSessions(
    occurrences.map(({ dateStart, dateEnd }) => ({
      orgId,
      departmentId: sessionData.department_id,
      title: sessionData.title,
      description: sessionData.description ?? null,
      dateStart,
      dateEnd,
      locationType: sessionData.location_type,
      teamsMeetingUrl: meetingUrl,
      sessionType: sessionData.session_type ?? null,
      createdBy: userId,
    }))
  )

  revalidatePath('/dashboard')
  revalidatePath(`/departments/${sessionData.department_id}/sessions`)
  revalidatePath(`/departments/${sessionData.department_id}/sessions/past`)
  return { created: sessions.length }
}

export async function getSessionsForOrg(orgId: string, departmentId?: string) {
  await requireOrgScope(orgId)
  return sessionsDb.listSessionsByOrg(orgId, { departmentId })
}

export async function getSessions(
  departmentId?: string,
  options: Omit<sessionsDb.ListSessionsByOrgOptions, 'departmentId'> = {}
) {
  const orgId = await requireOrg()
  return sessionsDb.listSessionsByOrg(orgId, { ...options, departmentId })
}

export async function getSession(id: string) {
  const orgId = await requireOrg()
  return sessionsDb.getSessionOrThrow(id, orgId)
}

export async function updateSession(id: string, updates: Partial<Session>) {
  const orgId = await requireOrg()
  // Only descriptive fields are editable here; ownership (department, org,
  // creator) and attendance/group-code state are rejected (spec/07).
  const editable = pickEditableSessionUpdates(updates)
  const normalizedUpdates =
    editable.teams_meeting_url === undefined
      ? editable
      : {
          ...editable,
          teams_meeting_url: normalizeSessionMeetingUrl(
            editable.teams_meeting_url
          ),
        }

  const scope = await sessionsDb.findSessionScope(id, orgId)
  if (!scope) {
    throw new DbNotFoundError('Session not found')
  }

  await requireDepartmentModerator(scope.department_id)

  const nextDateStart = normalizedUpdates.date_start ?? scope.date_start
  const nextDateEnd = normalizedUpdates.date_end ?? scope.date_end
  const nextStatus = normalizedUpdates.status ?? scope.status

  assertValidSessionDates(nextDateStart, nextDateEnd)

  if (nextStatus === 'PUBLISHED') {
    assertSessionCanBePublished(nextDateEnd)
  }

  const session = await sessionsDb.updateSessionById(
    id,
    orgId,
    normalizedUpdates
  )

  // Integration event on the DRAFT -> PUBLISHED transition, sent after the
  // response so it never slows the action.
  if (nextStatus === 'PUBLISHED' && scope.status !== 'PUBLISHED') {
    after(() =>
      emitWebhook(orgId, 'session.published', {
        session_id: session.id,
        title: session.title,
        department_id: session.department_id,
        date_start: session.date_start,
        date_end: session.date_end,
      })
    )
  }

  revalidatePath(`/sessions/${id}`)
  revalidatePath(`/sessions/${id}/manage`)
  revalidatePath('/dashboard')
  return session
}

export async function updateSessionMeetingUrl(sessionId: string, meetingUrl: string) {
  return updateSession(sessionId, {
    teams_meeting_url: normalizeSessionMeetingUrl(meetingUrl),
  })
}

export async function updateSessionStatus(sessionId: string, status: SessionStatus) {
  return updateSession(sessionId, { status })
}

export async function addSessionTeacher(sessionId: string, userId: string) {
  const orgId = await requireOrg()

  const scope = await sessionsDb.findSessionScope(sessionId, orgId)
  if (!scope) {
    throw new DbNotFoundError('Session not found')
  }

  await requireDepartmentModerator(scope.department_id)

  const isMember = await sessionsDb.isDepartmentMember(scope.department_id, userId)
  if (!isMember) {
    throw new Error('User is not a member of this department')
  }

  // Assignments start PENDING. Accepting later confirms teaching responsibility
  // only; it never creates physical-attendance evidence.
  const teacher = await sessionsDb.insertSessionTeacher({
    orgId,
    sessionId,
    userId,
    invitedBy: await requireAuth(),
  })

  revalidatePath(`/sessions/${sessionId}/manage`)
  revalidatePath(`/sessions/${sessionId}`)
  return teacher
}

export async function removeSessionTeacher(sessionId: string, userId: string) {
  const orgId = await requireOrg()

  const scope = await sessionsDb.findSessionScope(sessionId, orgId)
  if (!scope) {
    throw new DbNotFoundError('Session not found')
  }

  await requireDepartmentModerator(scope.department_id)

  await sessionsDb.deleteSessionTeacher({ orgId, sessionId, userId })

  revalidatePath(`/sessions/${sessionId}/manage`)
  revalidatePath(`/sessions/${sessionId}`)
  return { success: true }
}

export async function deleteSession(sessionId: string) {
  const orgId = await requireOrg()

  const scope = await sessionsDb.findSessionScope(sessionId, orgId)
  if (!scope) {
    throw new DbNotFoundError('Session not found')
  }

  await requireDepartmentModerator(scope.department_id)

  // Issued certificates are durable, publicly verifiable records (the PDF
  // carries a /verify link); certificates.session_id is ON DELETE CASCADE,
  // so deleting the session would silently destroy them and make already-
  // emailed evidence look forged. Cancel the session instead.
  const certificateCount = await certificatesDb.countCertificatesForSession(sessionId, orgId)
  if (certificateCount > 0) {
    throw new Error(
      'This session has issued certificates and cannot be deleted — cancel it instead so the certificates remain verifiable.'
    )
  }

  // A session created from a claimed teaching slot must close that slot,
  // or the slot stays CLAIMED forever (busy-date tag + unique-index block).
  // Must run BEFORE the delete: the FK nulls session_id on delete.
  await slotsDb.closeSlotForSession({ orgId, sessionId })

  await sessionsDb.deleteSessionById(sessionId, orgId)

  revalidatePath('/dashboard')
  revalidatePath(`/departments/${scope.department_id}/sessions`)
  revalidatePath(`/departments/${scope.department_id}/sessions/past`)
  revalidatePath(`/departments/${scope.department_id}/schedule`)
  return { success: true }
}

export async function getSessionTeachers(sessionId: string) {
  const orgId = await requireOrg()
  return sessionsDb.listSessionTeachers(orgId, sessionId)
}

export async function searchOrgMembersForTeacher(query: string) {
  await requireAuth()
  const orgId = await requireOrg()

  if (!query || query.trim().length < 2) return []

  return sessionsDb.searchOrgMemberProfiles(orgId, query.trim())
}
