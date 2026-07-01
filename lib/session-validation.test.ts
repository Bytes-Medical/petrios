import { describe, expect, it } from 'vitest'
import {
  SESSION_PUBLISH_PAST_END_ERROR,
  assertSessionCanBePublished,
  assertValidSessionDates,
  getSessionDateOrderError,
  getSessionPublishBlockReason,
} from './session-validation'

describe('getSessionDateOrderError', () => {
  it('accepts end after start', () => {
    expect(
      getSessionDateOrderError('2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z')
    ).toBeNull()
  })

  it('rejects end equal to start', () => {
    expect(
      getSessionDateOrderError('2026-07-01T10:00:00Z', '2026-07-01T10:00:00Z')
    ).toMatch(/end time must be after/)
  })

  it('rejects end before start', () => {
    expect(
      getSessionDateOrderError('2026-07-01T11:00:00Z', '2026-07-01T10:00:00Z')
    ).toMatch(/end time must be after/)
  })

  it('throws on unparseable dates', () => {
    expect(() => getSessionDateOrderError('not-a-date', '2026-07-01T10:00:00Z')).toThrow(
      'Session start time is invalid'
    )
    expect(() => getSessionDateOrderError('2026-07-01T10:00:00Z', 'not-a-date')).toThrow(
      'Session end time is invalid'
    )
  })
})

describe('assertValidSessionDates', () => {
  it('throws the order error', () => {
    expect(() =>
      assertValidSessionDates('2026-07-01T11:00:00Z', '2026-07-01T10:00:00Z')
    ).toThrow(/end time must be after/)
  })
})

describe('getSessionPublishBlockReason', () => {
  const now = new Date('2026-07-01T12:00:00Z')

  it('allows publishing a session that has not ended', () => {
    expect(getSessionPublishBlockReason('2026-07-01T13:00:00Z', now)).toBeNull()
  })

  it('blocks publishing a session past its end time', () => {
    expect(getSessionPublishBlockReason('2026-07-01T11:00:00Z', now)).toBe(
      SESSION_PUBLISH_PAST_END_ERROR
    )
  })

  it('blocks publishing exactly at the end time', () => {
    expect(getSessionPublishBlockReason('2026-07-01T12:00:00Z', now)).toBe(
      SESSION_PUBLISH_PAST_END_ERROR
    )
  })
})

describe('assertSessionCanBePublished', () => {
  it('throws when the session has ended', () => {
    expect(() =>
      assertSessionCanBePublished('2026-07-01T11:00:00Z', new Date('2026-07-01T12:00:00Z'))
    ).toThrow(SESSION_PUBLISH_PAST_END_ERROR)
  })
})
