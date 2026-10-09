import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { serializeSession } from './serializers'
import type { Session } from '@/lib/types'

const APP = 'https://petrios.example.org'
const SESSION_ID = '0b8f3c2a-5d6e-4f70-8a91-b2c3d4e5f607'
const SESSION_PAGE = `${APP}/sessions/${SESSION_ID}`
const PUBLIC_ROOM = `https://meet.jit.si/Petrios-${SESSION_ID}`

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

// Test-only key material: a throwaway RSA key so the JaaS configuration is
// complete and valid. It never leaves this process.
const { privateKey: JAAS_TEST_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: SESSION_ID,
    org_id: 'org-1',
    department_id: 'dept-1',
    title: 'Acute kidney injury',
    description: null,
    date_start: '2026-10-12T12:00:00.000Z',
    date_end: '2026-10-12T13:00:00.000Z',
    location_type: 'JITSI',
    teams_meeting_url: null,
    status: 'PUBLISHED',
    created_by: 'user-1',
    created_at: '2026-10-01T09:00:00.000Z',
    updated_at: '2026-10-01T09:00:00.000Z',
    tags: null,
    capacity: null,
    session_type: null,
    ...overrides,
  }
}

function useJaas() {
  vi.stubEnv('JAAS_APP_ID', 'vpaas-magic-cookie-0123abcd')
  vi.stubEnv('JAAS_API_KEY_ID', 'vpaas-magic-cookie-0123abcd/4f5e6d')
  vi.stubEnv('JAAS_PRIVATE_KEY', JAAS_TEST_KEY)
}

beforeEach(() => {
  vi.stubEnv('APP_URL', APP)
  for (const name of MEETING_ENV) vi.stubEnv(name, '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('serializeSession meeting_url', () => {
  it('is the Petrios session page in public mode (the default), not the raw meet.jit.si room', () => {
    expect(serializeSession(session()).meeting_url).toBe(SESSION_PAGE)
  })

  it('is the Petrios session page when rooms are JaaS token-protected', () => {
    useJaas()
    const { meeting_url } = serializeSession(session())
    expect(meeting_url).toBe(SESSION_PAGE)
    expect(meeting_url).not.toContain('8x8.vc')
  })

  it('is the Petrios session page when a self-hosted server requires a JWT', () => {
    vi.stubEnv('JITSI_DOMAIN', 'video.trust.example')
    vi.stubEnv('JITSI_APP_ID', 'petrios')
    vi.stubEnv('JITSI_APP_SECRET', 'not-a-real-secret')
    expect(serializeSession(session()).meeting_url).toBe(SESSION_PAGE)
  })

  it('is the Petrios session page on an open self-hosted server too', () => {
    vi.stubEnv('JITSI_DOMAIN', 'video.trust.example')
    expect(serializeSession(session()).meeting_url).toBe(SESSION_PAGE)
  })

  it('does not throw without a public app URL in production (a self-hosted install missing APP_URL)', () => {
    for (const key of ['APP_URL', 'NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_BASE_URL', 'NEXTAUTH_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL', 'RENDER_EXTERNAL_URL']) {
      vi.stubEnv(key, '')
    }
    vi.stubEnv('NODE_ENV', 'production')
    expect(serializeSession(session()).meeting_url).toBe(PUBLIC_ROOM)
    useJaas()
    expect(() => [session(), session()].map(serializeSession)).not.toThrow()
    expect(serializeSession(session()).meeting_url).toBeNull()
  })

  it('stays a Petrios link (and does not throw) while the meeting configuration is broken', () => {
    vi.stubEnv('JAAS_APP_ID', 'vpaas-magic-cookie-0123abcd')
    expect(serializeSession(session()).meeting_url).toBe(SESSION_PAGE)
  })

  it('is the stored Teams link for Teams/hybrid and null in person, whatever the meeting mode', () => {
    useJaas()
    const teams = 'https://teams.microsoft.com/l/meetup-join/abc'
    expect(serializeSession(session({ location_type: 'MS_TEAMS', teams_meeting_url: teams })).meeting_url).toBe(teams)
    expect(serializeSession(session({ location_type: 'HYBRID', teams_meeting_url: teams })).meeting_url).toBe(teams)
    expect(serializeSession(session({ location_type: 'IN_PERSON' })).meeting_url).toBeNull()
  })
})

describe('serializeSession contract', () => {
  it('is safe to pass straight to Array.prototype.map (the index argument is ignored)', () => {
    useJaas()
    const other = session({ id: '1a2b3c4d-0000-4000-8000-000000000001', location_type: 'IN_PERSON' })
    expect([session(), other].map(serializeSession)).toEqual([
      serializeSession(session()),
      serializeSession(other),
    ])
  })

  it('emits exactly the Session properties documented in public/openapi.json', () => {
    const openapi = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../public/openapi.json'), 'utf8')
    ) as { components: { schemas: { Session: { properties: Record<string, { description?: string }> } } } }
    const documented = openapi.components.schemas.Session.properties
    expect(Object.keys(serializeSession(session())).sort()).toEqual(Object.keys(documented).sort())
    expect(documented.meeting_url.description).toMatch(/session page/i)
  })

  it('never exposes the raw stored link column or internal fields', () => {
    const body = serializeSession(session({ location_type: 'MS_TEAMS', teams_meeting_url: 'https://teams.example/x' }))
    expect(body).not.toHaveProperty('teams_meeting_url')
    expect(body).not.toHaveProperty('org_id')
    expect(body).not.toHaveProperty('created_by')
  })
})
