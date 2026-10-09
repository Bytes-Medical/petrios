import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaFallbacksParam,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { AnthropicBeta } from '@anthropic-ai/sdk/resources/beta/beta'

/**
 * LLM provider selection and the shared Anthropic client. Server-only: this
 * module reads API keys from the environment and must never reach a client
 * bundle. Only lib/ai/llm.ts and lib/ops/agent-loop.ts may make model calls
 * with the client returned here (CLAUDE.md, "Petrios Ops" invariant 2).
 *
 * Resolution (first match wins; backward compatible with deployments that only
 * set OPENAI_API_KEY):
 *   1. LLM_PROVIDER=anthropic|openai pins the provider. A pinned provider whose
 *      key is missing stays unconfigured; it never falls back to the other one.
 *      Any other non-empty value is a configuration error and disables AI.
 *   2. Both keys set AND OPENAI_BASE_URL set (no pin) -> configuration error,
 *      AI disabled. A custom OpenAI-compatible endpoint is usually an
 *      in-network or contracted one chosen for data residency; a second key
 *      (a shared secret store, a developer shell) must neither silently move
 *      that traffic to the public Anthropic API nor be silently ignored.
 *   3. ANTHROPIC_API_KEY set  -> anthropic (the default provider)
 *   4. OPENAI_API_KEY set     -> openai (optional OpenAI-compatible adapter)
 *   5. otherwise              -> unconfigured
 * With both keys and no pin, the choice (or the error) is logged once.
 *
 * Anthropic config: ANTHROPIC_API_KEY, ANTHROPIC_MODEL (default
 * claude-opus-5-5), ANTHROPIC_BASE_URL (optional), ANTHROPIC_FALLBACKS
 * ("off" disables server-side refusal fallbacks; default on).
 * OpenAI config is unchanged: OPENAI_API_KEY, OPENAI_MODEL (default gpt-5.5),
 * OPENAI_BASE_URL.
 */

export const LLM_PROVIDERS = ['anthropic', 'openai'] as const
export type LlmProvider = (typeof LLM_PROVIDERS)[number]

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5'
export const DEFAULT_OPENAI_MODEL = 'gpt-5.5'

/** Beta header for `fallbacks: 'default'` (the scalar form; the array form uses another header). */
export const ANTHROPIC_SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01' satisfies AnthropicBeta

/** Bounds each HTTP attempt; streamed calls only wait this long for response headers. */
export const ANTHROPIC_TIMEOUT_MS = 5 * 60 * 1000
export const ANTHROPIC_MAX_RETRIES = 2

type Env = Readonly<Record<string, string | undefined>>

export const AMBIGUOUS_PROVIDER_ERROR =
  'ANTHROPIC_API_KEY and OPENAI_API_KEY are both set and OPENAI_BASE_URL names a custom endpoint; set LLM_PROVIDER=anthropic or LLM_PROVIDER=openai to choose where AI requests go'

function optional(env: Env, name: string): string | null {
  const value = env[name]?.trim()
  return value ? value : null
}

export interface LlmProviderConfig {
  /** The selected provider, or null when nothing selects one (or LLM_PROVIDER is invalid). */
  provider: LlmProvider | null
  /** True only when the selected provider's API key is present. */
  configured: boolean
  /** Model the selected provider will be asked for; null when no provider is selected. */
  model: string | null
  /** Operator-facing problem description; never contains a secret. */
  configurationError: string | null
}

export function anthropicModel(env: Env = process.env): string {
  return optional(env, 'ANTHROPIC_MODEL') ?? DEFAULT_ANTHROPIC_MODEL
}

export function openAiModel(env: Env = process.env): string {
  return optional(env, 'OPENAI_MODEL') ?? DEFAULT_OPENAI_MODEL
}

function keyName(provider: LlmProvider): string {
  return provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'
}

function modelFor(provider: LlmProvider, env: Env): string {
  return provider === 'anthropic' ? anthropicModel(env) : openAiModel(env)
}

