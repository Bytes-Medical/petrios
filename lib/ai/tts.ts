/**
 * Server-side text-to-speech client (OpenAI audio/speech). The single
 * sanctioned caller of the speech endpoint — the audio sibling of llm.ts's
 * chat-completions doctrine (documented in spec/06). Nothing else may call
 * the TTS API.
 *
 * Config (server-only env, shares OPENAI_API_KEY / OPENAI_BASE_URL):
 *   OPENAI_TTS_MODEL — optional override; defaults to gpt-4o-mini-tts
 *   OPENAI_TTS_VOICE — optional override; defaults to alloy
 *
 * Degradation: returns null when no API key is configured, and null (with a
 * warning) when the endpoint 404s — OpenAI-compatible local models often
 * ship chat completions without a speech endpoint, and audio recaps simply
 * stay unavailable there.
 */

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
const TTS_ENDPOINT = `${OPENAI_BASE_URL}/audio/speech`

export const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts'
export const TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'alloy'

export function isTtsConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY
}

/** Synthesize MP3 speech for the given text. Null when unavailable. */
export async function synthesizeSpeech(input: {
  text: string
  model?: string
  voice?: string
}): Promise<Buffer | null> {
  if (!isTtsConfigured()) return null

  const response = await fetch(TTS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: input.model || TTS_MODEL,
      voice: input.voice || TTS_VOICE,
      input: input.text,
      response_format: 'mp3',
    }),
  })

  if (response.status === 404) {
    console.warn('[tts] Speech endpoint not available on this OPENAI_BASE_URL — audio recaps disabled')
    return null
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`TTS request failed (${response.status}): ${detail.slice(0, 300)}`)
  }

  return Buffer.from(await response.arrayBuffer())
}
