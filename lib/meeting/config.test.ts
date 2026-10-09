import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getMeetingConfig,
  meetingEmbedOrigin,
  resetMeetingConfigForTests,
  MEETING_CONFIG_ERRORS,
  normalizePrivateKeyPem,
  resolveMeetingConfig,
} from './config'
import type { MeetingConfig } from './types'

const APP_ID = 'vpaas-magic-cookie-0123456789abcdef'
const KEY_ID = `${APP_ID}/4f4910`
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
const PKCS8 = rsa.export({ type: 'pkcs8', format: 'pem' }).toString()
const PKCS1 = rsa.export({ type: 'pkcs1', format: 'pem' }).toString()
const EC_PKCS8 = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString()
const ENCRYPTED = rsa
  .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'pass' })
  .toString()
const SECRET = 'hs256-shared-secret-value'

/** Base64 body of a PEM (the part that must never appear in an error). */
function bodyOf(pem: string): string {
  return pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
}

function jaas(extra: Record<string, string | undefined> = {}) {
  return resolveMeetingConfig({ JAAS_APP_ID: APP_ID, JAAS_API_KEY_ID: KEY_ID, JAAS_PRIVATE_KEY: PKCS8, ...extra })
}

function expectError(config: MeetingConfig, text?: string): string {
  expect(config.ok).toBe(false)
  if (config.ok) throw new Error('unreachable')
  expect(config.mode).toBe('unavailable')
  if (text) expect(config.error).toContain(text)
  return config.error
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetMeetingConfigForTests()
})

describe('public mode (meet.jit.si)', () => {
  it('is the default with nothing configured', () => {
    expect(resolveMeetingConfig({})).toEqual({
      ok: true, mode: 'public', domain: 'meet.jit.si', origin: 'https://meet.jit.si', tokenAuth: 'none',
    })
  })

  it('is selected by an explicit meet.jit.si (any case, any port)', () => {
    expect(resolveMeetingConfig({ JITSI_DOMAIN: 'meet.jit.si' })).toMatchObject({ ok: true, mode: 'public' })
    expect(resolveMeetingConfig({ JITSI_DOMAIN: 'MEET.JIT.SI' })).toMatchObject({ ok: true, mode: 'public' })
    expect(resolveMeetingConfig({ JITSI_DOMAIN: 'meet.jit.si:443' })).toMatchObject({ ok: true, mode: 'public' })
  })

  it('treats empty and whitespace-only values as unset', () => {
    expect(
      resolveMeetingConfig({ JITSI_DOMAIN: '   ', JAAS_APP_ID: '', JAAS_API_KEY_ID: ' ', JITSI_APP_ID: '\n' })
    ).toMatchObject({ ok: true, mode: 'public' })
  })

  it('rejects self-hosted token settings, which cannot apply to meet.jit.si', () => {
    expectError(resolveMeetingConfig({ JITSI_APP_ID: 'petrios', JITSI_APP_SECRET: SECRET }), 'apply only to a self-hosted')
    expectError(resolveMeetingConfig({ JITSI_DOMAIN: 'meet.jit.si', JITSI_JWT_AUDIENCE: 'jitsi' }), 'apply only to a self-hosted')
  })
})

