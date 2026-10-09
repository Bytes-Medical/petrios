import { afterEach, describe, expect, it, vi } from 'vitest'

const appUrl = vi.hoisted(() => ({ value: 'https://petrios.example' as string | null }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/app-url', () => ({
  getAppUrl: () => {
    // Mirrors lib/app-url.ts in production without a configured public URL.
    if (appUrl.value === null) throw new Error('NEXT_PUBLIC_APP_URL must be set to the public app URL before sending email links.')
    return appUrl.value
  },
}))

import {
  jitsiRoomName,
  meetingGuestUrl,
  meetingRoomName,
  resetMeetingLinkLogForTests,
  sessionMeetingUrl,
} from './jitsi'
import type { MeetingAudience, MeetingConfig } from './meeting/types'

const SESSION_ID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b'
const APP_ID = 'vpaas-magic-cookie-0123456789abcdef'

type OkConfig = Extract<MeetingConfig, { ok: true }>

const JAAS: OkConfig = {
  ok: true, mode: 'jaas', domain: '8x8.vc', origin: 'https://8x8.vc', appId: APP_ID, tokenAuth: 'jaas-rs256',
}
const SELF_HOSTED_JWT: OkConfig = {
  ok: true, mode: 'self-hosted', domain: 'meet.example.org:8443', origin: 'https://meet.example.org:8443',
  tokenAuth: 'hs256', appId: 'petrios', audience: 'jitsi', subject: 'meet.example.org',
}
const SELF_HOSTED_OPEN: OkConfig = {
  ok: true, mode: 'self-hosted', domain: 'meet.example.org', origin: 'https://meet.example.org', tokenAuth: 'none',
}
const PUBLIC: OkConfig = {
  ok: true, mode: 'public', domain: 'meet.jit.si', origin: 'https://meet.jit.si', tokenAuth: 'none',
}
const UNAVAILABLE: MeetingConfig = { ok: false, mode: 'unavailable', error: 'JaaS is partly configured' }

const MEMBER: MeetingAudience = { kind: 'member' }
const EXTERNAL: MeetingAudience = { kind: 'external_teacher', inviteCode: 'AB7KQ9ZX' }

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  appUrl.value = 'https://petrios.example'
  resetMeetingLinkLogForTests()
})

describe('room naming', () => {
  it('derives the room deterministically from the session id', () => {
    expect(jitsiRoomName(SESSION_ID)).toBe(`Petrios-${SESSION_ID}`)
  })

  it('prefixes JaaS rooms with the AppID and leaves other rooms bare', () => {
    expect(meetingRoomName(SESSION_ID, JAAS)).toBe(`${APP_ID}/Petrios-${SESSION_ID}`)
    expect(meetingRoomName(SESSION_ID, SELF_HOSTED_JWT)).toBe(`Petrios-${SESSION_ID}`)
    expect(meetingRoomName(SESSION_ID, PUBLIC)).toBe(`Petrios-${SESSION_ID}`)
  })
})

describe('meetingGuestUrl', () => {
  it('is the raw room URL only where no room pass is needed', () => {
    expect(meetingGuestUrl(SESSION_ID, PUBLIC)).toBe(`https://meet.jit.si/Petrios-${SESSION_ID}`)
    expect(meetingGuestUrl(SESSION_ID, SELF_HOSTED_OPEN)).toBe(`https://meet.example.org/Petrios-${SESSION_ID}`)
    expect(meetingGuestUrl(SESSION_ID, JAAS)).toBeNull()
    expect(meetingGuestUrl(SESSION_ID, SELF_HOSTED_JWT)).toBeNull()
    expect(meetingGuestUrl(SESSION_ID, UNAVAILABLE)).toBeNull()
  })

  it('defaults to the environment (meet.jit.si when nothing is configured)', () => {
    for (const name of ['JITSI_DOMAIN', 'NEXT_PUBLIC_JITSI_DOMAIN', 'JAAS_APP_ID', 'JAAS_API_KEY_ID', 'JAAS_PRIVATE_KEY', 'JITSI_APP_ID', 'JITSI_APP_SECRET']) {
      vi.stubEnv(name, '')
    }
    expect(meetingGuestUrl(SESSION_ID)).toBe(`https://meet.jit.si/Petrios-${SESSION_ID}`)
    vi.stubEnv('JITSI_DOMAIN', 'video.trust.nhs.uk')
    expect(meetingGuestUrl(SESSION_ID)).toBe(`https://video.trust.nhs.uk/Petrios-${SESSION_ID}`)
  })
})

