import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appDayKey,
  appTimeZone,
  appWallClockToIso,
  formatAppDate,
  formatAppDateTime,
  formatInAppTimeZone,
} from './datetime'

describe('appTimeZone', () => {
  it('defaults to Europe/London', () => {
    expect(appTimeZone({})).toBe('Europe/London')
  })

  it('uses a valid APP_TIME_ZONE', () => {
    expect(appTimeZone({ APP_TIME_ZONE: 'Europe/Dublin' })).toBe('Europe/Dublin')
  })

  it('falls back to Europe/London for an invalid zone', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(appTimeZone({ APP_TIME_ZONE: 'Mars/Olympus' })).toBe('Europe/London')
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })

  it('validates and logs an invalid zone once, however often dates are formatted', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const format = vi.spyOn(Intl, 'DateTimeFormat')
    for (let i = 0; i < 50; i += 1) {
      expect(appTimeZone({ APP_TIME_ZONE: 'Venus/Maxwell' })).toBe('Europe/London')
    }
    expect(error).toHaveBeenCalledOnce()
    expect(format).toHaveBeenCalledOnce()
    format.mockRestore()
    error.mockRestore()
  })
})

describe('formatInAppTimeZone', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('renders BST wall-clock time regardless of the server clock zone', () => {
    // 15:15 UTC on 9 Oct 2026 is 16:15 in London (BST, UTC+1).
    expect(formatInAppTimeZone('2026-10-09T15:15:00Z', { hour: '2-digit', minute: '2-digit' })).toBe('16:15')
  })

  it('renders GMT in winter', () => {
    expect(formatInAppTimeZone('2026-12-01T09:00:00Z', { hour: '2-digit', minute: '2-digit' })).toBe('09:00')
  })

  it('honours APP_TIME_ZONE', () => {
    vi.stubEnv('APP_TIME_ZONE', 'America/New_York')
    expect(formatInAppTimeZone('2026-10-09T15:15:00Z', { hour: '2-digit', minute: '2-digit' })).toBe('11:15')
  })

  it('uses an explicit timeZone (the server value handed to a client component)', () => {
    vi.stubEnv('APP_TIME_ZONE', 'America/New_York')
    expect(
      formatInAppTimeZone('2026-10-09T15:15:00Z', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
    ).toBe('00:15')
  })
})

describe('appDayKey', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('buckets an instant by its London calendar day', () => {
    // 23:30 UTC on 9 Oct is 00:30 on 10 Oct in BST.
    expect(appDayKey('2026-10-09T23:30:00Z')).toBe('2026-10-10')
    expect(appDayKey('2026-12-09T23:30:00Z')).toBe('2026-12-09')
  })

  it('honours APP_TIME_ZONE', () => {
    vi.stubEnv('APP_TIME_ZONE', 'America/New_York')
    expect(appDayKey('2026-10-10T02:00:00Z')).toBe('2026-10-09')
  })
})

describe('appWallClockToIso', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('reads a summer wall-clock time as BST', () => {
    expect(appWallClockToIso('2026-10-09T16:15')).toBe('2026-10-09T15:15:00.000Z')
  })

  it('reads a winter wall-clock time as GMT', () => {
    expect(appWallClockToIso('2026-12-01T09:00')).toBe('2026-12-01T09:00:00.000Z')
  })

  it('handles both sides of the autumn clock change', () => {
    expect(appWallClockToIso('2026-10-24T16:15')).toBe('2026-10-24T15:15:00.000Z')
    expect(appWallClockToIso('2026-10-26T16:15')).toBe('2026-10-26T16:15:00.000Z')
  })

  it('round-trips through formatInAppTimeZone', () => {
    const iso = appWallClockToIso('2026-03-30T08:00')
    expect(formatInAppTimeZone(iso, { hour: '2-digit', minute: '2-digit' })).toBe('08:00')
  })

  it('honours APP_TIME_ZONE', () => {
    vi.stubEnv('APP_TIME_ZONE', 'America/New_York')
    expect(appWallClockToIso('2026-10-09T11:15')).toBe('2026-10-09T15:15:00.000Z')
  })

  it('rejects malformed input', () => {
    expect(() => appWallClockToIso('2026-10-09 16:15')).toThrow('Invalid local date and time')
  })
})

describe('formatAppDate / formatAppDateTime', () => {
  it('match the en-GB toLocale*String shapes in London time', () => {
    // 23:30 UTC on 9 Oct is 00:30 on 10 Oct in BST.
    expect(formatAppDate('2026-10-09T23:30:00Z')).toBe('10/10/2026')
    expect(formatAppDateTime('2026-10-09T15:15:00Z')).toBe('09/10/2026, 16:15:00')
  })
})
