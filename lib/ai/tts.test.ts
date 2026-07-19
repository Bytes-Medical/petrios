import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTtsConfiguration, synthesizeSpeech } from './tts'

const TTS_ENV = [
  'TTS_PROVIDER',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_TTS_MODEL',
  'OPENAI_TTS_VOICE',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
  'ELEVENLABS_MODEL_ID',
] as const

beforeEach(() => {
  for (const name of TTS_ENV) vi.stubEnv(name, '')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('TTS provider configuration', () => {
  it('preserves OpenAI as the default provider', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-secret')

    expect(getTtsConfiguration()).toEqual({
      provider: 'openai',
      configured: true,
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      configurationError: null,
    })
  })

  it('automatically selects ElevenLabs when its credentials are declared', () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'eleven-secret')
    vi.stubEnv('ELEVENLABS_VOICE_ID', 'voice-123')

    expect(getTtsConfiguration()).toEqual({
      provider: 'elevenlabs',
      configured: true,
      model: 'eleven_multilingual_v2',
      voice: 'voice-123',
      configurationError: null,
    })
  })

  it('reports partial ElevenLabs configuration without exposing a secret', () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'eleven-secret')

    expect(getTtsConfiguration()).toEqual({
      provider: 'elevenlabs',
      configured: false,
      model: 'eleven_multilingual_v2',
      voice: null,
      configurationError: 'ElevenLabs speech requires ELEVENLABS_VOICE_ID',
    })
  })

  it('allows an explicit OpenAI pin when both providers are configured', () => {
    vi.stubEnv('TTS_PROVIDER', 'openai')
    vi.stubEnv('OPENAI_API_KEY', 'openai-secret')
    vi.stubEnv('ELEVENLABS_API_KEY', 'eleven-secret')
    vi.stubEnv('ELEVENLABS_VOICE_ID', 'voice-123')

    expect(getTtsConfiguration().provider).toBe('openai')
  })

  it('rejects an unsupported explicit provider without selecting a fallback', () => {
    vi.stubEnv('TTS_PROVIDER', 'other-service')
    vi.stubEnv('OPENAI_API_KEY', 'openai-secret')

    expect(getTtsConfiguration()).toEqual({
      provider: null,
      configured: false,
      model: null,
      voice: null,
      configurationError: 'TTS_PROVIDER must be either openai or elevenlabs',
    })
  })
})

describe('speech synthesis', () => {
  it('calls OpenAI with the configured compatible endpoint and returns metadata', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-secret')
    vi.stubEnv('OPENAI_BASE_URL', 'https://speech.internal/v1/')
    vi.stubEnv('OPENAI_TTS_MODEL', 'custom-speech')
    vi.stubEnv('OPENAI_TTS_VOICE', 'marin')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(synthesizeSpeech({ text: 'Clinical teaching recap' })).resolves.toEqual({
      audio: Buffer.from([1, 2, 3]),
      provider: 'openai',
      model: 'custom-speech',
      voice: 'marin',
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://speech.internal/v1/audio/speech')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer openai-secret' })
    expect(JSON.parse(init.body)).toEqual({
      model: 'custom-speech',
      voice: 'marin',
      input: 'Clinical teaching recap',
      response_format: 'mp3',
    })
  })

  it('calls ElevenLabs with its voice endpoint and returns provider metadata', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'eleven-secret')
    vi.stubEnv('ELEVENLABS_VOICE_ID', 'voice/with spaces')
    vi.stubEnv('ELEVENLABS_MODEL_ID', 'eleven_flash_v2_5')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([4, 5, 6]), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(synthesizeSpeech({ text: 'Five minute recap' })).resolves.toEqual({
      audio: Buffer.from([4, 5, 6]),
      provider: 'elevenlabs',
      model: 'eleven_flash_v2_5',
      voice: 'voice/with spaces',
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice%2Fwith%20spaces?output_format=mp3_44100_128'
    )
    expect(init.headers).toMatchObject({ 'xi-api-key': 'eleven-secret' })
    expect(JSON.parse(init.body)).toEqual({
      text: 'Five minute recap',
      model_id: 'eleven_flash_v2_5',
    })
  })

  it('returns null without a configured provider and does not call fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(synthesizeSpeech({ text: 'Recap' })).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a partial ElevenLabs setup before making a request', async () => {
    vi.stubEnv('ELEVENLABS_VOICE_ID', 'voice-123')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(synthesizeSpeech({ text: 'Recap' }))
      .rejects.toThrow('ElevenLabs speech requires ELEVENLABS_API_KEY')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces an ElevenLabs provider failure instead of storing false success', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'eleven-secret')
    vi.stubEnv('ELEVENLABS_VOICE_ID', 'voice-123')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('invalid credentials', { status: 401 })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(synthesizeSpeech({ text: 'Recap' }))
      .rejects.toThrow('ElevenLabs speech request failed (401): invalid credentials')
  })
})
