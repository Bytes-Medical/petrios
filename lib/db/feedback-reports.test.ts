import { describe, expect, it } from 'vitest'
import { canonicalTeacherFeedbackReportJson } from './feedback-reports'

describe('teacher feedback report snapshots', () => {
  it('treats object key order and undefined fields as the same approved content', () => {
    const left = {
      total: 5,
      reviewedSummary: 'Keep the strong interaction.',
      nested: { b: 2, a: 1, omitted: undefined },
    }
    const right = {
      nested: { a: 1, b: 2 },
      reviewedSummary: 'Keep the strong interaction.',
      total: 5,
    }

    expect(canonicalTeacherFeedbackReportJson(left)).toBe(
      canonicalTeacherFeedbackReportJson(right)
    )
  })

  it('treats an edited reviewed narrative as new approved content', () => {
    const original = { total: 5, reviewedSummary: 'Keep the strong interaction.' }
    const edited = { total: 5, reviewedSummary: 'Add a worked example.' }

    expect(canonicalTeacherFeedbackReportJson(original)).not.toBe(
      canonicalTeacherFeedbackReportJson(edited)
    )
  })
})