/** Pure provider resolution; see the module comment for the precedence rules. */
export function resolveLlmProvider(env: Env = process.env): LlmProviderConfig {
  const requested = optional(env, 'LLM_PROVIDER')?.toLowerCase() ?? null
  if (requested !== null && !(LLM_PROVIDERS as readonly string[]).includes(requested)) {
    return {
      provider: null,
      configured: false,
      model: null,
      configurationError: 'LLM_PROVIDER must be either anthropic or openai',
    }
  }

  const hasAnthropicKey = Boolean(optional(env, 'ANTHROPIC_API_KEY'))
  const hasOpenAiKey = Boolean(optional(env, 'OPENAI_API_KEY'))
  if (requested === null && hasAnthropicKey && hasOpenAiKey && optional(env, 'OPENAI_BASE_URL')) {
    return { provider: null, configured: false, model: null, configurationError: AMBIGUOUS_PROVIDER_ERROR }
  }

  const provider: LlmProvider | null = (requested as LlmProvider | null)
    ?? (hasAnthropicKey ? 'anthropic' : null)
    ?? (hasOpenAiKey ? 'openai' : null)

  if (!provider) {
    return { provider: null, configured: false, model: null, configurationError: null }
  }

  const configured = Boolean(optional(env, keyName(provider)))
  return {
    provider,
    configured,
    model: modelFor(provider, env),
    configurationError: configured ? null : `LLM_PROVIDER=${provider} requires ${keyName(provider)}`,
  }
}

/**
 * Operator-facing notice about the provider choice: the configuration error,
 * or which provider wins when both keys are set without a pin. Never
 * contains a secret.
 */
export function llmProviderNotice(env: Env = process.env): string | null {
  const config = resolveLlmProvider(env)
  if (config.configurationError) return config.configurationError
  if (!optional(env, 'LLM_PROVIDER') && optional(env, 'ANTHROPIC_API_KEY') && optional(env, 'OPENAI_API_KEY')) {
    return 'ANTHROPIC_API_KEY and OPENAI_API_KEY are both set; AI requests use Anthropic. Set LLM_PROVIDER to choose explicitly.'
  }
  return null
}

const reportedNotices = new Set<string>()

/** Logs each distinct notice once per process/isolate (the live environment only). */
function reportProviderNotice(env: Env): void {
  if (env !== process.env) return
  const notice = llmProviderNotice(env)
  if (!notice || reportedNotices.has(notice)) return
  reportedNotices.add(notice)
  console.warn(`[ai] ${notice}`)
}

/** The provider every LLM call should use, or null when AI is not configured. */
export function activeLlmProvider(env: Env = process.env): LlmProvider | null {
  reportProviderNotice(env)
  const config = resolveLlmProvider(env)
  return config.configured ? config.provider : null
}

/** True when the resolved provider has its API key; without it every AI feature degrades. */
export function isLlmConfigured(env: Env = process.env): boolean {
  reportProviderNotice(env)
  return resolveLlmProvider(env).configured
}

/**
 * Model name for provenance/audit when no provider response is available.
 * Prefer the `model` a provider response reports (a server-side fallback can
 * serve a different model). Defaults to the Anthropic model when unconfigured.
 */
export function llmModel(env: Env = process.env): string {
  return resolveLlmProvider(env).provider === 'openai' ? openAiModel(env) : anthropicModel(env)
}

/** Server-side refusal fallbacks are on unless ANTHROPIC_FALLBACKS=off (for gateways that reject the beta). */
export function anthropicFallbacksEnabled(env: Env = process.env): boolean {
  return optional(env, 'ANTHROPIC_FALLBACKS')?.toLowerCase() !== 'off'
}

/**
 * Spread into every `client.beta.messages.stream(...)` call: opts into
 * server-side refusal fallbacks (`fallbacks: 'default'`, routed by refusal
 * category) with the beta header that form requires.
 */
export function anthropicFallbackParams(env: Env = process.env): {
  betas?: AnthropicBeta[]
  fallbacks?: BetaFallbacksParam
} {
  return anthropicFallbacksEnabled(env)
    ? { betas: [ANTHROPIC_SERVER_FALLBACK_BETA], fallbacks: 'default' }
    : {}
}

let cachedClient: { fingerprint: string; client: Anthropic } | null = null

/**
 * The Anthropic client for this isolate/process. The API key is always passed
 * explicitly, so the SDK never falls back to profile/config-file credential
 * discovery (which reads the filesystem and is meaningless on Workers).
 * Passing `fetch` (tests) returns a fresh, uncached client.
 */