describe('self-hosted mode', () => {
  it('honours the legacy NEXT_PUBLIC_JITSI_DOMAIN alias, JITSI_DOMAIN winning', () => {
    expect(resolveMeetingConfig({ NEXT_PUBLIC_JITSI_DOMAIN: 'legacy.example.org' })).toMatchObject({
      mode: 'self-hosted', domain: 'legacy.example.org',
    })
    expect(
      resolveMeetingConfig({ JITSI_DOMAIN: 'new.example.org', NEXT_PUBLIC_JITSI_DOMAIN: 'legacy.example.org' })
    ).toMatchObject({ domain: 'new.example.org' })
  })

  it('is an open room (no passes) without app id/secret, the domain lower-cased', () => {
    expect(resolveMeetingConfig({ JITSI_DOMAIN: ' Video.Trust.NHS.uk ' })).toEqual({
      ok: true, mode: 'self-hosted', domain: 'video.trust.nhs.uk', origin: 'https://video.trust.nhs.uk', tokenAuth: 'none',
    })
  })

  it('uses HS256 passes with default audience "jitsi" and subject = host without port', () => {
    const config = resolveMeetingConfig({ JITSI_DOMAIN: 'meet.example.org:8443', JITSI_APP_ID: 'petrios', JITSI_APP_SECRET: SECRET })
    expect(config).toEqual({
      ok: true,
      mode: 'self-hosted',
      domain: 'meet.example.org:8443',
      origin: 'https://meet.example.org:8443',
      tokenAuth: 'hs256',
      appId: 'petrios',
      audience: 'jitsi',
      subject: 'meet.example.org',
    })
    expect(JSON.stringify(config)).not.toContain(SECRET)
  })

  it('accepts audience and subject overrides (docker-jitsi-meet XMPP domain)', () => {
    expect(
      resolveMeetingConfig({
        JITSI_DOMAIN: 'meet.example.org', JITSI_APP_ID: 'petrios', JITSI_APP_SECRET: SECRET,
        JITSI_JWT_AUDIENCE: '*', JITSI_JWT_SUBJECT: 'meet.jitsi',
      })
    ).toMatchObject({ tokenAuth: 'hs256', audience: '*', subject: 'meet.jitsi' })
  })

  it('rejects half a token configuration', () => {
    expectError(resolveMeetingConfig({ JITSI_DOMAIN: 'meet.example.org', JITSI_APP_ID: 'petrios' }), MEETING_CONFIG_ERRORS.halfSelfHostedToken)
    const error = expectError(
      resolveMeetingConfig({ JITSI_DOMAIN: 'meet.example.org', JITSI_APP_SECRET: SECRET }),
      MEETING_CONFIG_ERRORS.halfSelfHostedToken
    )
    expect(error).not.toContain(SECRET)
  })

  it('rejects audience/subject overrides without app id and secret', () => {
    expectError(resolveMeetingConfig({ JITSI_DOMAIN: 'meet.example.org', JITSI_JWT_AUDIENCE: 'jitsi' }), MEETING_CONFIG_ERRORS.claimsWithoutToken)
    expectError(resolveMeetingConfig({ JITSI_DOMAIN: 'meet.example.org', JITSI_JWT_SUBJECT: 'meet.jitsi' }), MEETING_CONFIG_ERRORS.claimsWithoutToken)
  })

  it('rejects malformed claim values, naming the variable', () => {
    const base = { JITSI_DOMAIN: 'meet.example.org', JITSI_APP_ID: 'petrios', JITSI_APP_SECRET: SECRET }
    expectError(resolveMeetingConfig({ ...base, JITSI_APP_ID: 'bad id' }), 'JITSI_APP_ID')
    expectError(resolveMeetingConfig({ ...base, JITSI_JWT_AUDIENCE: 'a"b' }), 'JITSI_JWT_AUDIENCE')
    expectError(resolveMeetingConfig({ ...base, JITSI_JWT_SUBJECT: 'x'.repeat(254) }), 'JITSI_JWT_SUBJECT')
  })

  it.each([
    'https://meet.example.org',
    'meet.example.org/room',
    'meet.example.org; script-src *',
    'user@meet.example.org',
    'meet..example.org',
    '-meet.example.org',
    'meet.example.org:99999',
    'meet.example.org:0',
  ])('rejects the domain %j (no scheme, path, credentials or injection)', (domain) => {
    expectError(resolveMeetingConfig({ JITSI_DOMAIN: domain }), MEETING_CONFIG_ERRORS.domain)
  })
})

