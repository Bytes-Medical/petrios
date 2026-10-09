import { generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  describeMeetingProvider,
  detectHostingProvider,
  getComplianceConfig,
  meetingRegisterEntry,
} from './compliance'

const ENV = [
  'LLM_PROVIDER',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'TTS_PROVIDER',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
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
  for (const name of ENV) vi.stubEnv(name, '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('getComplianceConfig AI provider disclosure', () => {
  it('names Anthropic, and exposes its kind for provider-specific notices', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant')
    expect(getComplianceConfig()).toMatchObject({
      aiEnabled: true,
      aiProvider: 'Anthropic API (Claude)',
      aiProviderKind: 'anthropic',
    })
  })

  it('keeps an OpenAI-only deployment labelled as OpenAI', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai')
    expect(getComplianceConfig()).toMatchObject({
      aiEnabled: true,
      aiProvider: 'OpenAI API',
      aiProviderKind: 'openai',
    })
  })

  it('reports AI as disabled (no provider kind) when the provider choice is ambiguous', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant')
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai')
    vi.stubEnv('OPENAI_BASE_URL', 'https://gateway.internal/v1')
    expect(getComplianceConfig()).toMatchObject({
      aiEnabled: false,
      aiProvider: 'Disabled',
      aiProviderKind: null,
    })
  })

  it('labels an operator gateway for either provider', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://llm.internal')
    expect(getComplianceConfig()).toMatchObject({
      aiProvider: 'Operator-configured Anthropic-compatible endpoint',
      aiProviderKind: 'anthropic',
    })
  })
})

describe('getComplianceConfig speech provider disclosure', () => {
  it('reports OpenAI speech even when Claude is the LLM (the Render cutover shape)', () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant')
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai')
    expect(getComplianceConfig()).toMatchObject({
      aiProviderKind: 'anthropic',
      speechEnabled: true,
      speechProvider: 'OpenAI API',
      speechProviderKind: 'openai',
    })
  })

  it('names ElevenLabs and has no speech kind when speech is incomplete', () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'el-key')
    vi.stubEnv('ELEVENLABS_VOICE_ID', 'voice')
    expect(getComplianceConfig().speechProviderKind).toBe('elevenlabs')
    vi.stubEnv('ELEVENLABS_VOICE_ID', '')
    expect(getComplianceConfig()).toMatchObject({ speechEnabled: false, speechProviderKind: null })
  })
})

describe('detectHostingProvider', () => {
  it('keeps the platform flags first', () => {
    expect(detectHostingProvider({ RENDER: 'true' }, undefined)).toBe('Render')
    expect(detectHostingProvider({ VERCEL: '1' }, undefined)).toBe('Vercel')
    expect(detectHostingProvider({ RAILWAY_PROJECT_ID: 'p' }, undefined)).toBe('Railway')
  })

  it('names Cloudflare Workers from the wrangler var or the Workers runtime', () => {
    expect(detectHostingProvider({ HOSTING_PROVIDER: 'cloudflare-workers' }, 'Node.js/24')).toBe('Cloudflare Workers')
    expect(detectHostingProvider({}, 'Cloudflare-Workers')).toBe('Cloudflare Workers')
  })

  it('falls back to an operator-managed host', () => {
    expect(detectHostingProvider({}, 'Node.js/24')).toBe('Operator-managed application host')
    expect(detectHostingProvider({ HOSTING_PROVIDER: 'something-else' }, undefined)).toBe('Operator-managed application host')
  })
})

