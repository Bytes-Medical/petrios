import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { reminderAudience, reminderLinksFor } from './session-reminder-links'
import type { MeetingConfig } from './meeting/types'

const APP = 'https://petrios.example.org'
const SESSION_ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'
const SESSION_PAGE = `${APP}/sessions/${SESSION_ID}`
const RSVP_PAGE = `${APP}/sessions/${SESSION_ID}/teacher-rsvp/AbC12345`

const member = { inviteCode: null }
const external = { inviteCode: 'AbC12345' }

const jitsi = { id: SESSION_ID, location_type: 'JITSI', teams_meeting_url: null }

const JAAS: MeetingConfig = {
  ok: true,
  mode: 'jaas',
  domain: '8x8.vc',
  origin: 'https://8x8.vc',
  appId: 'vpaas-magic-cookie-0123abcd',
  tokenAuth: 'jaas-rs256',
}
const SELF_HOSTED_JWT: MeetingConfig = {
  ok: true,
  mode: 'self-hosted',
  domain: 'video.trust.example',
  origin: 'https://video.trust.example',
  tokenAuth: 'hs256',
  appId: 'petrios',
  audience: 'jitsi',
  subject: 'video.trust.example',
}
const SELF_HOSTED_OPEN: MeetingConfig = {
  ok: true,
  mode: 'self-hosted',
  domain: 'video.trust.example:8443',
  origin: 'https://video.trust.example:8443',
  tokenAuth: 'none',
}
const PUBLIC: MeetingConfig = {
  ok: true,
  mode: 'public',
  domain: 'meet.jit.si',
  origin: 'https://meet.jit.si',
  tokenAuth: 'none',
}
const UNAVAILABLE: MeetingConfig = {
  ok: false,
  mode: 'unavailable',
  error: 'JaaS is partly configured: set all of JAAS_APP_ID, JAAS_API_KEY_ID and JAAS_PRIVATE_KEY (missing: JAAS_PRIVATE_KEY).',
}

const MEETING_ENV = [
  'JITSI_DOMAIN',
  'NEXT_PUBLIC_JITSI_DOMAIN',
  'JAAS_APP_ID',
  'JAAS_API_KEY_ID',
  'JAAS_PRIVATE_KEY',
  'JITSI_APP_ID',
  'JITSI_APP_SECRET',
  'JITSI_JWT_AUDIENCE',
  'JITSI_JWT_SUBJECT',
] as const