describe('JaaS mode', () => {
  it('resolves with all three variables, exposing no secret', () => {
    const config = jaas()
    expect(config).toEqual({
      ok: true, mode: 'jaas', domain: '8x8.vc', origin: 'https://8x8.vc', appId: APP_ID, tokenAuth: 'jaas-rs256',
    })
    expect(JSON.stringify(config)).not.toContain(bodyOf(PKCS8).slice(0, 40))
  })

  it('tolerates JITSI_DOMAIN=8x8.vc or meet.jit.si alongside JaaS', () => {
    expect(jaas({ JITSI_DOMAIN: '8x8.vc' })).toMatchObject({ ok: true, mode: 'jaas' })
    expect(jaas({ JITSI_DOMAIN: 'meet.jit.si' })).toMatchObject({ ok: true, mode: 'jaas' })
  })

  it('rejects a self-hosted JITSI_DOMAIN alongside JaaS', () => {
    expectError(jaas({ JITSI_DOMAIN: 'meet.example.org' }), 'JITSI_DOMAIN (meet.example.org) conflicts with JaaS')
  })

  it('rejects self-hosted token settings alongside JaaS', () => {
    for (const name of ['JITSI_APP_ID', 'JITSI_APP_SECRET', 'JITSI_JWT_AUDIENCE', 'JITSI_JWT_SUBJECT']) {
      expectError(jaas({ [name]: 'value' }), MEETING_CONFIG_ERRORS.jaasWithSelfHostedVars)
    }
  })

  it.each([
    [['JAAS_APP_ID'], 'missing: JAAS_APP_ID)'],
    [['JAAS_API_KEY_ID'], 'missing: JAAS_API_KEY_ID)'],
    [['JAAS_PRIVATE_KEY'], 'missing: JAAS_PRIVATE_KEY)'],
    [['JAAS_APP_ID', 'JAAS_PRIVATE_KEY'], 'missing: JAAS_APP_ID, JAAS_PRIVATE_KEY)'],
    [['JAAS_API_KEY_ID', 'JAAS_PRIVATE_KEY'], 'missing: JAAS_API_KEY_ID, JAAS_PRIVATE_KEY)'],
  ])('partial JaaS (without %j) is an error naming exactly the missing variables, never a fallback', (missing, text) => {
    const env: Record<string, string> = { JAAS_APP_ID: APP_ID, JAAS_API_KEY_ID: KEY_ID, JAAS_PRIVATE_KEY: PKCS8 }
    for (const name of missing) delete env[name]
    const error = expectError(resolveMeetingConfig(env), 'JaaS is partly configured')
    expect(error).toContain(text)
    expect(error).not.toContain(bodyOf(PKCS8).slice(0, 40))
  })

  it('rejects 8x8.vc as a domain without JaaS credentials', () => {
    expectError(resolveMeetingConfig({ JITSI_DOMAIN: '8x8.vc' }), MEETING_CONFIG_ERRORS.jaasDomainWithoutJaas)
    expectError(resolveMeetingConfig({ JITSI_DOMAIN: 'stage.8x8.vc' }), MEETING_CONFIG_ERRORS.jaasDomainWithoutJaas)
  })

  it('rejects an AppID that is not a JaaS AppID', () => {
    expectError(jaas({ JAAS_APP_ID: 'my-app', JAAS_API_KEY_ID: 'my-app/abc' }), MEETING_CONFIG_ERRORS.jaasAppId)
  })

  it('rejects a key id that does not start with the AppID', () => {
    expectError(jaas({ JAAS_API_KEY_ID: 'vpaas-magic-cookie-other/4f4910' }), MEETING_CONFIG_ERRORS.jaasKeyId)
    expectError(jaas({ JAAS_API_KEY_ID: '4f4910' }), MEETING_CONFIG_ERRORS.jaasKeyId)
    expectError(jaas({ JAAS_API_KEY_ID: `${APP_ID}/` }), MEETING_CONFIG_ERRORS.jaasKeyId)
    expectError(jaas({ JAAS_API_KEY_ID: `${APP_ID}/key id` }), MEETING_CONFIG_ERRORS.jaasKeyId)
  })

  it('accepts a PEM with literal \\n escapes (single-line env UIs)', () => {
    expect(jaas({ JAAS_PRIVATE_KEY: PKCS8.trim().replace(/\n/g, '\\n') })).toMatchObject({ ok: true, mode: 'jaas' })
  })

  it('accepts a quoted PEM, CRLF line endings and a PKCS#1 key', () => {
    expect(jaas({ JAAS_PRIVATE_KEY: `"${PKCS8.trim().replace(/\n/g, '\\n')}"` })).toMatchObject({ mode: 'jaas' })
    expect(jaas({ JAAS_PRIVATE_KEY: PKCS8.replace(/\n/g, '\r\n') })).toMatchObject({ mode: 'jaas' })
    expect(jaas({ JAAS_PRIVATE_KEY: PKCS1 })).toMatchObject({ mode: 'jaas' })
  })

  it.each([
    ['garbage', 'not a key at all'],
    ['a public key', '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----'],
    ['an EC key', EC_PKCS8],
    ['an encrypted key', ENCRYPTED],
    ['a truncated key', PKCS8.slice(0, 200) + '\n-----END PRIVATE KEY-----'],
    ['a key with a corrupted body', PKCS8.replace(/[A-Za-z0-9+/]{8}\n/, '!!!!!!!!\n')],
  ])('rejects %s without echoing it', (_label, key) => {
    const error = expectError(jaas({ JAAS_PRIVATE_KEY: key }), MEETING_CONFIG_ERRORS.jaasPrivateKey)
    expect(error).not.toContain('MII')
    expect(error).not.toContain(bodyOf(key).slice(0, 24) || 'unreachable-sentinel')
  })
})

