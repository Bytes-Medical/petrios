import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { detectHostingProvider, getComplianceConfig } from './compliance'

const ENV = [
  'LLM_PROVIDER',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'TTS_PROVIDER',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
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
