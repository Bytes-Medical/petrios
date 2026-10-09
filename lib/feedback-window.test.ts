import { describe, expect, it } from 'vitest'
import {
  getFeedbackWindowBounds,
  getFeedbackWindowStatus,
  isFeedbackWindowOpen,
  type FeedbackWindowSession,
} from './feedback-window'

const base: FeedbackWindowSession = {
  date_start: '2026-10-09T10:00:00.000Z',
  date_end: '2026-10-09T11:00:00.000Z',
}

const at = (iso: string) => new Date(iso).getTime()

describe('getFeedbackWindowBounds', () => {
  it('defaults to 15 minutes before start and 120 minutes after end', () => {
    expect(getFeedbackWindowBounds(base)).toEqual({
      opensAt: new Date('2026-10-09T09:45:00.000Z'),
      closesAt: new Date('2026-10-09T13:00:00.000Z'),
    })
  })

  it('treats null and undefined settings as the defaults', () => {
    expect(
      getFeedbackWindowBounds({
        ...base,
        checkin_open_mins_before: null,
        feedback_valid_mins_after_end: null,
      })
    ).toEqual(getFeedbackWindowBounds(base))
  })

  it('keeps a configured zero instead of falling back to the default', () => {
    expect(
      getFeedbackWindowBounds({
        ...base,
        checkin_open_mins_before: 0,
        feedback_valid_mins_after_end: 0,
      })
    ).toEqual({
      opensAt: new Date('2026-10-09T10:00:00.000Z'),
      closesAt: new Date('2026-10-09T11:00:00.000Z'),
    })
  })

  it('honours custom minutes', () => {
    expect(
      getFeedbackWindowBounds({
        ...base,
        checkin_open_mins_before: 30,
        feedback_valid_mins_after_end: 1440,
      })
    ).toEqual({
      opensAt: new Date('2026-10-09T09:30:00.000Z'),
      closesAt: new Date('2026-10-10T11:00:00.000Z'),
    })
  })

  it('returns null for unparseable timestamps', () => {
    expect(getFeedbackWindowBounds({ ...base, date_start: 'not a date' })).toBeNull()
    expect(getFeedbackWindowBounds({ ...base, date_end: '' })).toBeNull()
  })
})

describe('getFeedbackWindowStatus', () => {
  it('is NOT_YET_OPEN one millisecond before opening', () => {
    expect(getFeedbackWindowStatus(base, at('2026-10-09T09:45:00.000Z') - 1)).toBe('NOT_YET_OPEN')
  })

  it('is OPEN at both inclusive endpoints', () => {
    expect(getFeedbackWindowStatus(base, at('2026-10-09T09:45:00.000Z'))).toBe('OPEN')
    expect(getFeedbackWindowStatus(base, at('2026-10-09T13:00:00.000Z'))).toBe('OPEN')
  })

  it('is OPEN during the session', () => {
    expect(getFeedbackWindowStatus(base, new Date('2026-10-09T10:30:00.000Z'))).toBe('OPEN')
  })

  it('is CLOSED one millisecond after closing', () => {
    expect(getFeedbackWindowStatus(base, at('2026-10-09T13:00:00.000Z') + 1)).toBe('CLOSED')
  })

  it('closes exactly at session end when the after-end allowance is zero', () => {
    const session = { ...base, feedback_valid_mins_after_end: 0 }
    expect(getFeedbackWindowStatus(session, at('2026-10-09T11:00:00.000Z'))).toBe('OPEN')
    expect(getFeedbackWindowStatus(session, at('2026-10-09T11:00:00.000Z') + 1)).toBe('CLOSED')
  })

  it('fails closed for unparseable timestamps', () => {
    expect(getFeedbackWindowStatus({ ...base, date_end: 'garbage' }, at('2026-10-09T10:30:00.000Z'))).toBe('CLOSED')
  })
})

describe('isFeedbackWindowOpen', () => {
  it('mirrors the OPEN status', () => {
    expect(isFeedbackWindowOpen(base, at('2026-10-09T10:30:00.000Z'))).toBe(true)
    expect(isFeedbackWindowOpen(base, at('2026-10-09T09:00:00.000Z'))).toBe(false)
    expect(isFeedbackWindowOpen(base, at('2026-10-09T14:00:00.000Z'))).toBe(false)
  })
})
