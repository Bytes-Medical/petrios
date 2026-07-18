'use server'

import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { headers } from 'next/headers'
import {
  requireAuth,
  requireOrg,
  getCurrentUserId,
  requireDepartmentModerator,
} from '@/lib/auth'
import * as sessionsDb from '@/lib/db/sessions'
import * as attendanceDb from '@/lib/db/attendance'
import * as codeAttemptsDb from '@/lib/db/attendance-code-attempts'
import * as notificationsDb from '@/lib/db/notifications'
import type { EvidenceSource, EvidenceMetadata } from '@/lib/db/attendance'
import { DbNotFoundError } from '@/lib/db'
import { clientIpFromHeaders } from '@/lib/rate-limit'
import {
  GROUP_CODE_WINDOW_MINUTES,
  groupCodeAttemptAllowed,
  hashAttendanceRateLimitIp,
} from '@/lib/attendance-rate-limit'
import {
  generateSecureGroupCode,
  hashGroupCode,
  verifyGroupCode,
} from '@/lib/attendance/group-code'
import {
  computeAttendanceFromEvidence,
  isWithinEvidenceWindow,
} from '@/lib/attendance/compute'

// NOTE: Next 16 forbids non-async exports from 'use server' modules — import
// EvidenceSource/EvidenceMetadata types from '@/lib/db/attendance' directly.

/**
 * Add evidence to the attendance system.
 */
