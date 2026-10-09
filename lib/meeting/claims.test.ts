import { describe, expect, it } from 'vitest'
import {
  buildJaasToken,
  buildSelfHostedToken,
  JAAS_DISABLED_FEATURES,
  pseudonymousParticipantId,
  roomClaim,
  TOKEN_MAX_LIFETIME_SECONDS,
  TOKEN_NBF_SKEW_SECONDS,
  tokenTimes,
} from './claims'

const SESSION_ID = '3F2A1B4C-5D6E-4F70-8A9B-0C1D2E3F4A5B'
const APP_ID = 'vpaas-magic-cookie-0123456789abcdef'
const NOW = new Date('2026-10-09T10:00:00.000Z')
const NOW_S = NOW.getTime() / 1000
const IN_ONE_HOUR = new Date(NOW.getTime() + 60 * 60 * 1000)
const IN_TEN_HOURS = new Date(NOW.getTime() + 10 * 60 * 60 * 1000)

const participant = { id: 'a'.repeat(32), name: 'Grace Hopper', moderator: false }
const moderator = { ...participant, moderator: true }

function jaasPayload(user = participant, closesAt = IN_ONE_HOUR) {
  return buildJaasToken({ appId: APP_ID, kid: `${APP_ID}/4f4910`, sessionId: SESSION_ID, user, now: NOW, closesAt })
}

describe('tokenTimes', () => {
  it('expires at the room close when it is closer than 4 hours', () => {
    expect(tokenTimes(NOW, IN_ONE_HOUR)).toEqual({ iat: NOW_S, nbf: NOW_S - 30, exp: NOW_S + 3600 })
  })

  it('caps the lifetime at 4 hours when the room closes later', () => {
    expect(tokenTimes(NOW, IN_TEN_HOURS).exp).toBe(NOW_S + TOKEN_MAX_LIFETIME_SECONDS)
    expect(TOKEN_MAX_LIFETIME_SECONDS).toBe(4 * 60 * 60)
  })

  it('backdates nbf by the skew allowance and uses whole seconds', () => {
    const times = tokenTimes(new Date(NOW.getTime() + 999), IN_ONE_HOUR)
    expect(times.iat).toBe(NOW_S)
    expect(times.nbf).toBe(NOW_S - TOKEN_NBF_SKEW_SECONDS)
    expect(Number.isInteger(times.exp)).toBe(true)
  })

  it('refuses to mint once the room has closed (never valid past the window)', () => {
    expect(() => tokenTimes(NOW, NOW)).toThrow(RangeError)
    expect(() => tokenTimes(NOW, new Date(NOW.getTime() - 1000))).toThrow(RangeError)
    expect(() => tokenTimes(NOW, new Date('nonsense'))).toThrow(RangeError)
  })
})