// Throwaway test-only RSA key so a JaaS configuration is complete and valid.
const { privateKey: JAAS_TEST_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
const JAAS_APP_ID = 'vpaas-magic-cookie-0123abcd'
const SELF_HOSTED_SECRET = 'self-hosted-shared-secret-value'

/** Every meeting field of the public disclosure, rendered as one string. */
function meetingDisclosureText() {
  const config = getComplianceConfig()
  return JSON.stringify({
    provider: config.meetingProvider,
    kind: config.meetingProviderKind,
    error: config.meetingConfigurationError,
    pass: config.meetingRoomPass,
  })
}

describe('getComplianceConfig meeting provider disclosure', () => {
  it('names meet.jit.si, opened in a new tab, when nothing is configured', () => {
    expect(getComplianceConfig()).toMatchObject({
      meetingProvider: 'Jitsi Meet (meet.jit.si), opened in a new tab',
      meetingProviderKind: 'public',
      meetingConfigurationError: false,
      meetingRoomPass: false,
    })
  })

  it('names 8x8 JaaS as the provider when all three JaaS variables are set', () => {
    vi.stubEnv('JAAS_APP_ID', JAAS_APP_ID)
    vi.stubEnv('JAAS_API_KEY_ID', `${JAAS_APP_ID}/4f5e6d`)
    vi.stubEnv('JAAS_PRIVATE_KEY', JAAS_TEST_KEY)
    expect(getComplianceConfig()).toMatchObject({
      meetingProvider: '8x8 Jitsi as a Service (JaaS, 8x8.vc)',
      meetingProviderKind: 'jaas',
      meetingConfigurationError: false,
      meetingRoomPass: true,
    })
    const text = meetingDisclosureText()
    expect(text).not.toContain('PRIVATE KEY')
    expect(text).not.toContain(JAAS_TEST_KEY.split('\n')[1])
  })

  it('names the operator Jitsi domain, with and without room passes', () => {
    vi.stubEnv('JITSI_DOMAIN', 'video.trust.example')
    expect(getComplianceConfig()).toMatchObject({
      meetingProvider: 'Operator-configured Jitsi service (video.trust.example)',
      meetingProviderKind: 'self-hosted',
      meetingRoomPass: false,
    })
    vi.stubEnv('JITSI_APP_ID', 'petrios')
    vi.stubEnv('JITSI_APP_SECRET', SELF_HOSTED_SECRET)
    expect(getComplianceConfig()).toMatchObject({
      meetingProvider: 'Operator-configured Jitsi service (video.trust.example)',
      meetingProviderKind: 'self-hosted',
      meetingRoomPass: true,
    })
    expect(meetingDisclosureText()).not.toContain(SELF_HOSTED_SECRET)
  })

  it('reports partial JaaS as unavailable instead of falling back to meet.jit.si', () => {
    vi.stubEnv('JAAS_APP_ID', JAAS_APP_ID)
    vi.stubEnv('JAAS_PRIVATE_KEY', JAAS_TEST_KEY)
    expect(getComplianceConfig()).toMatchObject({
      meetingProvider: 'Video rooms unavailable (incomplete meeting configuration)',
      meetingProviderKind: null,
      meetingConfigurationError: true,
      meetingRoomPass: false,
    })
    const text = meetingDisclosureText()
    expect(text).not.toContain('meet.jit.si')
    expect(text).not.toContain('PRIVATE KEY')
  })
})

describe('describeMeetingProvider', () => {
  it('never repeats the configuration error message, which names variables', () => {
    const disclosure = describeMeetingProvider({
      ok: false,
      mode: 'unavailable',
      error: 'Set both JITSI_APP_ID and JITSI_APP_SECRET for token-protected rooms, or neither.',
    })
    expect(JSON.stringify(disclosure)).not.toContain('JITSI_APP_SECRET')
    expect(disclosure.meetingConfigurationError).toBe(true)
  })

  it('keeps a self-hosted port in the label so the register names the exact service', () => {
    expect(
      describeMeetingProvider({
        ok: true,
        mode: 'self-hosted',
        domain: 'video.trust.example:8443',
        origin: 'https://video.trust.example:8443',
        tokenAuth: 'none',
      }).meetingProvider
    ).toBe('Operator-configured Jitsi service (video.trust.example:8443)')
  })
})

describe('meetingRegisterEntry', () => {
  const JAAS = describeMeetingProvider({
    ok: true,
    mode: 'jaas',
    domain: '8x8.vc',
    origin: 'https://8x8.vc',
    appId: JAAS_APP_ID,
    tokenAuth: 'jaas-rs256',
  })
  const SELF_HOSTED_JWT = describeMeetingProvider({
    ok: true,
    mode: 'self-hosted',
    domain: 'video.trust.example',
    origin: 'https://video.trust.example',
    tokenAuth: 'hs256',
    appId: 'petrios',
    audience: 'jitsi',
    subject: 'video.trust.example',
  })
  const SELF_HOSTED_OPEN = describeMeetingProvider({
    ok: true,
    mode: 'self-hosted',
    domain: 'video.trust.example',
    origin: 'https://video.trust.example',
    tokenAuth: 'none',
  })
  const PUBLIC = describeMeetingProvider({
    ok: true,
    mode: 'public',
    domain: 'meet.jit.si',
    origin: 'https://meet.jit.si',
    tokenAuth: 'none',
  })
  const UNAVAILABLE = describeMeetingProvider({ ok: false, mode: 'unavailable', error: 'x' })

  it('never claims an email address is shared, in any mode', () => {
    for (const disclosure of [JAAS, SELF_HOSTED_JWT, SELF_HOSTED_OPEN, PUBLIC, UNAVAILABLE]) {
      const { data } = meetingRegisterEntry(disclosure)
      // The only permitted mention is the explicit denial.
      expect(data.replaceAll('never the email address', '')).not.toMatch(/e-?mail/i)
    }
  })

  it('discloses the room-pass contents and pseudonymous id only where Petrios mints passes', () => {
    expect(meetingRegisterEntry(JAAS).data).toContain('per-session pseudonymous participant id')
    expect(meetingRegisterEntry(SELF_HOSTED_JWT).data).toContain('per-session pseudonymous participant id')
    expect(meetingRegisterEntry(SELF_HOSTED_OPEN).data).not.toContain('pseudonymous')
    expect(meetingRegisterEntry(SELF_HOSTED_OPEN).data).toContain('editable before joining')
  })

  it('states feature switches as enforced only for JaaS', () => {
    expect(meetingRegisterEntry(JAAS).data).toContain('Room passes turn off recording, live streaming, transcription')
    expect(meetingRegisterEntry(SELF_HOSTED_JWT).data).toContain('decides whether it enforces that')
  })

  it('says Petrios sends nothing to meet.jit.si in public mode', () => {
    const entry = meetingRegisterEntry(PUBLIC)
    expect(entry.data.startsWith('Petrios sends nothing to meet.jit.si.')).toBe(true)
    expect(entry.status).toBe('Used only when a user opens the room link')
    expect(entry.tone).toBeUndefined()
  })

  it('flags an incomplete configuration for operator attention and shares nothing', () => {
    expect(meetingRegisterEntry(UNAVAILABLE)).toMatchObject({
      status: 'Configuration incomplete',
      tone: 'attention',
    })
    expect(meetingRegisterEntry(UNAVAILABLE).data).toMatch(/^None while/)
  })
})