describe('error messages never contain secrets', () => {
  it('holds across every error path', () => {
    const errors = [
      jaas({ JITSI_DOMAIN: 'meet.example.org' }),
      jaas({ JITSI_APP_SECRET: SECRET }),
      jaas({ JAAS_APP_ID: 'bad' }),
      jaas({ JAAS_API_KEY_ID: 'bad' }),
      jaas({ JAAS_PRIVATE_KEY: EC_PKCS8 }),
      resolveMeetingConfig({ JAAS_PRIVATE_KEY: PKCS8 }),
      resolveMeetingConfig({ JITSI_DOMAIN: 'meet.example.org', JITSI_APP_SECRET: SECRET }),
      resolveMeetingConfig({ JITSI_APP_SECRET: SECRET }),
    ].map((config) => expectError(config))
    for (const error of errors) {
      expect(error).not.toContain(SECRET)
      expect(error).not.toContain('MII')
      expect(error).not.toContain(bodyOf(PKCS8).slice(0, 24))
      expect(error).not.toContain(bodyOf(EC_PKCS8).slice(0, 24))
    }
  })
})

describe('normalizePrivateKeyPem', () => {
  it('returns a canonical 64-column PEM and the format', () => {
    const fromEscaped = normalizePrivateKeyPem(`'${PKCS8.trim().replace(/\n/g, '\\n')}'`)
    expect(fromEscaped?.format).toBe('pkcs8')
    expect(fromEscaped?.pem.startsWith('-----BEGIN PRIVATE KEY-----\n')).toBe(true)
    expect(fromEscaped?.pem.trim().endsWith('-----END PRIVATE KEY-----')).toBe(true)
    expect(bodyOf(fromEscaped!.pem)).toBe(bodyOf(PKCS8))
    for (const line of fromEscaped!.pem.split('\n').slice(1, -2)) expect(line.length).toBeLessThanOrEqual(64)

    expect(normalizePrivateKeyPem(PKCS1)?.format).toBe('pkcs1')
    expect(normalizePrivateKeyPem(PKCS1.replace(/\n/g, ' '))?.format).toBe('pkcs1')
  })

  it('returns null without a well-formed RSA private key block', () => {
    expect(normalizePrivateKeyPem('')).toBeNull()
    expect(normalizePrivateKeyPem(bodyOf(PKCS8))).toBeNull()
    expect(normalizePrivateKeyPem(ENCRYPTED)).toBeNull()
    expect(normalizePrivateKeyPem(PKCS1.replace('END RSA PRIVATE KEY', 'END PRIVATE KEY'))).toBeNull()
  })
})

