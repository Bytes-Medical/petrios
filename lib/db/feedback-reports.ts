import { getServiceDb } from './client'
import { toDbError } from './errors'

export interface TeacherFeedbackReport {
  id: string
  version: number
  status: 'APPROVED' | 'RELEASED' | 'FAILED'
  response_count: number
  alreadyReleased: boolean
}

/** Moderator-approved report snapshot; caller has already authorized session scope. */
export async function createApprovedTeacherFeedbackReport(input: {
  orgId: string
  departmentId: string
  sessionId: string
  actorUserId: string
  responseCount: number
  analyticsSnapshot: Record<string, unknown>
  privacySuppressed: boolean
}): Promise<TeacherFeedbackReport> {
  const db = await getServiceDb()
  const { data: latest, error: latestError } = await db
    .from('teacher_feedback_reports')
    .select('id, version, status, response_count')
    .eq('session_id', input.sessionId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestError) throw toDbError('Failed to read feedback report version', latestError)

  if (latest && Number(latest.response_count) === input.responseCount) {
    return {
      id: latest.id,
      version: Number(latest.version),
      status: latest.status as TeacherFeedbackReport['status'],
      response_count: Number(latest.response_count),
      alreadyReleased: latest.status === 'RELEASED',
    }
  }

  const version = Number(latest?.version ?? 0) + 1
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('teacher_feedback_reports')
    .insert({
      org_id: input.orgId,
      department_id: input.departmentId,
      session_id: input.sessionId,
      version,
      status: 'APPROVED',
      response_count: input.responseCount,
      analytics_snapshot: input.analyticsSnapshot,
      privacy_suppressed: input.privacySuppressed,
      created_by: input.actorUserId,
      approved_by: input.actorUserId,
      approved_at: now,
    })
    .select('id, version, status, response_count')
    .single()
  if (error) {
    const { data: raced, error: racedError } = await db
      .from('teacher_feedback_reports')
      .select('id, version, status, response_count')
      .eq('session_id', input.sessionId)
      .eq('version', version)
      .maybeSingle()
    if (racedError || !raced || Number(raced.response_count) !== input.responseCount) {
      throw toDbError('Failed to create approved feedback report', error)
    }
    return {
      id: raced.id,
      version: Number(raced.version),
      status: raced.status as TeacherFeedbackReport['status'],
      response_count: Number(raced.response_count),
      alreadyReleased: raced.status === 'RELEASED',
    }
  }

  const { error: activityError } = await db.from('session_activity_events').insert({
    org_id: input.orgId,
    department_id: input.departmentId,
    session_id: input.sessionId,
    event_type: 'TEACHER_FEEDBACK_REPORT_APPROVED',
    actor_user_id: input.actorUserId,
    details: { report_id: data.id, version, privacy_suppressed: input.privacySuppressed },
  })
  if (activityError) throw toDbError('Failed to record feedback report approval', activityError)
  return {
    ...(data as Omit<TeacherFeedbackReport, 'alreadyReleased'>),
    alreadyReleased: false,
  }
}

export async function finishTeacherFeedbackReport(input: {
  reportId: string
  released: boolean
  resend: boolean
  attemptId: string
  orgId: string
  departmentId: string
  sessionId: string
  actorUserId: string
  sentCount: number
  failedCount: number
}): Promise<void> {
  const db = await getServiceDb()
  const now = new Date().toISOString()

  // A failed resend does not undo the fact that this approved snapshot was
  // released successfully before. First-release attempts still drive the
  // report lifecycle; resends are additional audited delivery attempts.
  if (!input.resend) {
    const { error } = await db
      .from('teacher_feedback_reports')
      .update({
        status: input.released ? 'RELEASED' : 'FAILED',
        released_at: input.released ? now : null,
      })
      .eq('id', input.reportId)
      .eq('session_id', input.sessionId)
    if (error) throw toDbError('Failed to finish teacher feedback report', error)
  }

  const eventType = input.resend
    ? input.released
      ? 'TEACHER_FEEDBACK_REPORT_RESENT'
      : 'TEACHER_FEEDBACK_REPORT_RESEND_FAILED'
    : input.released
      ? 'TEACHER_FEEDBACK_REPORT_RELEASED'
      : 'TEACHER_FEEDBACK_REPORT_FAILED'

  const { error: activityError } = await db.from('session_activity_events').insert({
    org_id: input.orgId,
    department_id: input.departmentId,
    session_id: input.sessionId,
    event_type: eventType,
    actor_user_id: input.actorUserId,
    details: {
      report_id: input.reportId,
      attempt_id: input.attemptId,
      resend: input.resend,
      sent_count: input.sentCount,
      failed_count: input.failedCount,
    },
  })
  if (activityError) throw toDbError('Failed to record feedback report release', activityError)
}