export async function addEvidence(
  sessionId: string,
  source: EvidenceSource,
  payload: {
    userId?: string | null
    externalEmail?: string | null
    metadata?: EvidenceMetadata
    submittedCode?: string
    correctionReason?: string
  }
) {
  const userId = await getCurrentUserId()
  const orgId = await requireOrg()

  const session = await sessionsDb.findSessionById(sessionId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }

  // Validate permissions based on source
  switch (source) {
    case 'SELF_CHECKIN':
      if (!userId || payload.userId !== userId) {
        throw new Error('Unauthorized: can only check in yourself')
      }
      if (
        session.group_code_enabled &&
        session.group_code_version &&
        (!session.group_code_expires_at || new Date(session.group_code_expires_at) >= new Date()) &&
        await attendanceDb.findSessionGroupCodeVerifierAsSystem({ orgId, sessionId })
      ) {
        throw new Error('An active session code is required for check-in')
      }
      break
    case 'GROUP_CODE': {
      if (!userId) {
        throw new Error('Authentication required for group code check-in')
      }
      const ip = clientIpFromHeaders(await headers())
      const ipHash = hashAttendanceRateLimitIp(ip)
      const counts = await codeAttemptsDb.countRecentAttempts({
        sessionId,
        userId,
        ipHash,
        sinceIso: new Date(Date.now() - GROUP_CODE_WINDOW_MINUTES * 60 * 1000).toISOString(),
      })
      if (!groupCodeAttemptAllowed(counts)) {
        throw new Error('Too many group-code attempts. Try again in 10 minutes.')
      }
      const attemptId = await codeAttemptsDb.recordAttempt({ sessionId, userId, ipHash })
      if (!session.group_code_enabled) {
        throw new Error('Group code is not enabled for this session')
      }
      if (session.group_code_version === null || session.group_code_version === 0) {
        throw new Error('No active group code for this session')
      }
      const groupCodeVerifier = await attendanceDb.findSessionGroupCodeVerifierAsSystem({
        orgId,
        sessionId,
      })
      if (!payload.submittedCode || !groupCodeVerifier) {
        throw new Error('A valid group code is required')
      }
      if (payload.metadata?.code_version !== undefined) {
        if (session.group_code_version !== payload.metadata.code_version) {
          throw new Error('Invalid or expired group code version')
        }
      }
      if (
        session.group_code_expires_at &&
        new Date() > new Date(session.group_code_expires_at)
      ) {
        throw new Error('Group code has expired')
      }
      if (!verifyGroupCode(payload.submittedCode, groupCodeVerifier)) {
        throw new Error('Invalid or expired group code')
      }
      await codeAttemptsDb.markAttemptSuccessful(attemptId)
      if (!payload.metadata) {
        payload.metadata = {}
      }
      payload.metadata.code_version = session.group_code_version ?? undefined
      break
    }
    case 'FEEDBACK':
      throw new Error('Feedback is not attendance evidence')
    case 'TEACHER':
      throw new Error('Teacher assignment is not attendance evidence')
    case 'TEAMS':
      await requireDepartmentModerator(session.department_id)
      break
    case 'MODERATOR_CONFIRMATION':
      await requireDepartmentModerator(session.department_id)
      if (!payload.correctionReason?.trim()) {
        throw new Error('A reason is required for a manual attendance decision')
      }
      break
    case 'RECALL':
      throw new Error('Recall completion does not prove physical attendance')
  }

  // Validate time windows
  const now = new Date()
  if (!isWithinEvidenceWindow(source, now, session)) {
    throw new Error(`Time window closed for ${source} evidence`)
  }

  const metadata: EvidenceMetadata = {
    ...payload.metadata,
    actor_user_id: userId || undefined,
  }

  if (
    (session.attendance_policy_version ?? 1) >= 2 ||
    source === 'MODERATOR_CONFIRMATION'
  ) {
    const sourceEventKey =
      source === 'SELF_CHECKIN'
        ? `SELF_CHECKIN:${payload.userId}`
        : source === 'GROUP_CODE'
          ? `GROUP_CODE:${session.group_code_version}:${userId}`
          : source === 'MODERATOR_CONFIRMATION'
            ? `MODERATOR_CONFIRMATION:${randomUUID()}`
            : `${source}:${payload.userId ?? payload.externalEmail}:${now.toISOString()}`

    const result = await attendanceDb.recordAttendanceEvidenceV2({
      orgId,
      sessionId,
      departmentId: session.department_id,
      userId: payload.userId || null,
      externalEmail: payload.externalEmail || null,
      source,
      observedAt: now.toISOString(),
      metadata,
      createdBy: userId || null,
      sourceEventKey,
      correctionReason: payload.correctionReason,
    })

    revalidatePath(`/sessions/${sessionId}`)
    revalidatePath(`/sessions/${sessionId}/manage`)
    return result
  }

  const evidence = await attendanceDb.insertAttendanceEvidence({
    orgId,
    sessionId,
    departmentId: session.department_id,
    userId: payload.userId || null,
    externalEmail: payload.externalEmail || null,
    source,
    observedAt: now.toISOString(),
    metadata,
    createdBy: userId || null,
  })

  // Recompute attendance if not locked
  if (!session.attendance_locked) {
    const targetUserId = payload.userId || null
    const targetEmail = payload.externalEmail || null
    await recomputeAttendance(sessionId, targetUserId, targetEmail)
  }

  revalidatePath(`/sessions/${sessionId}`)
  revalidatePath(`/sessions/${sessionId}/manage`)
  return evidence
}

/**
 * Recompute attendance for a user based on evidence.
 */
export async function recomputeAttendance(
  sessionId: string,
  userId: string | null,
  externalEmail: string | null
) {
  if (!userId && !externalEmail) {
    throw new Error('Either userId or externalEmail required')
  }

  const orgId = await requireOrg()

  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }

  const allEvidence = await attendanceDb.listEvidenceForAttendee({
    orgId,
    sessionId,
    userId,
    externalEmail,
  })

  const computed = computeAttendanceFromEvidence(allEvidence, session)

  return attendanceDb.upsertAttendance({
    orgId,
    sessionId,
    departmentId: session.department_id,
    userId,
    externalEmail,
    status: computed.status,
    primarySource: computed.primarySource,
    firstEvidenceAt: computed.firstEvidenceAt,
  })
}

/**
 * Lock attendance for a session.
 */
