import { describe, expect, it } from 'vitest'
import { decideMeetingAccess, isInviteCode, isSessionId, MEETING_MESSAGES, meetingDenial } from './access'
import type { MeetingDenialReason } from './types'

const session = {
  status: 'PUBLISHED',
  location_type: 'JITSI',
  date_start: '2026-10-09T12:00:00.000Z',
  date_end: '2026-10-09T13:00:00.000Z',
}
const DURING = new Date('2026-10-09T12:15:00.000Z')

function denial(input: Parameters<typeof decideMeetingAccess>[0]) {
  const decision = decideMeetingAccess(input)
  if (decision.ok) throw new Error('expected a denial')
  return decision
}

describe('decideMeetingAccess', () => {
  it('denies a missing (or RLS-hidden) session as not_found', () => {
    expect(denial({ session: null, now: DURING, moderator: true })).toMatchObject({ reason: 'not_found', retryable: false })
  })

  it.each(['IN_PERSON', 'MS_TEAMS', 'HYBRID'])('denies %s sessions as not_video', (location_type) => {
    expect(denial({ session: { ...session, location_type }, now: DURING, moderator: true }).reason).toBe('not_video')
  })

  it('denies DRAFT sessions as not_published, even to moderators', () => {
    expect(denial({ session: { ...session, status: 'DRAFT' }, now: DURING, moderator: true }).reason).toBe('not_published')
  })

  it('denies CANCELLED sessions as cancelled', () => {
    expect(denial({ session: { ...session, status: 'CANCELLED' }, now: DURING, moderator: true }).reason).toBe('cancelled')
  })

  it('checks the location before the status (a cancelled Teams session is not_video)', () => {
    expect(
      denial({ session: { ...session, status: 'CANCELLED', location_type: 'MS_TEAMS' }, now: DURING, moderator: false }).reason
    ).toBe('not_video')
  })

  it('denies before the window as too_early with the open time, retryable', () => {
    const result = denial({ session, now: new Date('2026-10-09T11:29:59.999Z'), moderator: true })
    expect(result).toEqual({
      ok: false,
      reason: 'too_early',
      message: MEETING_MESSAGES.too_early,
      retryable: true,
      opensAt: '2026-10-09T11:30:00.000Z',
    })
  })

  it('denies after the window as ended, not retryable', () => {
    const result = denial({ session, now: new Date('2026-10-09T13:30:00.001Z'), moderator: true })
    expect(result).toMatchObject({ reason: 'ended', retryable: false })
    expect(result.opensAt).toBeUndefined()
  })

  it.each([true, false])('admits inside the window, keeping moderator=%s and the close time', (moderator) => {
    for (const now of [new Date('2026-10-09T11:30:00.000Z'), DURING, new Date('2026-10-09T13:30:00.000Z')]) {
      expect(decideMeetingAccess({ session, now, moderator })).toEqual({
        ok: true,
        moderator,
        closesAt: new Date('2026-10-09T13:30:00.000Z'),
      })
    }
  })
})

describe('meetingDenial', () => {
  it('uses the user-facing message for each reason; only too_early and unavailable are retryable', () => {
    const reasons = Object.keys(MEETING_MESSAGES) as MeetingDenialReason[]
    expect(reasons).toHaveLength(11)
    for (const reason of reasons) {
      const result = meetingDenial(reason)
      expect(result.message).toBe(MEETING_MESSAGES[reason])
      expect(result.retryable).toBe(reason === 'too_early' || reason === 'unavailable')
      expect(result.message).not.toMatch(/JAAS|JITSI_|secret|key/i)
    }
  })
})

describe('input validation', () => {
  it('accepts UUID session ids only', () => {
    expect(isSessionId('3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b')).toBe(true)
    expect(isSessionId('3F2A1B4C-5D6E-4F70-8A9B-0C1D2E3F4A5B')).toBe(true)
    expect(isSessionId('3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5')).toBe(false)
    expect(isSessionId('3f2a1b4c-5d6e-0f70-8a9b-0c1d2e3f4a5b')).toBe(false)
    expect(isSessionId("3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b' or 1=1")).toBe(false)
    expect(isSessionId('')).toBe(false)
  })

  it('accepts alphanumeric invite codes of 4–64 characters', () => {
    expect(isInviteCode('AB7KQ9ZX')).toBe(true)
    expect(isInviteCode('abc')).toBe(false)
    expect(isInviteCode('A'.repeat(65))).toBe(false)
    expect(isInviteCode('AB7K-Q9ZX')).toBe(false)
    expect(isInviteCode('AB7KQ9ZX%')).toBe(false)
    expect(isInviteCode('')).toBe(false)
  })
})
