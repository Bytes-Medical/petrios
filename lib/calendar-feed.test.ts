import { describe, expect, it } from 'vitest'
import { calendarFeedPath, calendarFeedToken, verifyCalendarFeedToken } from './calendar-feed'

const SECRET = 'test-secret-value'
const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'

describe('calendar feed token', () => {
  it('is a 128-bit hex HMAC that differs per organisation and per secret', () => {
    const a = calendarFeedToken(ORG_A, SECRET)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(calendarFeedToken(ORG_B, SECRET)).not.toBe(a)
    expect(calendarFeedToken(ORG_A, 'another-secret')).not.toBe(a)
    expect(calendarFeedToken(ORG_A, SECRET)).toBe(a)
  })

  it("does not verify one organisation's token for another", () => {
    const a = calendarFeedToken(ORG_A, SECRET)
    expect(verifyCalendarFeedToken(ORG_A, a, SECRET)).toBe(true)
    expect(verifyCalendarFeedToken(ORG_B, a, SECRET)).toBe(false)
  })

  it('rejects malformed tokens, legacy short hashes and a missing secret', () => {
    const a = calendarFeedToken(ORG_A, SECRET)
    expect(verifyCalendarFeedToken(ORG_A, a.slice(0, 31), SECRET)).toBe(false)
    expect(verifyCalendarFeedToken(ORG_A, a.toUpperCase(), SECRET)).toBe(false)
    expect(verifyCalendarFeedToken(ORG_A, '7fa3c1d2', SECRET)).toBe(false)
    expect(verifyCalendarFeedToken(ORG_A, a, '')).toBe(false)
    expect(() => calendarFeedToken(ORG_A, '')).toThrow()
  })

  it('builds the feed path with the department filter when given', () => {
    const path = new URL(calendarFeedPath(ORG_A, SECRET, 'dept-1'), 'https://x.test')
    expect(path.pathname).toBe('/api/calendar/ics')
    expect(path.searchParams.get('orgId')).toBe(ORG_A)
    expect(path.searchParams.get('departmentId')).toBe('dept-1')
    expect(verifyCalendarFeedToken(ORG_A, path.searchParams.get('token') ?? '', SECRET)).toBe(true)
  })
})