export async function lockAttendance(sessionId: string) {
  const userId = await requireAuth()
  const orgId = await requireOrg()

  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }

  await requireDepartmentModerator(session.department_id)

  const revision = await attendanceDb.finalizeSessionAttendanceV2({
    orgId,
    sessionId,
    actorUserId: userId,
  })
  const attendance = await attendanceDb.listAttendance(orgId, sessionId)
  const notificationResults = await Promise.allSettled(
    attendance
      .filter((row): row is typeof row & { user_id: string } => Boolean(row.user_id))
      .map((row) =>
        notificationsDb.insertNotificationAsSystem({
          orgId,
          userId: row.user_id,
          type: 'ATTENDANCE_FINALIZED',
          title: `Attendance finalized — ${session.title}`,
          body: `Your attendance result is ${row.status}. This is revision ${revision}.`,
          link: `/sessions/${sessionId}`,
          dedupeKey: `attendance-finalized:${sessionId}:revision:${revision}`,
        })
      )
  )
  const notificationFailures = notificationResults.filter(
    (result) => result.status === 'rejected'
  ).length

  revalidatePath(`/sessions/${sessionId}`)
  revalidatePath(`/sessions/${sessionId}/manage`)
  return { success: true, revision, notificationFailures }
}

/**
 * Unlock attendance for a session.
 */
export async function unlockAttendance(sessionId: string, reason: string) {
  const userId = await requireAuth()
  const orgId = await requireOrg()

  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }

  await requireDepartmentModerator(session.department_id)

  await attendanceDb.reopenSessionAttendanceV2({
    orgId,
    sessionId,
    actorUserId: userId,
    reason,
  })

  const attendance = await attendanceDb.listAttendance(orgId, sessionId)
  const notificationResults = await Promise.allSettled(
    attendance
      .filter((row): row is typeof row & { user_id: string } => Boolean(row.user_id))
      .map((row) =>
        notificationsDb.insertNotificationAsSystem({
          orgId,
          userId: row.user_id,
          type: 'ATTENDANCE_REOPENED',
          title: `Attendance under review — ${session.title}`,
          body: 'The finalized attendance record was reopened for a documented correction. A new result will be issued after review.',
          link: `/sessions/${sessionId}`,
          dedupeKey: `attendance-reopened:${sessionId}:revision:${session.attendance_revision ?? 0}`,
        })
      )
  )
  const notificationFailures = notificationResults.filter(
    (result) => result.status === 'rejected'
  ).length

  revalidatePath(`/sessions/${sessionId}`)
  revalidatePath(`/sessions/${sessionId}/manage`)
  return { success: true, notificationFailures }
}

/**
 * Generate or regenerate group code for a session.
 */
export async function generateGroupCode(sessionId: string) {
  const actorUserId = await requireAuth()
  const orgId = await requireOrg()

  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }

  await requireDepartmentModerator(session.department_id)

  const expiresAt = new Date(
    new Date(session.date_end).getTime() +
      (session.checkin_close_mins_after ?? 45) * 60 * 1000
  )

  const newVersion = (session.group_code_version || 0) + 1

  const code = generateSecureGroupCode()
  const codeHash = hashGroupCode(code)

  const updated = await attendanceDb.updateSessionGroupCode({
    orgId,
    departmentId: session.department_id,
    sessionId,
    actorUserId,
    version: newVersion,
    expiresAt: expiresAt.toISOString(),
    codeHash,
  })

  revalidatePath(`/sessions/${sessionId}`)
  revalidatePath(`/sessions/${sessionId}/manage`)

  return {
    code,
    version: newVersion,
    expiresAt: updated.group_code_expires_at,
  }
}

/**
 * Get all evidence for a session (moderators only).
 */
export async function getSessionEvidence(sessionId: string) {
  const orgId = await requireOrg()

  const session = await sessionsDb.findSessionScope(sessionId, orgId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }

  await requireDepartmentModerator(session.department_id)

  return attendanceDb.listSessionEvidence(orgId, sessionId)
}

export async function getSessionAttendanceGovernance(sessionId: string) {
  const orgId = await requireOrg()
  const session = await sessionsDb.findSessionScope(sessionId, orgId)
  if (!session) throw new DbNotFoundError('Session not found')
  await requireDepartmentModerator(session.department_id)

  const [participants, evidence, activity] = await Promise.all([
    attendanceDb.listSessionParticipantsAsSystem(sessionId),
    attendanceDb.listSessionEvidence(orgId, sessionId),
    attendanceDb.listSessionActivityAsSystem(sessionId),
  ])
  return { participants, evidence, activity }
}
