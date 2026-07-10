import type { EvidenceSource, EvidenceMetadata } from '@/lib/db/attendance'
import type { AttendanceStatus } from '@/lib/types'

/**
 * Pure attendance-computation logic shared by the interactive evidence
 * pipeline (app/actions/attendance-evidence.ts) and backend jobs
 * (app/api/cron/post-session-reports). Keep this module free of I/O so it
 * stays unit-testable; spec/03-attendance.md documents the semantics.
 */

export const EVIDENCE_PRIORITY: Record<EvidenceSource, number> = {
  TEACHER: 5,
  TEAMS: 4,
  FEEDBACK: 3,
  GROUP_CODE: 2,
  SELF_CHECKIN: 1,
  // Catch-up attendance (passed recall questions after missing the session).
  // Lowest priority: it can never outrank evidence of real presence, and
  // primary_source='RECALL' keeps it visibly distinct in audit/portfolio.
  RECALL: 0,
}

export const DEFAULT_CHECKIN_OPEN_MINS_BEFORE = 15
export const DEFAULT_CHECKIN_CLOSE_MINS_AFTER = 45
export const DEFAULT_FEEDBACK_VALID_MINS_AFTER_END = 120
export const DEFAULT_LATE_AFTER_MINS = 10
/** Recall answers count from session end until this many days after. */
export const RECALL_VALID_DAYS_AFTER_END = 21

/** The subset of a sessions row the computation needs. */
export interface AttendanceWindowSession {
  date_start: string
  date_end: string
  checkin_open_mins_before?: number | null
  checkin_close_mins_after?: number | null
  feedback_valid_mins_after_end?: number | null
  late_after_mins?: number | null
}

export interface EvidenceForCompute {
  source: EvidenceSource
  observed_at: string
  metadata?: EvidenceMetadata | null
}

export interface ComputedAttendance {
  status: AttendanceStatus
  primarySource: EvidenceSource | null
  firstEvidenceAt: string | null
}

export function getEvidenceWindows(session: AttendanceWindowSession) {
  const start = new Date(session.date_start).getTime()
  const end = new Date(session.date_end).getTime()
  return {
    checkInStart: new Date(
      start -
        (session.checkin_open_mins_before ?? DEFAULT_CHECKIN_OPEN_MINS_BEFORE) *
          60 *
          1000
    ),
    checkInEnd: new Date(
      start +
        (session.checkin_close_mins_after ?? DEFAULT_CHECKIN_CLOSE_MINS_AFTER) *
          60 *
          1000
    ),
    feedbackEnd: new Date(
      end +
        (session.feedback_valid_mins_after_end ??
          DEFAULT_FEEDBACK_VALID_MINS_AFTER_END) *
          60 *
          1000
    ),
  }
}

/**
 * Whether evidence from `source` observed at `at` falls inside the session's
 * validity window. Used both when accepting new evidence ("now") and when
 * re-filtering historical evidence during recompute ("observed_at").
 */
export function isWithinEvidenceWindow(
  source: EvidenceSource,
  at: Date,
  session: AttendanceWindowSession
): boolean {
  const { checkInStart, checkInEnd, feedbackEnd } = getEvidenceWindows(session)
  switch (source) {
    case 'SELF_CHECKIN':
    case 'GROUP_CODE':
      return at >= checkInStart && at <= checkInEnd
    case 'FEEDBACK':
      return at >= checkInStart && at <= feedbackEnd
    case 'TEACHER':
    case 'TEAMS':
      return true
    case 'RECALL': {
      const end = new Date(session.date_end).getTime()
      return (
        at.getTime() >= end &&
        at.getTime() <= end + RECALL_VALID_DAYS_AFTER_END * 24 * 60 * 60 * 1000
      )
    }
    default:
      return false
  }
}

/**
 * Derive an attendee's attendance from their evidence rows: filter to
 * evidence inside its validity window, take the highest-priority earliest
 * item as the primary source, and mark LATE when the first evidence lands
 * after the late threshold. `metadata.status_override` on the primary
 * evidence wins over the derived status. No valid evidence means ABSENT.
 */
export function computeAttendanceFromEvidence(
  evidence: EvidenceForCompute[],
  session: AttendanceWindowSession
): ComputedAttendance {
  const valid = evidence.filter((ev) =>
    isWithinEvidenceWindow(ev.source, new Date(ev.observed_at), session)
  )

  if (valid.length === 0) {
    return { status: 'ABSENT', primarySource: null, firstEvidenceAt: null }
  }

  const sorted = [...valid].sort((a, b) => {
    const priorityDiff = EVIDENCE_PRIORITY[b.source] - EVIDENCE_PRIORITY[a.source]
    if (priorityDiff !== 0) return priorityDiff
    return new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime()
  })

  const primary = sorted[0]
  const firstEvidenceAt = new Date(primary.observed_at)
  const lateThreshold = new Date(
    new Date(session.date_start).getTime() +
      (session.late_after_mins ?? DEFAULT_LATE_AFTER_MINS) * 60 * 1000
  )

  const derived: AttendanceStatus =
    firstEvidenceAt > lateThreshold ? 'LATE' : 'PRESENT'

  return {
    status: primary.metadata?.status_override ?? derived,
    primarySource: primary.source,
    firstEvidenceAt: firstEvidenceAt.toISOString(),
  }
}
