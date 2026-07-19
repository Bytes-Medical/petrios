import { describe, expect, it } from 'vitest'
import {
  filterAndSortFeedbackAudit,
  writtenFeedbackCount,
  type FeedbackAuditEntry,
} from './feedback-audit'

const entries: FeedbackAuditEntry[] = [
  {
    id: 'new-low',
    attendee_first_name: 'Ada',
    attendee_last_name: 'Low',
    attendee_email: 'ada@example.test',
    rating: 2,
    comment: null,
    answers: [{
      fieldId: 'engagement',
      type: 'rating',
      label: 'Learner engagement',
      value: '2',
      commentLabel: 'Tell us more',
      comment: 'More interaction needed',
    }],
    created_at: '2026-07-19T10:00:00.000Z',
  },
  {
    id: 'old-high',
    attendee_first_name: 'Ben',
    attendee_last_name: 'High',
    attendee_email: 'ben@example.test',
    rating: 5,
    comment: null,
    answers: [{
      fieldId: 'structure',
      type: 'rating',
      label: 'Session structure',
      value: '5',
      commentLabel: 'Tell us more',
      comment: '',
    }],
    created_at: '2026-07-18T10:00:00.000Z',
  },
]

describe('feedback audit explorer', () => {
  it('searches response text and combines score/written filters', () => {
    expect(
      filterAndSortFeedbackAudit(entries, {
        query: 'interaction',
        scoreBand: 'low',
        writtenOnly: true,
        sort: 'newest',
      }).map((entry) => entry.id)
    ).toEqual(['new-low'])
  })

  it('sorts by score without mutating the source list', () => {
    const sorted = filterAndSortFeedbackAudit(entries, {
      query: '',
      scoreBand: 'all',
      writtenOnly: false,
      sort: 'highest',
    })
    expect(sorted.map((entry) => entry.id)).toEqual(['old-high', 'new-low'])
    expect(entries.map((entry) => entry.id)).toEqual(['new-low', 'old-high'])
  })

  it('keeps unscored responses after scored responses in score sorts', () => {
    const unscored = { ...entries[0], id: 'unscored', rating: null }
    const sorted = filterAndSortFeedbackAudit([...entries, unscored], {
      query: '',
      scoreBand: 'all',
      writtenOnly: false,
      sort: 'highest',
    })
    expect(sorted.map((entry) => entry.id)).toEqual(['old-high', 'new-low', 'unscored'])
  })

  it('counts answer comments as written feedback', () => {
    expect(writtenFeedbackCount(entries[0])).toBe(1)
    expect(writtenFeedbackCount(entries[1])).toBe(0)
  })
})