export function getAnthropicClient(options: { fetch?: ClientOptions['fetch'] } = {}): Anthropic {
  const apiKey = optional(process.env, 'ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('Anthropic is not configured (ANTHROPIC_API_KEY)')
  const baseURL = optional(process.env, 'ANTHROPIC_BASE_URL') ?? undefined

  const create = () =>
    new Anthropic({
      apiKey,
      // Never also send an ANTHROPIC_AUTH_TOKEN bearer from the environment.
      authToken: null,
      baseURL,
      timeout: ANTHROPIC_TIMEOUT_MS,
      maxRetries: ANTHROPIC_MAX_RETRIES,
      // Pinned so ANTHROPIC_LOG=debug cannot write prompts or feedback text to logs.
      logLevel: 'warn',
      // Next patches global fetch; no-store keeps it from reading request
      // bodies (including streamed document uploads) to build a cache key.
      fetchOptions: { cache: 'no-store' },
      ...(options.fetch ? { fetch: options.fetch } : {}),
    })

  if (options.fetch) return create()
  const fingerprint = `${apiKey}\0${baseURL ?? ''}`
  if (cachedClient?.fingerprint !== fingerprint) {
    cachedClient = { fingerprint, client: create() }
  }
  return cachedClient.client
}

/** Test hook: forget the cached client (and which provider notices were logged). */
export function resetAnthropicClient(): void {
  cachedClient = null
  reportedNotices.clear()
}

export interface LlmTokenUsage {
  inputTokens: number
  outputTokens: number
}

/**
 * Audit token counts for one Messages response. Input includes cache reads and
 * writes (they are processed input). When `usage.iterations` is present it is
 * the per-attempt source of truth (server-tool sampling iterations and refusal
 * fallback attempts); otherwise the top-level counters are used.
 */
export function anthropicUsageTokens(usage: BetaUsage | null | undefined): LlmTokenUsage {
  if (!usage) return { inputTokens: 0, outputTokens: 0 }
  const attempts = (usage.iterations ?? []).filter(
    (entry) => entry.type === 'message' || entry.type === 'fallback_message'
  )
  if (attempts.length > 0) {
    return attempts.reduce<LlmTokenUsage>(
      (total, entry) => ({
        inputTokens:
          total.inputTokens
          + entry.input_tokens
          + (entry.cache_creation_input_tokens ?? 0)
          + (entry.cache_read_input_tokens ?? 0),
        outputTokens: total.outputTokens + entry.output_tokens,
      }),
      { inputTokens: 0, outputTokens: 0 }
    )
  }
  return {
    inputTokens:
      usage.input_tokens
      + (usage.cache_creation_input_tokens ?? 0)
      + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
  }
}

export function addTokenUsage(left: LlmTokenUsage, right: LlmTokenUsage): LlmTokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  }
}

const UNECHOABLE_BEFORE_FALLBACK = new Set(['thinking', 'redacted_thinking', 'tool_use'])

/**
 * Assistant content to send back on the next request (pause_turn resumption or
 * a tool-use turn). Blocks are passed back unmodified (preserved thinking),
 * except after a mid-output refusal fallback: thinking, redacted_thinking and
 * tool_use blocks, plus server_tool_use blocks without their result, that come
 * before the last `fallback` block belong to the declined model and are omitted.
 */
export function echoableAssistantContent(content: BetaContentBlock[]): BetaContentBlockParam[] {
  const boundary = content.map((block) => block.type).lastIndexOf('fallback')
  if (boundary < 0) return content as BetaContentBlockParam[]

  const answeredServerTools = new Set(
    content
      .filter((block): block is Extract<BetaContentBlock, { tool_use_id: string }> =>
        'tool_use_id' in block && typeof block.tool_use_id === 'string')
      .map((block) => block.tool_use_id)
  )
  return content.filter((block, index) => {
    if (index >= boundary) return true
    if (UNECHOABLE_BEFORE_FALLBACK.has(block.type)) return false
    if (block.type === 'server_tool_use') return answeredServerTools.has(block.id)
    return true
  }) as BetaContentBlockParam[]
}
