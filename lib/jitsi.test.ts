import { describe, expect, it } from 'vitest'
import { JITSI_DOMAIN, jitsiMeetingUrl, jitsiRoomName, sessionMeetingUrl } from './jitsi'

const SESSION_ID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b'

describe('jitsiRoomName', () => {
  it('derives deterministically from the session id', () => {
    expect(jitsiRoomName(SESSION_ID)).toBe(`Petrios-${SESSION_ID}`)
    expect(jitsiRoomName(SESSION_ID)).toBe(jitsiRoomName(SESSION_ID))
  })
})

describe('jitsiMeetingUrl', () => {
  it('builds an https URL on the configured domain', () => {
    expect(jitsiMeetingUrl(SESSION_ID)).toBe(
      `https://${JITSI_DOMAIN}/Petrios-${SESSION_ID}`
    )
    expect(JITSI_DOMAIN).toBe('meet.jit.si') // default when env unset (tests)
  })
})

describe('sessionMeetingUrl', () => {
  const base = { id: SESSION_ID, teams_meeting_url: 'https://teams.microsoft.com/x' }

  it('derives the Jitsi room for JITSI sessions (ignores teams url)', () => {
    expect(sessionMeetingUrl({ ...base, location_type: 'JITSI' })).toBe(
      jitsiMeetingUrl(SESSION_ID)
    )
  })

  it('uses the stored Teams url for MS_TEAMS and HYBRID', () => {
    expect(sessionMeetingUrl({ ...base, location_type: 'MS_TEAMS' })).toBe(base.teams_meeting_url)
    expect(sessionMeetingUrl({ ...base, location_type: 'HYBRID' })).toBe(base.teams_meeting_url)
  })

  it('is null for in-person sessions and for Teams sessions without a link', () => {
    expect(sessionMeetingUrl({ ...base, location_type: 'IN_PERSON' })).toBeNull()
    expect(
      sessionMeetingUrl({ id: SESSION_ID, location_type: 'MS_TEAMS', teams_meeting_url: null })
    ).toBeNull()
  })
})
