/**
 * Server-side text-to-speech boundary. This is the only sanctioned caller of
 * speech providers; Audio Recap actions receive an MP3 plus the exact provider,
 * model, and voice metadata that must be persisted with it.
 *
 * Provider selection:
 *   - TTS_PROVIDER=openai|elevenlabs explicitly pins a provider.
 *   - When unset, declaring either ElevenLabs credential selects ElevenLabs;
 *     otherwise OpenAI preserves the historical default.
 *
 * OpenAI config (shares the LLM key/base URL):
 *   OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_TTS_MODEL, OPENAI_TTS_VOICE
 *
 * ElevenLabs config:
 *   ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL_ID
 */

export type TtsProvider = 'openai' | 'elevenlabs'

export interface TtsConfiguration {
  provider: TtsProvider | null
  configured: boolean
  model: string | null
  voice: string | null
  configurationError: string | null
}

export interface SynthesizedSpeech {
  audio: Buffer
  provider: TtsProvider
  model: string
  voice: string
}

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini-tts'
const DEFAULT_OPENAI_VOICE = 'alloy'
const DEFAULT_ELEVENLABS_MODEL = 'eleven_multilingual_v2'
const ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128'

function optional(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim()
  return value ? value : null
}

/** Public-safe configuration summary: never returns API keys or internal URLs. */
export function getTtsConfiguration(
  env: NodeJS.ProcessEnv = process.env
): TtsConfiguration {
  const requested = optional(env, 'TTS_PROVIDER')?.toLowerCase() ?? null
  if (requested && requested !== 'openai' && requested !== 'elevenlabs') {
    return {
      provider: null,
      configured: false,
      model: null,
      voice: null,
      configurationError: 'TTS_PROVIDER must be either openai or elevenlabs',
    }
  }

  const hasAnyElevenLabsConfig = Boolean(
    optional(env, 'ELEVENLABS_API_KEY') || optional(env, 'ELEVENLABS_VOICE_ID')
  )
  const provider: TtsProvider = requested === 'elevenlabs'
    ? 'elevenlabs'
    : requested === 'openai'
      ? 'openai'
      : hasAnyElevenLabsConfig
        ? 'elevenlabs'
        : 'openai'

  if (provider === 'elevenlabs') {
    const apiKey = optional(env, 'ELEVENLABS_API_KEY')
    const voice = optional(env, 'ELEVENLABS_VOICE_ID')
    const missing = [
      !apiKey ? 'ELEVENLABS_API_KEY' : null,
      !voice ? 'ELEVENLABS_VOICE_ID' : null,
    ].filter((value): value is string => Boolean(value))

    return {
      provider,
      configured: missing.length === 0,
      model: optional(env, 'ELEVENLABS_MODEL_ID') || DEFAULT_ELEVENLABS_MODEL,
      voice,
      configurationError: missing.length > 0
        ? `ElevenLabs speech requires ${missing.join(' and ')}`
        : null,
    }
  }

  return {
    provider,
    configured: Boolean(optional(env, 'OPENAI_API_KEY')),
    model: optional(env, 'OPENAI_TTS_MODEL') || DEFAULT_OPENAI_MODEL,
    voice: optional(env, 'OPENAI_TTS_VOICE') || DEFAULT_OPENAI_VOICE,
    configurationError: null,
  }
}

export function isTtsConfigured(): boolean {
  return getTtsConfiguration().configured
}

async function providerError(response: Response, provider: string): Promise<Error> {
  const detail = (await response.text().catch(() => '')).trim().slice(0, 300)
  return new Error(
    `${provider} speech request failed (${response.status})${detail ? `: ${detail}` : ''}`
  )
}

async function synthesizeWithOpenAi(input: {
  text: string
  model: string
  voice: string
}): Promise<Buffer | null> {
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: input.model,
      voice: input.voice,
      input: input.text,
      response_format: 'mp3',
    }),
  })

  if (response.status === 404) {
    console.warn('[tts] OpenAI-compatible speech endpoint is unavailable')
    return null
  }
  if (!response.ok) throw await providerError(response, 'OpenAI')
  return Buffer.from(await response.arrayBuffer())
}

async function synthesizeWithElevenLabs(input: {
  text: string
  model: string
  voice: string
}): Promise<Buffer> {
  const endpoint = new URL(
    `/v1/text-to-speech/${encodeURIComponent(input.voice)}`,
    'https://api.elevenlabs.io'
  )
  endpoint.searchParams.set('output_format', ELEVENLABS_OUTPUT_FORMAT)

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
    },
    body: JSON.stringify({
      text: input.text,
      model_id: input.model,
    }),
  })

  if (!response.ok) throw await providerError(response, 'ElevenLabs')
  return Buffer.from(await response.arrayBuffer())
}

/** Synthesize MP3 speech. Returns null only when the selected provider is absent. */
export async function synthesizeSpeech(input: {
  text: string
}): Promise<SynthesizedSpeech | null> {
  if (!input.text.trim()) throw new Error('Speech text cannot be empty')

  const config = getTtsConfiguration()
  if (config.configurationError) throw new Error(config.configurationError)
  if (!config.configured || !config.provider || !config.model || !config.voice) return null

  const audio = config.provider === 'elevenlabs'
    ? await synthesizeWithElevenLabs({
        text: input.text,
        model: config.model,
        voice: config.voice,
      })
    : await synthesizeWithOpenAi({
        text: input.text,
        model: config.model,
        voice: config.voice,
      })

  return audio
    ? {
        audio,
        provider: config.provider,
        model: config.model,
        voice: config.voice,
      }
    : null
}