describe('sessionMeetingUrl (the single outbound-link resolver)', () => {
  const teams = 'https://teams.microsoft.com/l/meetup-join/x'
  const jitsi = { id: SESSION_ID, location_type: 'JITSI', teams_meeting_url: teams }
  const sessionPage = `https://petrios.example/sessions/${SESSION_ID}`
  const rsvpPage = `https://petrios.example/sessions/${SESSION_ID}/teacher-rsvp/AB7KQ9ZX`

  it.each([
    ['public (meet.jit.si)', PUBLIC, `https://meet.jit.si/Petrios-${SESSION_ID}`],
    ['open self-hosted', SELF_HOSTED_OPEN, `https://meet.example.org/Petrios-${SESSION_ID}`],
    ['jaas', JAAS, rsvpPage],
    ['self-hosted with room passes', SELF_HOSTED_JWT, rsvpPage],
    ['unavailable', UNAVAILABLE, rsvpPage],
  ] as const)('JITSI in %s mode: members get the session page; external teachers %s', (_mode, config, external) => {
    // Members: the session page attempts their check-in and explains the room
    // (incl. the meet.jit.si new tab and sign-in) in every mode.
    expect(sessionMeetingUrl(jitsi, MEMBER, config)).toBe(sessionPage)
    expect(sessionMeetingUrl(jitsi, EXTERNAL, config)).toBe(external)
  })

  it('never hands a member a raw room URL, and never anyone a token-mode room URL', () => {
    for (const config of [PUBLIC, SELF_HOSTED_OPEN, JAAS, SELF_HOSTED_JWT, UNAVAILABLE]) {
      expect(sessionMeetingUrl(jitsi, MEMBER, config)).toBe(sessionPage)
    }
    for (const config of [JAAS, SELF_HOSTED_JWT]) {
      const url = sessionMeetingUrl(jitsi, EXTERNAL, config) as string
      expect(url).toBe(rsvpPage)
      expect(url).not.toMatch(/8x8\.vc|meet\.example\.org/)
    }
  })

  it('never throws without a public app URL: raw room where it works without a pass, else null, logged once', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    appUrl.value = null
    expect(sessionMeetingUrl(jitsi, MEMBER, PUBLIC)).toBe(`https://meet.jit.si/Petrios-${SESSION_ID}`)
    expect(sessionMeetingUrl(jitsi, EXTERNAL, SELF_HOSTED_OPEN)).toBe(`https://meet.example.org/Petrios-${SESSION_ID}`)
    expect(sessionMeetingUrl(jitsi, MEMBER, JAAS)).toBeNull()
    expect(sessionMeetingUrl(jitsi, EXTERNAL, SELF_HOSTED_JWT)).toBeNull()
    expect(sessionMeetingUrl(jitsi, MEMBER, UNAVAILABLE)).toBeNull()
    // Teams links never needed the app URL.
    expect(sessionMeetingUrl({ ...jitsi, location_type: 'MS_TEAMS' }, MEMBER, JAAS)).toBe(teams)
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0][0])).toContain('[petrios-meet]')
  })

  it('URL-encodes the invite code', () => {
    expect(
      sessionMeetingUrl(jitsi, { kind: 'external_teacher', inviteCode: 'a/b?c#d' }, JAAS)
    ).toBe(`https://petrios.example/sessions/${SESSION_ID}/teacher-rsvp/a%2Fb%3Fc%23d`)
  })

  it('uses the stored Teams link for MS_TEAMS and HYBRID in every mode and for every audience', () => {
    for (const config of [PUBLIC, JAAS, SELF_HOSTED_JWT, SELF_HOSTED_OPEN, UNAVAILABLE]) {
      for (const audience of [MEMBER, EXTERNAL]) {
        expect(sessionMeetingUrl({ ...jitsi, location_type: 'MS_TEAMS' }, audience, config)).toBe(teams)
        expect(sessionMeetingUrl({ ...jitsi, location_type: 'HYBRID' }, audience, config)).toBe(teams)
      }
    }
  })

  it('is null for in-person sessions and for Teams sessions without a link', () => {
    for (const config of [PUBLIC, JAAS]) {
      expect(sessionMeetingUrl({ ...jitsi, location_type: 'IN_PERSON' }, MEMBER, config)).toBeNull()
      expect(sessionMeetingUrl({ ...jitsi, location_type: 'IN_PERSON' }, EXTERNAL, config)).toBeNull()
      expect(sessionMeetingUrl({ id: SESSION_ID, location_type: 'MS_TEAMS', teams_meeting_url: null }, MEMBER, config)).toBeNull()
      expect(sessionMeetingUrl({ id: SESSION_ID, location_type: 'HYBRID', teams_meeting_url: '' }, MEMBER, config)).toBeNull()
    }
  })
})
