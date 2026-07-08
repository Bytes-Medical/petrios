import { describe, expect, it } from 'vitest'
import {
  MAX_SESSION_DURATION_MINS,
  MIN_SESSION_DURATION_MINS,
  computeDateEnd,
  durationFromDates,
  exactDurationFromDates,
  formatDuration,
  listDurationOptions,
} from './session-duration'

describe('listDurationOptions', () => {
  it('runs 30..240 in 30-minute steps', () => {
    expect(listDurationOptions()).toEqual([30, 60, 90, 120, 150, 180, 210, 240])
  })
})

describe('formatDuration', () => {
  it('formats minutes, hours, and mixes', () => {
    expect(formatDuration(30)).toBe('30 minutes')
    expect(formatDuration(60)).toBe('1 hour')
    expect(formatDuration(90)).toBe('1 hour 30 minutes')
    expect(formatDuration(120)).toBe('2 hours')
    expect(formatDuration(240)).toBe('4 hours')
  })
})

describe('computeDateEnd', () => {
  it('adds the duration to the start', () => {
    expect(computeDateEnd('2026-07-01T10:00:00.000Z', 90)).toBe(
      '2026-07-01T11:30:00.000Z'
    )
  })

  it('crosses midnight correctly', () => {
    expect(computeDateEnd('2026-07-01T23:00:00.000Z', 120)).toBe(
      '2026-07-02T01:00:00.000Z'
    )
  })

  it('throws on an invalid start', () => {
    expect(() => computeDateEnd('not-a-date', 60)).toThrow(
      'Session start time is invalid'
    )
  })
})

describe('durationFromDates', () => {
  const start = '2026-07-01T10:00:00.000Z'
  const plus = (mins: number) =>
    new Date(new Date(start).getTime() + mins * 60 * 1000).toISOString()

  it('returns exact on-grid durations', () => {
    expect(durationFromDates(start, plus(60))).toBe(60)
    expect(durationFromDates(start, plus(240))).toBe(240)
  })

  it('snaps off-grid durations to the nearest step (ties round up)', () => {
    expect(durationFromDates(start, plus(100))).toBe(90)
    expect(durationFromDates(start, plus(105))).toBe(120)
    expect(durationFromDates(start, plus(110))).toBe(120)
  })

  it('clamps below the minimum and above the maximum', () => {
    expect(durationFromDates(start, plus(10))).toBe(MIN_SESSION_DURATION_MINS)
    expect(durationFromDates(start, plus(600))).toBe(MAX_SESSION_DURATION_MINS)
  })
})

describe('exactDurationFromDates', () => {
  it('returns the unsnapped duration', () => {
    const start = '2026-07-01T10:00:00.000Z'
    expect(exactDurationFromDates(start, '2026-07-01T11:40:00.000Z')).toBe(100)
  })

  it('never returns negative', () => {
    expect(
      exactDurationFromDates('2026-07-01T10:00:00.000Z', '2026-07-01T09:00:00.000Z')
    ).toBe(0)
  })
})
