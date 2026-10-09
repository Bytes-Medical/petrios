import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { icsEventLinks } from './ics-event-links'
import type { MeetingConfig } from './meeting/types'

const APP = 'https://petrios.example.org'
const SESSION_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const TEAMS_URL = 'https://teams.microsoft.com/l/meetup-join/xyz'

const JAAS: MeetingConfig = {
  ok: true,
  mode: 'jaas',
  domain: '8x8.vc',
  origin: 'https://8x8.vc',
  appId: 'vpaas-magic-cookie-0123abcd',
  tokenAuth: 'jaas-rs256',
}
const PUBLIC: MeetingConfig = {
  ok: true,
  mode: 'public',
  domain: 'meet.jit.si',
  origin: 'https://meet.jit.si',
  tokenAuth: 'none',
}

const session = (location_type: string, teams_meeting_url: string | null = null) => ({
  id: SESSION_ID,
  location_type,
  teams_meeting_url,
})

beforeEach(() => {
  vi.stubEnv('APP_URL', APP)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('icsEventLinks', () => {
  it('points a JaaS room at the member session page, as LOCATION and URL', () => {
    expect(icsEventLinks(session('JITSI'), JAAS)).toEqual({
      location: `${APP}/sessions/${SESSION_ID}`,
      url: `${APP}/sessions/${SESSION_ID}`,
    })
  })

  it('points a public-mode (meet.jit.si) room at the session page too, so check-in is attempted', () => {
    const page = `${APP}/sessions/${SESSION_ID}`
    expect(icsEventLinks(session('JITSI'), PUBLIC)).toEqual({ location: page, url: page })
  })

  it('does not fail the feed without a public app URL in production (raw room, or the label)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const key of ['APP_URL', 'NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_BASE_URL', 'NEXTAUTH_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL', 'RENDER_EXTERNAL_URL']) {
      vi.stubEnv(key, '')
    }
    vi.stubEnv('NODE_ENV', 'production')
    expect(icsEventLinks(session('JITSI'), JAAS)).toEqual({ location: 'Petrios Meet (Video)', url: undefined })
    const room = `https://meet.jit.si/Petrios-${SESSION_ID}`
    expect(icsEventLinks(session('JITSI'), PUBLIC)).toEqual({ location: room, url: room })
  })

  it('never puts an 8x8.vc room (useless without a token) in the feed', () => {
    const { location, url } = icsEventLinks(session('JITSI'), JAAS)
    expect(`${location} ${url}`).not.toContain('8x8.vc')
  })

  it('keeps the Teams, hybrid and in-person LOCATION text and sets no URL for them', () => {
    expect(icsEventLinks(session('MS_TEAMS', TEAMS_URL), JAAS)).toEqual({ location: TEAMS_URL, url: undefined })
    expect(icsEventLinks(session('MS_TEAMS'), JAAS)).toEqual({ location: 'Microsoft Teams', url: undefined })
    expect(icsEventLinks(session('HYBRID', TEAMS_URL), PUBLIC)).toEqual({
      location: `${TEAMS_URL} / In Person`,
      url: undefined,
    })
    expect(icsEventLinks(session('IN_PERSON'), PUBLIC)).toEqual({ location: 'In Person', url: undefined })
  })

  it('has no LOCATION for an unknown location type', () => {
    expect(icsEventLinks(session('SOMETHING_ELSE'), PUBLIC)).toEqual({ location: undefined, url: undefined })
  })
})