describe('getMeetingConfig and meetingEmbedOrigin', () => {
  it('logs a configuration error once per distinct environment, naming variables only', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const name of ['JITSI_DOMAIN', 'NEXT_PUBLIC_JITSI_DOMAIN', 'JAAS_APP_ID', 'JAAS_API_KEY_ID', 'JAAS_PRIVATE_KEY', 'JITSI_APP_ID', 'JITSI_APP_SECRET', 'JITSI_JWT_AUDIENCE', 'JITSI_JWT_SUBJECT']) {
      vi.stubEnv(name, '')
    }
    vi.stubEnv('JAAS_APP_ID', APP_ID)
    vi.stubEnv('JAAS_PRIVATE_KEY', PKCS8)
    for (let i = 0; i < 5; i += 1) expect(getMeetingConfig()).toMatchObject({ ok: false })
    expect(error).toHaveBeenCalledTimes(1)
    const logged = error.mock.calls.flat().join(' ')
    expect(logged).toContain('[petrios-meet] configuration error:')
    expect(logged).toContain('JAAS_API_KEY_ID')
    expect(logged).not.toContain(bodyOf(PKCS8).slice(0, 40))

    // A different bad environment logs again; a fixed one logs nothing.
    vi.stubEnv('JITSI_DOMAIN', 'meet.example.org')
    expect(getMeetingConfig()).toMatchObject({ ok: false })
    expect(error).toHaveBeenCalledTimes(2)
    vi.stubEnv('JITSI_DOMAIN', '')
    vi.stubEnv('JAAS_API_KEY_ID', KEY_ID)
    expect(getMeetingConfig()).toMatchObject({ mode: 'jaas' })
    expect(error).toHaveBeenCalledTimes(2)
  })

  it('reads process.env at call time', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const name of ['JITSI_DOMAIN', 'NEXT_PUBLIC_JITSI_DOMAIN', 'JAAS_APP_ID', 'JAAS_API_KEY_ID', 'JAAS_PRIVATE_KEY', 'JITSI_APP_ID', 'JITSI_APP_SECRET', 'JITSI_JWT_AUDIENCE', 'JITSI_JWT_SUBJECT']) {
      vi.stubEnv(name, '')
    }
    expect(getMeetingConfig()).toMatchObject({ mode: 'public' })
    vi.stubEnv('JITSI_DOMAIN', 'meet.example.org')
    expect(getMeetingConfig()).toMatchObject({ mode: 'self-hosted', domain: 'meet.example.org' })
    vi.stubEnv('JAAS_APP_ID', APP_ID)
    expect(getMeetingConfig()).toMatchObject({ ok: false })
    vi.stubEnv('JITSI_DOMAIN', '')
    vi.stubEnv('JAAS_API_KEY_ID', KEY_ID)
    vi.stubEnv('JAAS_PRIVATE_KEY', PKCS8)
    expect(getMeetingConfig()).toMatchObject({ mode: 'jaas' })
  })

  it('delegates an origin only for embedded modes', () => {
    expect(meetingEmbedOrigin(jaas())).toBe('https://8x8.vc')
    expect(meetingEmbedOrigin(resolveMeetingConfig({ JITSI_DOMAIN: 'meet.example.org:8443' }))).toBe('https://meet.example.org:8443')
    expect(
      meetingEmbedOrigin(resolveMeetingConfig({ JITSI_DOMAIN: 'meet.example.org', JITSI_APP_ID: 'p', JITSI_APP_SECRET: SECRET }))
    ).toBe('https://meet.example.org')
    expect(meetingEmbedOrigin(resolveMeetingConfig({}))).toBeNull()
    expect(meetingEmbedOrigin(resolveMeetingConfig({ JAAS_APP_ID: APP_ID }))).toBeNull()
  })
})
