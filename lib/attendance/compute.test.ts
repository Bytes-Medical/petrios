import { describe, expect, it } from 'vitest'
import {
  computeAttendanceFromEvidence,
  getEvidenceWindows,
  isWithinEvidenceWindow,
  type AttendanceWindowSession,
  type EvidenceForCompute,
} from './compute'

// A one-hour session: 10:00–11:00 UTC. Defaults: check-in opens 09:45,
// closes 10:45; feedback valid until 13:00; late after 10:10.
const session: AttendanceWindowSession = {
  date_start: '2026-07-01T10:00:00.000Z',
  date_end: '2026-07-01T11:00:00.000Z',
}

const at = (iso: string) => new Date(iso)

function evidence(
  source: EvidenceForCompute['source'],
  observedAt: string,
  metadata?: EvidenceForCompute['metadata']
): EvidenceForCompute {
  return { source, observed_at: observedAt, metadata }
}

describe('getEvidenceWindows', () => {
  it('applies the documented defaults', () => {
    const w = getEvidenceWindows(session)
    expect(w.checkInStart.toISOString()).toBe('2026-07-01T09:45:00.000Z')
    expect(w.checkInEnd.toISOString()).toBe('2026-07-01T10:45:00.000Z')
    expect(w.feedbackEnd.toISOString()).toBe('2026-07-01T13:00:00.000Z')
  })

  it('honours per-session overrides', () => {
    const w = getEvidenceWindows({
      ...session,
      checkin_open_mins_before: 30,
      checkin_close_mins_after: 60,
      feedback_valid_mins_after_end: 10,
    })
    expect(w.checkInStart.toISOString()).toBe('2026-07-01T09:30:00.000Z')
    expect(w.checkInEnd.toISOString()).toBe('2026-07-01T11:00:00.000Z')
    expect(w.feedbackEnd.toISOString()).toBe('2026-07-01T11:10:00.000Z')
  })
})

describe('isWithinEvidenceWindow', () => {
  it('accepts self check-in only inside the check-in window', () => {
    expect(isWithinEvidenceWindow('SELF_CHECKIN', at('2026-07-01T09:44:59Z'), session)).toBe(false)
    expect(isWithinEvidenceWindow('SELF_CHECKIN', at('2026-07-01T09:45:00Z'), session)).toBe(true)
    expect(isWithinEvidenceWindow('SELF_CHECKIN', at('2026-07-01T10:45:00Z'), session)).toBe(true)
    expect(isWithinEvidenceWindow('SELF_CHECKIN', at('2026-07-01T10:45:01Z'), session)).toBe(false)
  })

  it('lets feedback arrive until the feedback deadline', () => {
    expect(isWithinEvidenceWindow('FEEDBACK', at('2026-07-01T12:59:00Z'), session)).toBe(true)
    expect(isWithinEvidenceWindow('FEEDBACK', at('2026-07-01T13:00:01Z'), session)).toBe(false)
  })

  it('always accepts teacher and teams evidence', () => {
    expect(isWithinEvidenceWindow('TEACHER', at('2027-01-01T00:00:00Z'), session)).toBe(true)
    expect(isWithinEvidenceWindow('TEAMS', at('2020-01-01T00:00:00Z'), session)).toBe(true)
    expect(isWithinEvidenceWindow('MODERATOR_CONFIRMATION', at('2020-01-01T00:00:00Z'), session)).toBe(true)
  })

  it('accepts recall evidence from session end until 21 days after', () => {
    expect(isWithinEvidenceWindow('RECALL', at('2026-07-01T10:59:59Z'), session)).toBe(false)
    expect(isWithinEvidenceWindow('RECALL', at('2026-07-01T11:00:00Z'), session)).toBe(true)
    expect(isWithinEvidenceWindow('RECALL', at('2026-07-22T11:00:00Z'), session)).toBe(true)
    expect(isWithinEvidenceWindow('RECALL', at('2026-07-22T11:00:01Z'), session)).toBe(false)
  })
})

