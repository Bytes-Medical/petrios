import { describe, expect, it } from 'vitest'
import {
  computeRetentionAnalytics,
  daysSinceSession,
  RETENTION_MIN_COHORT,
  type RecallAnswerStat,
} from './recall-analytics'

const END = '2026-06-01T13:00:00Z'

function answer(overrides: Partial<RecallAnswerStat> = {}): RecallAnswerStat {
  return {
    kind: 'RETENTION',
    score: 2,
    total: 3,
    passed: true,
    answered_at: '2026-06-03T09:00:00Z',
    ...overrides,
  }
}

function answers(n: number, overrides: Partial<RecallAnswerStat> = {}): RecallAnswerStat[] {
  return Array.from({ length: n }, () => answer(overrides))
}

describe('daysSinceSession', () => {
  it('is 0 at the session end timestamp', () => {
    expect(daysSinceSession(END, END)).toBe(0)
  })

  it('clamps answers before the session end to 0', () => {
    expect(daysSinceSession('2026-05-31T09:00:00Z', END)).toBe(0)
  })

  it('floors partial days', () => {
    expect(daysSinceSession('2026-06-04T12:59:00Z', END)).toBe(2)
    expect(daysSinceSession('2026-06-04T13:00:00Z', END)).toBe(3)
  })
})

describe('computeRetentionAnalytics — suppression', () => {
  it('suppresses score stats below the cohort threshold but keeps counts', () => {
    const result = computeRetentionAnalytics(answers(RETENTION_MIN_COHORT - 1), END, 10)
    expect(result.retention.n).toBe(4)
    expect(result.retention.suppressed).toBe(true)
    expect(result.retention.avgScorePct).toBeNull()
    expect(result.retention.passRatePct).toBeNull()
  })

  it('shows score stats at exactly the threshold', () => {
    const result = computeRetentionAnalytics(answers(RETENTION_MIN_COHORT), END, 10)
    expect(result.retention.suppressed).toBe(false)
    expect(result.retention.avgScorePct).not.toBeNull()
  })

  it('suppresses each kind independently', () => {
    const input = [...answers(5), ...answers(4, { kind: 'CATCH_UP' })]
    const result = computeRetentionAnalytics(input, END, null)
    expect(result.retention.suppressed).toBe(false)
    expect(result.catchUp.suppressed).toBe(true)
    expect(result.catchUp.n).toBe(4)
  })
})

describe('computeRetentionAnalytics — maths', () => {
  it('computes mean percent score to 1dp and whole-percent pass rate', () => {
    const input = [
      ...answers(3, { score: 2, total: 3, passed: true }), // 66.67%
      ...answers(2, { score: 3, total: 3, passed: true }), // 100%
    ]
    const result = computeRetentionAnalytics(input, END, null)
    // (3*66.667 + 2*100) / 5 = 80.0
    expect(result.retention.avgScorePct).toBe(80)
    expect(result.retention.passRatePct).toBe(100)
  })

  it('computes attendee response rate from RETENTION answers only', () => {
    const input = [...answers(3), ...answers(6, { kind: 'CATCH_UP' })]
    const result = computeRetentionAnalytics(input, END, 10)
    expect(result.attendeeResponseRatePct).toBe(30)
  })

  it('returns null response rate when attendee count is unknown or zero', () => {
    expect(computeRetentionAnalytics(answers(3), END, null).attendeeResponseRatePct).toBeNull()
    expect(computeRetentionAnalytics(answers(3), END, 0).attendeeResponseRatePct).toBeNull()
  })
})

describe('computeRetentionAnalytics — buckets', () => {
  it('places answers by whole days since session end', () => {
    const input = [
      ...answers(5, { answered_at: '2026-06-04T13:00:00Z' }), // +3d → 0–3
      ...answers(5, { answered_at: '2026-06-05T14:00:00Z' }), // +4d → 4–7
    ]
    const result = computeRetentionAnalytics(input, END, null)
    expect(result.buckets[0].retention.n).toBe(5)
    expect(result.buckets[1].retention.n).toBe(5)
    expect(result.buckets[2].retention.n).toBe(0)
  })

  it('clamps late answers into the open-ended final bucket', () => {
    const input = answers(5, { answered_at: '2026-07-01T13:00:00Z' }) // +30d
    const result = computeRetentionAnalytics(input, END, null)
    expect(result.buckets[3].retention.n).toBe(5)
    expect(result.buckets[3].maxDay).toBeNull()
  })
})

describe('computeRetentionAnalytics — empty input', () => {
  it('returns zero counts, everything suppressed, without crashing', () => {
    const result = computeRetentionAnalytics([], END, null)
    expect(result.totalResponses).toBe(0)
    expect(result.retention.n).toBe(0)
    expect(result.retention.suppressed).toBe(true)
    expect(result.buckets).toHaveLength(4)
    expect(result.buckets.every((b) => b.retention.suppressed && b.catchUp.suppressed)).toBe(
      true
    )
  })
})
