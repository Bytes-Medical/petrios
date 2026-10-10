import type { EvidenceSource, EvidenceMetadata } from '@/lib/db/attendance'
import type { AttendanceStatus } from '@/lib/types'

/**
 * Pure attendance-computation logic shared by the interactive evidence
 * pipeline (app/actions/attendance-evidence.ts) and backend jobs
 * (app/api/cron/post-session-reports). Keep this module free of I/O so it
 * stays unit-testable; spec/03-attendance.md documents the semantics.
 */

export const EVIDENCE_PRIORITY: Record<EvidenceSource, number> = {
  MODERATOR_CONFIRMATION: 6,
  TEACHER: 5,
  TEAMS: 4,
  FEEDBACK: 3,
  GROUP_CODE: 2,
  SELF_CHECKIN: 1,
  // Governed audio-recap catch-up. It stays below every live-attendance source
  // so recomputation preserves the transparent basis without masking stronger
  // evidence that the learner was physically present.
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
  attendance_policy_version?: number | null
}

export interface EvidenceForCompute {
  source: EvidenceSource
  observed_at: string
  metadata?: EvidenceMetadata | null
  /**
   * Row insertion time and id, used only to break ties between moderator
   * decisions (or catch-up rows) observed at the same instant, exactly like
   * the SQL selector in record_attendance_evidence_v2 (migration 064).
   */
  created_at?: string | null
  id?: string | null
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
    case 'MODERATOR_CONFIRMATION':
      return true
    case 'RECALL': {
      const end = new Date(session.date_end).getTime()
      // Policy-v2 RECALL rows can only be created by the guarded completion
      // RPC, which checks the published question-set deadline. Once accepted,
      // keep that evidence valid during any later governed recomputation.
      if ((session.attendance_policy_version ?? 1) >= 2) {
        return at.getTime() >= end
      }
      return (
        at.getTime() >= end &&
        at.getTime() <= end + RECALL_VALID_DAYS_AFTER_END * 24 * 60 * 60 * 1000
      )
    }
    default:
      return false
  }
}

function timeOf(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

/**
 * Chronological order by observed_at, then created_at, then id: the SQL
 * selector's `observed_at, created_at, id` ordering (uuid order equals the
 * lowercase hex string order). Exported so the rota Expected-roster panel
 * picks the same latest moderator decision as the SQL (lib/rota/suggestions.ts).
 */
export function compareChronological(
  a: Pick<EvidenceForCompute, 'observed_at' | 'created_at' | 'id'>,
  b: Pick<EvidenceForCompute, 'observed_at' | 'created_at' | 'id'>
): number {
  const observed = timeOf(a.observed_at) - timeOf(b.observed_at)
  if (observed !== 0) return observed
  const created = timeOf(a.created_at) - timeOf(b.created_at)
  if (created !== 0 && Number.isFinite(created)) return created
  const idA = a.id ?? ''
  const idB = b.id ?? ''
  return idA < idB ? -1 : idA > idB ? 1 : 0
}

/** Moderator overrides after which a later catch-up (RECALL) row becomes primary. */
const CATCHUP_REPLACEABLE_OVERRIDES = new Set(['ABSENT', 'EXCUSED'])

/**
 * Pick the primary evidence row (spec/03; mirrored by the SQL selector in
 * record_attendance_evidence_v2, migration 064):
 * - When any valid MODERATOR_CONFIRMATION exists, the LATEST one is the
 *   decision (a later moderator decision corrects an earlier one).
 * - If that decision is an ABSENT or EXCUSED override and a valid RECALL row
 *   was observed after it, the earliest such RECALL row is primary: the
 *   learner completed the governed catch-up after the decision. A moderator
 *   decision made after the catch-up still wins. Keyed on status and order
 *   only, never on a reason code.
 * - Otherwise the highest-priority source wins, earliest observation first.
 *   This is also the whole rule before migration 064 (latestDecisionWins
 *   false), matching the pre-064 SQL writer.
 */
function selectPrimaryEvidence(valid: EvidenceForCompute[], latestDecisionWins: boolean): EvidenceForCompute {
  const decisions = valid.filter((ev) => ev.source === 'MODERATOR_CONFIRMATION')
  if (latestDecisionWins && decisions.length > 0) {
    const latest = [...decisions].sort((a, b) => compareChronological(b, a))[0]
    const override = latest.metadata?.status_override
    if (override && CATCHUP_REPLACEABLE_OVERRIDES.has(override)) {
      const decidedAt = timeOf(latest.observed_at)
      const catchUp = valid
        .filter((ev) => ev.source === 'RECALL' && timeOf(ev.observed_at) > decidedAt)
        .sort(compareChronological)[0]
      if (catchUp) return catchUp
    }
    return latest
  }

  return [...valid].sort((a, b) => {
    const priorityDiff = EVIDENCE_PRIORITY[b.source] - EVIDENCE_PRIORITY[a.source]
    if (priorityDiff !== 0) return priorityDiff
    return timeOf(a.observed_at) - timeOf(b.observed_at)
  })[0]
}

/**
 * Derive an attendee's attendance from their evidence rows: filter to
 * evidence inside its validity window, pick the primary row
 * (selectPrimaryEvidence: the latest moderator decision, a catch-up after an
 * ABSENT/EXCUSED decision, else the highest-priority earliest item), and mark
 * LATE when the primary evidence lands after the late threshold.
 * `metadata.status_override` on the primary evidence wins over the derived
 * status. No valid evidence means ABSENT.
 */
export interface ComputeAttendanceOptions {
  /**
   * Migration 064's primary-evidence rule (default true): the latest moderator
   * decision wins and a later catch-up beats an ABSENT/EXCUSED decision.
   * Callers pass false until 064 is applied (its marker is missing), so this
   * TypeScript recomputation never disagrees with the SQL writer, which keeps
   * the earlier earliest-first rule until then.
   */
  latestDecisionWins?: boolean
}

export function computeAttendanceFromEvidence(
  evidence: EvidenceForCompute[],
  session: AttendanceWindowSession,
  options: ComputeAttendanceOptions = {}
): ComputedAttendance {
  const valid = evidence.filter((ev) => {
    if (!isWithinEvidenceWindow(ev.source, new Date(ev.observed_at), session)) {
      return false
    }

    if ((session.attendance_policy_version ?? 1) >= 2) {
      if (ev.source === 'FEEDBACK') return false
      if (ev.source === 'TEACHER' && ev.metadata?.assigned_as_teacher === true) {
        return false
      }
    }
    return true
  })

  if (valid.length === 0) {
    return { status: 'ABSENT', primarySource: null, firstEvidenceAt: null }
  }

  const primary = selectPrimaryEvidence(valid, options.latestDecisionWins ?? true)
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