describe('JaaS claims', () => {
  it('follow the JaaS template exactly', () => {
    const { header, payload } = jaasPayload()
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT', kid: `${APP_ID}/4f4910` })
    expect(payload).toEqual({
      aud: 'jitsi',
      iss: 'chat',
      sub: APP_ID,
      room: 'petrios-3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
      iat: NOW_S,
      nbf: NOW_S - 30,
      exp: NOW_S + 3600,
      context: {
        user: { id: participant.id, name: 'Grace Hopper', moderator: 'false' },
        features: {
          livestreaming: 'false',
          recording: 'false',
          transcription: 'false',
          'outbound-call': 'false',
          'sip-outbound-call': 'false',
          'inbound-call': 'false',
          'sip-inbound-call': 'false',
          'file-upload': 'false',
        },
        room: { regex: false },
      },
    })
  })

  it('restrict the pass to one lower-case room without the AppID', () => {
    const { payload } = jaasPayload()
    expect(payload.room).toBe(roomClaim(SESSION_ID))
    expect(payload.room).not.toContain(APP_ID)
    expect(payload.room).not.toContain('/')
    expect(payload.room).not.toBe('*')
    expect(payload.room).toBe((payload.room as string).toLowerCase())
  })

  it('encode moderator as the STRING "true"/"false"', () => {
    const user = (p: ReturnType<typeof jaasPayload>) => (p.payload.context as { user: Record<string, unknown> }).user
    expect(user(jaasPayload(moderator)).moderator).toBe('true')
    expect(user(jaasPayload(participant)).moderator).toBe('false')
  })

  it('switch every optional service off with string flags', () => {
    const features = (jaasPayload().payload.context as { features: Record<string, unknown> }).features
    expect(Object.keys(features).length).toBeGreaterThanOrEqual(8)
    for (const value of Object.values(features)) expect(value).toBe('false')
    expect(features).toEqual(JAAS_DISABLED_FEATURES)
  })

  it('carry only id, name and moderator about the user: no email, no avatar', () => {
    const { payload } = jaasPayload()
    const user = (payload.context as { user: Record<string, unknown> }).user
    expect(Object.keys(user).sort()).toEqual(['id', 'moderator', 'name'])
    const json = JSON.stringify(payload)
    expect(json).not.toMatch(/email/i)
    expect(json).not.toContain('@')
    expect(json).not.toContain('avatar')
    expect(json).not.toContain('null')
  })

  it('never outlive the room', () => {
    expect(jaasPayload(participant, IN_TEN_HOURS).payload.exp).toBe(NOW_S + TOKEN_MAX_LIFETIME_SECONDS)
    expect(() => jaasPayload(participant, NOW)).toThrow(RangeError)
  })
})

describe('self-hosted claims', () => {
  it('follow the Prosody token-auth template', () => {
    const { header, payload } = buildSelfHostedToken({
      appId: 'petrios', audience: 'jitsi', subject: 'meet.example.org',
      sessionId: SESSION_ID, user: moderator, now: NOW, closesAt: IN_ONE_HOUR,
    })
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(payload).toMatchObject({
      aud: 'jitsi',
      iss: 'petrios',
      sub: 'meet.example.org',
      room: 'petrios-3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
      iat: NOW_S,
      nbf: NOW_S - 30,
      exp: NOW_S + 3600,
      context: { user: { id: participant.id, name: 'Grace Hopper', moderator: 'true' } },
    })
    expect(JSON.stringify(payload)).not.toMatch(/email|null/)
  })

  it('pass audience and subject overrides through unchanged', () => {
    const { payload } = buildSelfHostedToken({
      appId: 'petrios', audience: '*', subject: 'meet.jitsi',
      sessionId: SESSION_ID, user: participant, now: NOW, closesAt: IN_TEN_HOURS,
    })
    expect(payload).toMatchObject({ aud: '*', sub: 'meet.jitsi', exp: NOW_S + TOKEN_MAX_LIFETIME_SECONDS })
  })
})

describe('pseudonymousParticipantId', () => {
  it('is 32 hex characters, stable per (session, subject) and different across sessions and subjects', async () => {
    const a = await pseudonymousParticipantId('s-1', 'user:u-1')
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(await pseudonymousParticipantId('s-1', 'user:u-1')).toBe(a)
    expect(await pseudonymousParticipantId('s-2', 'user:u-1')).not.toBe(a)
    expect(await pseudonymousParticipantId('s-1', 'user:u-2')).not.toBe(a)
    expect(await pseudonymousParticipantId('s-1', 'invitation:u-1')).not.toBe(a)
  })

  it('is the documented SHA-256 derivation and does not contain its inputs', async () => {
    const { createHash } = await import('node:crypto')
    const expected = createHash('sha256').update('petrios-meet:s-1:user:u-1').digest('hex').slice(0, 32)
    const id = await pseudonymousParticipantId('s-1', 'user:u-1')
    expect(id).toBe(expected)
    expect(id).not.toContain('u-1')
  })
})
