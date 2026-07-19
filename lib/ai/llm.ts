/**
 * Server-side LLM client (OpenAI Chat Completions). The single entry point
 * for AI in the app — nothing else may call the OpenAI API except the Petrios
 * Ops tool-use loop in lib/ops/agent-loop.ts, which needs raw tool-call
 * messages.
 *
 * We talk to the REST endpoint directly with fetch rather than pulling in
 * the `openai` SDK — same reasoning as lib/email.ts: one fewer dependency
 * and the payload is trivial.
 *
 * Config (server-only env):
 *   OPENAI_API_KEY  — required; without it every feature degrades gracefully
 *   OPENAI_MODEL    — optional override; defaults to gpt-5.5
 *   OPENAI_BASE_URL — optional OpenAI-compatible endpoint base (default
 *     https://api.openai.com/v1). Point at Azure OpenAI, a gateway, or a
 *     locally hosted model so AI traffic never leaves your network — the
 *     data-governance path for self-hosted NHS deployments.
 */

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
const OPENAI_ENDPOINT = `${OPENAI_BASE_URL}/chat/completions`
const OPENAI_RESPONSES_ENDPOINT = `${OPENAI_BASE_URL}/responses`

export const LLM_MODEL = process.env.OPENAI_MODEL || 'gpt-5.5'

export function isLlmConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY
}

/**
 * Shared POST to the chat-completions endpoint (auth, error shaping). Also
 * used by the Petrios Ops tool-use loop — the one sanctioned caller outside
 * this module.
 */
export async function postOpenAiChatCompletion(
  body: Record<string, unknown>
): Promise<unknown> {
  const response = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`OpenAI request failed (${response.status}): ${detail.slice(0, 300)}`)
  }

  return response.json()
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
}

export interface LlmResult {
  text: string | null
  usage: LlmUsage
  model: string
  /** Public web sources returned by a provider-hosted search, if requested. */
  sources: LlmSource[]
}

export interface LlmSource {
  url: string
  title: string
}

export interface LlmWebSearchOptions {
  /** Authoritative domains the hosted search is permitted to consult. */
  allowedDomains: string[]
  searchContextSize?: 'low' | 'medium' | 'high'
  userLocation?: {
    country?: string
    city?: string
    region?: string
    timezone?: string
  }
  /** Require the model to use the configured search tool at least once. */
  required?: boolean
}

export interface LlmFileInput {
  filename: string
  mimeType: string
  bytes: Uint8Array
  /** Stored integrity hash used by the Ops audit fingerprint. */
  sha256: string
}

interface ResponsesOutputItem {
  type?: string
  content?: Array<{
    type?: string
    text?: string
    refusal?: string
    annotations?: Array<{
      type?: string
      url?: string
      title?: string
    }>
  }>
  action?: {
    sources?: Array<{ url?: string; title?: string }>
  }
}

function responseOutputText(data: {
  output?: Array<{
    type?: string
    content?: ResponsesOutputItem['content']
  }>
}): string | null {
  const parts = (data.output ?? []).flatMap((item) => item.content ?? [])
  const refusal = parts.find((part) => part.type === 'refusal')?.refusal
  if (refusal) throw new Error('The AI assistant declined this request.')
  const text = parts
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text!.trim())
    .filter(Boolean)
    .join('\n')
  return text || null
}

function normaliseSource(source: { url?: string; title?: string }): LlmSource | null {
  if (!source.url) return null
  try {
    const url = new URL(source.url)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return {
      url: url.toString(),
      title: source.title?.trim() || url.hostname,
    }
  } catch {
    return null
  }
}

/** Collect visible citations and the complete consulted-source list. */
function responseSources(output: ResponsesOutputItem[] | undefined): LlmSource[] {
  const candidates = (output ?? []).flatMap((item) => [
    ...(item.action?.sources ?? []),
    ...(item.content ?? []).flatMap((part) =>
      (part.annotations ?? [])
        .filter((annotation) => annotation.type === 'url_citation')
        .map((annotation) => ({ url: annotation.url, title: annotation.title }))
    ),
  ])
  const sources = new Map<string, LlmSource>()
  for (const candidate of candidates) {
    const source = normaliseSource(candidate)
    if (source && !sources.has(source.url)) sources.set(source.url, source)
    if (sources.size >= 20) break
  }
  return [...sources.values()]
}

/**
 * Responses API path for private document inputs. This stays separate from
 * the ordinary Chat Completions adapter because `input_file` is a multimodal
 * request shape and compatible custom endpoints may support chat without
 * supporting file-backed Responses calls.
 */
export async function askLlmWithFileInputs(input: {
  system: string
  prompt: string
  files: LlmFileInput[]
  maxTokens?: number
  webSearch?: LlmWebSearchOptions
}): Promise<LlmResult | null> {
  if (!isLlmConfigured()) return null
  if (input.files.length === 0) throw new Error('At least one document is required')

  const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      instructions: input.system,
      max_output_tokens: input.maxTokens ?? 8192,
      ...(input.webSearch ? {
        tools: [{
          type: 'web_search',
          search_context_size: input.webSearch.searchContextSize ?? 'medium',
          external_web_access: true,
          filters: { allowed_domains: input.webSearch.allowedDomains },
          ...(input.webSearch.userLocation ? {
            user_location: { type: 'approximate', ...input.webSearch.userLocation },
          } : {}),
        }],
        ...(input.webSearch.required ? { tool_choice: 'required' } : {}),
        include: ['web_search_call.action.sources'],
      } : {}),
      input: [{
        role: 'user',
        content: [
          ...input.files.map((file) => ({
            type: 'input_file',
            filename: file.filename,
            file_data: `data:${file.mimeType};base64,${Buffer.from(file.bytes).toString('base64')}`,
            ...(file.mimeType === 'application/pdf' ? { detail: 'auto' } : {}),
          })),
          { type: 'input_text', text: input.prompt },
        ],
      }],
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `OpenAI Responses file-input request failed (${response.status}): ${detail.slice(0, 300)}`
    )
  }

  const data = (await response.json()) as {
    model?: string
    error?: { message?: string } | null
    incomplete_details?: { reason?: string } | null
    output?: ResponsesOutputItem[]
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  if (data.error?.message) throw new Error(`OpenAI Responses error: ${data.error.message}`)
  if (data.incomplete_details?.reason) {
    throw new Error(`OpenAI response was incomplete: ${data.incomplete_details.reason}`)
  }
  const text = responseOutputText(data)

  return {
    text,
    usage: {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    },
    model: data.model ?? LLM_MODEL,
    sources: responseSources(data.output),
  }
}

/**
 * One system+user completion, reporting token usage and the model that
 * served the request (the Petrios Ops gateway records both in its audit
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

  const data = (await postOpenAiChatCompletion({
    model: LLM_MODEL,
    max_completion_tokens: input.maxTokens ?? 8192,
    ...(input.effort ? { reasoning_effort: input.effort } : {}),
    ...(input.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.prompt },
    ],
  })) as {
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
    sources: [],
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
