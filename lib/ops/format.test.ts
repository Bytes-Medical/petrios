import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatDateLong,
  formatDateTimeShort,
  formatDayKeyLong,
  formatSessionDateLabel,
} from './format'

describe('ops formatters', () => {
  afterEach(() => vi.unstubAllEnvs())

  // 23:30 UTC on Fri 9 Oct 2026 is 00:30 on Sat 10 Oct in London (BST).
  const lateEvening = '2026-10-09T23:30:00Z'

  it('formats instants in the app time zone, not the UTC server clock', () => {
    expect(formatDateTimeShort(lateEvening)).toBe('10 Oct, 00:30')
    expect(formatSessionDateLabel(lateEvening)).toBe('Saturday 10 October')
    expect(formatDateLong(lateEvening)).toBe('10 October 2026')
  })

  it('formats a list timestamp in an explicit zone handed down from the server', () => {
    expect(formatDateTimeShort(lateEvening, 'America/New_York')).toBe('9 Oct, 19:30')
  })

  it('keeps a calendar day key on its own day whatever the app zone', () => {
    vi.stubEnv('APP_TIME_ZONE', 'America/New_York')
    expect(formatDayKeyLong('2026-10-05')).toBe('5 October 2026')
  })
})
