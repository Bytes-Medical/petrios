'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireDepartmentModerator, requireOrg } from '@/lib/auth'
import {
  assertSessionCanBePublished,
  assertValidSessionDates,
} from '@/lib/session-validation'
import type { LocationType, Session, SessionStatus } from '@/lib/types'
import * as sessionsDb from '@/lib/db/sessions'
import { DbNotFoundError } from '@/lib/db'

export async function createSession(sessionData: {
  department_id: string
  title: string
  description?: string
  date_start: string
  date_end: string
  location_type: LocationType
  session_type?: string
}) {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  await requireDepartmentModerator(sessionData.department_id)
  assertValidSessionDates(sessionData.date_start, sessionData.date_end)

  const session = await sessionsDb.insertSession({
    orgId,
    departmentId: sessionData.department_id,
    title: sessionData.title,
    description: sessionData.description ?? null,
    dateStart: sessionData.date_start,
    dateEnd: sessionData.date_end,
    locationType: sessionData.location_type,
    sessionType: sessionData.session_type ?? null,
    createdBy: userId,
  })

  revalidatePath('/dashboard')
  revalidatePath(`/departments/${sessionData.department_id}/sessions`)
  return session
}

export async function getSessionsForOrg(orgId: string, departmentId?: string) {
  return sessionsDb.listSessionsByOrg(orgId, { departmentId })
}

export async function getSessions(departmentId?: string) {
  const orgId = await requireOrg()
  return sessionsDb.listSessionsByOrg(orgId, { departmentId })
}

export async function getSession(id: string) {
  const orgId = await requireOrg()
  return sessionsDb.getSessionOrThrow(id, orgId)
}

export async function updateSession(id: string, updates: Partial<Session>) {
  const orgId = await requireOrg()

  const scope = await sessionsDb.findSessionScope(id, orgId)
  if (!scope) {
    throw new DbNotFoundError('Session not found')
  }

  await requireDepartmentModerator(scope.department_id)

  const nextDateStart = updates.date_start ?? scope.date_start
  const nextDateEnd = updates.date_end ?? scope.date_end
  const nextStatus = updates.status ?? scope.status

  assertValidSessionDates(nextDateStart, nextDateEnd)

  if (nextStatus === 'PUBLISHED') {
    assertSessionCanBePublished(nextDateEnd)
  }

  const session = await sessionsDb.updateSessionById(id, orgId, updates)

  revalidatePath(`/sessions/${id}`)
  revalidatePath(`/sessions/${id}/manage`)
  revalidatePath('/dashboard')
  return session
}

export async function updateSessionMeetingUrl(sessionId: string, meetingUrl: string) {
  return updateSession(sessionId, { teams_meeting_url: meetingUrl })
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

  // Assignments start PENDING; TEACHER attendance evidence is recorded when
  // the teacher accepts (app/actions/teaching-assignments.ts), not here —
  // marking a teacher PRESENT at invite time would be wrong once they can
  // decline.
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

  await sessionsDb.deleteSessionById(sessionId, orgId)

  revalidatePath('/dashboard')
  revalidatePath(`/departments/${scope.department_id}/sessions`)
  return { success: true }
}

export async function getCalendarSubscriptionUrl(orgId: string, departmentId?: string) {
  // Compute a simple token to prevent URL enumeration
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  let hash = 0
  const str = orgId + secret
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  const token = Math.abs(hash).toString(16)

  const params = new URLSearchParams({ orgId, token })
  if (departmentId) {
    params.set('departmentId', departmentId)
  }

  return `/api/calendar/ics?${params.toString()}`
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
