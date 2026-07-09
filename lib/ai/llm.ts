/**
 * Server-side LLM client (OpenAI Chat Completions). The single entry point
 * for AI in the app — nothing else may call the OpenAI API except the Bytes
 * Ops tool-use loop in lib/ops/agent-loop.ts, which needs raw tool-call
 * messages.
 *
 * We talk to the REST endpoint directly with fetch rather than pulling in
 * the `openai` SDK — same reasoning as lib/email.ts: one fewer dependency
 * and the payload is trivial.
 *
 * Config (server-only env):
 *   OPENAI_API_KEY — required; without it every feature degrades gracefully
 *   OPENAI_MODEL   — optional override; defaults to gpt-5.5
 */

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'

export const LLM_MODEL = process.env.OPENAI_MODEL || 'gpt-5.5'

export function isLlmConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
}

export interface LlmResult {
  text: string | null
  usage: LlmUsage
  model: string
}

/**
 * One system+user completion, reporting token usage and the model that
 * served the request (the Bytes Ops gateway records both in its audit
 * trail). Returns null when no key is configured; throws on API errors and
 * on refusals so callers can degrade per-item.
 */
export async function askLlmWithUsage(input: {
  system: string
  prompt: string
  maxTokens?: number
  effort?: 'low' | 'medium' | 'high'
  /** Constrain the reply to a JSON object (OpenAI json_object mode). */
  jsonMode?: boolean
}): Promise<LlmResult | null> {
  if (!isLlmConfigured()) return null

  const response = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_completion_tokens: input.maxTokens ?? 8192,
      ...(input.effort ? { reasoning_effort: input.effort } : {}),
      ...(input.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.prompt },
      ],
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`OpenAI request failed (${response.status}): ${detail.slice(0, 300)}`)
  }

  const data = (await response.json()) as {
    model?: string
    choices?: {
      message?: { content?: string | null; refusal?: string | null }
      finish_reason?: string
    }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }

  const choice = data.choices?.[0]
  if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') {
    throw new Error('The AI assistant declined this request.')
  }

  return {
    text: choice?.message?.content || null,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
    model: data.model ?? LLM_MODEL,
  }
}

export async function askLlm(input: {
  system: string
  prompt: string
  maxTokens?: number
  effort?: 'low' | 'medium' | 'high'
}): Promise<string | null> {
  const result = await askLlmWithUsage(input)
  return result?.text ?? null
}