describe('computeAttendanceFromEvidence', () => {
  it('returns ABSENT when there is no evidence', () => {
    expect(computeAttendanceFromEvidence([], session)).toEqual({
      status: 'ABSENT',
      primarySource: null,
      firstEvidenceAt: null,
    })
  })

  it('returns ABSENT when all evidence is outside its window', () => {
    const result = computeAttendanceFromEvidence(
      [evidence('SELF_CHECKIN', '2026-07-01T12:00:00.000Z')],
      session
    )
    expect(result.status).toBe('ABSENT')
  })

  it('marks PRESENT for on-time evidence', () => {
    const result = computeAttendanceFromEvidence(
      [evidence('SELF_CHECKIN', '2026-07-01T10:05:00.000Z')],
      session
    )
    expect(result).toEqual({
      status: 'PRESENT',
      primarySource: 'SELF_CHECKIN',
      firstEvidenceAt: '2026-07-01T10:05:00.000Z',
    })
  })

  it('marks LATE when first evidence lands after the late threshold', () => {
    const result = computeAttendanceFromEvidence(
      [evidence('SELF_CHECKIN', '2026-07-01T10:20:00.000Z')],
      session
    )
    expect(result.status).toBe('LATE')
  })

  it('prefers the highest-priority source over an earlier lower one', () => {
    const result = computeAttendanceFromEvidence(
      [
        evidence('SELF_CHECKIN', '2026-07-01T09:50:00.000Z'),
        evidence('TEACHER', '2026-07-01T10:30:00.000Z'),
      ],
      session
    )
    expect(result.primarySource).toBe('TEACHER')
    // Timing is judged on the primary source's evidence — teacher marked them
    // at 10:30, which is after the 10:10 late threshold.
    expect(result.status).toBe('LATE')
  })

  it('breaks priority ties by earliest observation', () => {
    const result = computeAttendanceFromEvidence(
      [
        evidence('SELF_CHECKIN', '2026-07-01T10:08:00.000Z'),
        evidence('SELF_CHECKIN', '2026-07-01T09:50:00.000Z'),
      ],
      session
    )
    expect(result.firstEvidenceAt).toBe('2026-07-01T09:50:00.000Z')
    expect(result.status).toBe('PRESENT')
  })

  it('honours a status_override on the primary evidence', () => {
    const result = computeAttendanceFromEvidence(
      [
        evidence('TEACHER', '2026-07-01T10:00:00.000Z', {
          status_override: 'ABSENT',
        }),
      ],
      session
    )
    expect(result.status).toBe('ABSENT')
    expect(result.primarySource).toBe('TEACHER')
  })

  it('ignores invalid evidence when picking the primary source', () => {
    const result = computeAttendanceFromEvidence(
      [
        // Feedback after the deadline: invalid, even though higher priority.
        evidence('FEEDBACK', '2026-07-01T14:00:00.000Z'),
        evidence('GROUP_CODE', '2026-07-01T10:02:00.000Z'),
      ],
      session
    )
    expect(result.primarySource).toBe('GROUP_CODE')
    expect(result.status).toBe('PRESENT')
  })

  it('recall never outranks real presence evidence', () => {
    const result = computeAttendanceFromEvidence(
      [
        evidence('RECALL', '2026-07-03T09:00:00.000Z', { status_override: 'PRESENT' }),
        evidence('SELF_CHECKIN', '2026-07-01T10:02:00.000Z'),
      ],
      session
    )
    expect(result.primarySource).toBe('SELF_CHECKIN')
  })

  it('a catch-up recall pass reads PRESENT via status_override, not LATE', () => {
    const result = computeAttendanceFromEvidence(
      [
        evidence('RECALL', '2026-07-03T09:00:00.000Z', {
          status_override: 'PRESENT',
          method: 'RECALL_CATCH_UP',
        }),
      ],
      session
    )
    expect(result.status).toBe('PRESENT')
    expect(result.primarySource).toBe('RECALL')
  })

  it('recall answered after the 21-day window is invalid (stays ABSENT)', () => {
    const result = computeAttendanceFromEvidence(
      [evidence('RECALL', '2026-08-01T09:00:00.000Z', { status_override: 'PRESENT' })],
      session
    )
    expect(result.status).toBe('ABSENT')
    expect(result.primarySource).toBeNull()
  })

  it('policy v2 preserves previously governed recall evidence after day 21', () => {
    const result = computeAttendanceFromEvidence(
      [evidence('RECALL', '2026-08-01T09:00:00.000Z', { status_override: 'PRESENT' })],
      { ...session, attendance_policy_version: 2 }
    )
    expect(result.status).toBe('PRESENT')
    expect(result.primarySource).toBe('RECALL')
  })

  it('policy v2 ignores feedback but preserves governed recall completion', () => {
    const result = computeAttendanceFromEvidence(
      [
        evidence('FEEDBACK', '2026-07-01T11:30:00.000Z'),
        evidence('RECALL', '2026-07-03T09:00:00.000Z', {
          status_override: 'PRESENT',
        }),
      ],
      { ...session, attendance_policy_version: 2 }
    )
    expect(result.status).toBe('PRESENT')
    expect(result.primarySource).toBe('RECALL')
  })

  it('policy v2 ignores teacher-assignment attribution', () => {
    const result = computeAttendanceFromEvidence(
      [
        evidence('TEACHER', '2026-07-01T10:00:00.000Z', {
          assigned_as_teacher: true,
        }),
      ],
      { ...session, attendance_policy_version: 2 }
    )
    expect(result.status).toBe('ABSENT')
    expect(result.primarySource).toBeNull()
  })

  it('a reasoned moderator decision outranks other evidence and can excuse', () => {
    const result = computeAttendanceFromEvidence(
      [
        evidence('GROUP_CODE', '2026-07-01T10:02:00.000Z'),
        evidence('MODERATOR_CONFIRMATION', '2026-07-02T10:00:00.000Z', {
          status_override: 'EXCUSED',
        }),
      ],
      { ...session, attendance_policy_version: 2 }
    )
    expect(result.status).toBe('EXCUSED')
    expect(result.primarySource).toBe('MODERATOR_CONFIRMATION')
  })
})