beforeEach(() => {
  // sessionMeetingUrl builds token-mode links from the configured app URL.
  vi.stubEnv('APP_URL', APP)
  for (const name of MEETING_ENV) vi.stubEnv(name, '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('reminderAudience', () => {
  it('treats a recipient with an invitation code as an external teacher', () => {
    expect(reminderAudience(external)).toEqual({ kind: 'external_teacher', inviteCode: 'AbC12345' })
    expect(reminderAudience(member)).toEqual({ kind: 'member' })
  })
})

describe('reminderLinksFor: token-protected rooms never mail a raw room URL', () => {
  it.each([
    ['JaaS', JAAS],
    ['self-hosted JWT', SELF_HOSTED_JWT],
  ])('%s: members get the session page for both links', (_label, config) => {
    expect(reminderLinksFor(jitsi, member, APP, config)).toEqual({
      meetingUrl: SESSION_PAGE,
      sessionUrl: SESSION_PAGE,
    })
  })

  it.each([
    ['JaaS', JAAS],
    ['self-hosted JWT', SELF_HOSTED_JWT],
  ])('%s: external teachers get their RSVP page for both links', (_label, config) => {
    const links = reminderLinksFor(jitsi, external, APP, config)
    expect(links).toEqual({ meetingUrl: RSVP_PAGE, sessionUrl: RSVP_PAGE })
    expect(links.meetingUrl).not.toContain('8x8.vc')
    expect(links.meetingUrl).not.toContain('video.trust.example')
  })

  it('keeps links pointing at Petrios while the meeting configuration is broken', () => {
    expect(reminderLinksFor(jitsi, member, APP, UNAVAILABLE)).toEqual({
      meetingUrl: SESSION_PAGE,
      sessionUrl: SESSION_PAGE,
    })
    expect(reminderLinksFor(jitsi, external, APP, UNAVAILABLE)).toEqual({
      meetingUrl: RSVP_PAGE,
      sessionUrl: RSVP_PAGE,
    })
  })
})

describe('reminderLinksFor: rooms that need no pass', () => {
  it('public mode mails members the session page (check-in) and externals the meet.jit.si room', () => {
    // The session page attempts the member's check-in and explains the
    // meet.jit.si new tab and its first-arrival sign-in.
    const room = `https://meet.jit.si/Petrios-${SESSION_ID}`
    expect(reminderLinksFor(jitsi, member, APP, PUBLIC)).toEqual({ meetingUrl: SESSION_PAGE, sessionUrl: SESSION_PAGE })
    expect(reminderLinksFor(jitsi, external, APP, PUBLIC)).toEqual({ meetingUrl: room, sessionUrl: RSVP_PAGE })
  })

  it('an open self-hosted server mails members the session page and externals the room, port included', () => {
    expect(reminderLinksFor(jitsi, external, APP, SELF_HOSTED_OPEN).meetingUrl).toBe(
      `https://video.trust.example:8443/Petrios-${SESSION_ID}`
    )
    expect(reminderLinksFor(jitsi, member, APP, SELF_HOSTED_OPEN).meetingUrl).toBe(SESSION_PAGE)
  })

  it('defaults to the environment (public mode when nothing is set)', () => {
    expect(reminderLinksFor(jitsi, member, APP).meetingUrl).toBe(SESSION_PAGE)
  })

  it('defaults to the environment, which resolves to a token mode when self-hosted JWT is set', () => {
    vi.stubEnv('JITSI_DOMAIN', 'video.trust.example')
    vi.stubEnv('JITSI_APP_ID', 'petrios')
    vi.stubEnv('JITSI_APP_SECRET', 'not-a-real-secret')
    expect(reminderLinksFor(jitsi, external, APP)).toEqual({ meetingUrl: RSVP_PAGE, sessionUrl: RSVP_PAGE })
  })
})

describe('reminderLinksFor: other locations', () => {
  const teams = { id: SESSION_ID, location_type: 'MS_TEAMS', teams_meeting_url: 'https://teams.microsoft.com/l/meetup-join/abc' }

  it('sends the stored Teams link to every audience, in any meeting mode', () => {
    for (const config of [JAAS, PUBLIC, UNAVAILABLE]) {
      expect(reminderLinksFor(teams, member, APP, config)).toEqual({
        meetingUrl: teams.teams_meeting_url,
        sessionUrl: SESSION_PAGE,
      })
      expect(reminderLinksFor({ ...teams, location_type: 'HYBRID' }, external, APP, config)).toEqual({
        meetingUrl: teams.teams_meeting_url,
        sessionUrl: RSVP_PAGE,
      })
    }
  })

  it('has no join link for in-person sessions or Teams sessions without a stored link', () => {
    expect(reminderLinksFor({ ...jitsi, location_type: 'IN_PERSON' }, member, APP, JAAS).meetingUrl).toBeNull()
    expect(reminderLinksFor({ ...teams, teams_meeting_url: null }, external, APP, JAAS)).toEqual({
      meetingUrl: null,
      sessionUrl: RSVP_PAGE,
    })
  })
})

describe('reminderLinksFor: invitation codes are URL-encoded', () => {
  it('cannot be used to break out of the RSVP path', () => {
    const links = reminderLinksFor(jitsi, { inviteCode: 'a/b?c#d' }, APP, JAAS)
    expect(links.sessionUrl).toBe(`${APP}/sessions/${SESSION_ID}/teacher-rsvp/a%2Fb%3Fc%23d`)
    expect(links.meetingUrl).toBe(links.sessionUrl)
  })
})
