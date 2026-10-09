import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import type { BetaContentBlock, BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import {
  AMBIGUOUS_PROVIDER_ERROR,
  ANTHROPIC_SERVER_FALLBACK_BETA,
  activeLlmProvider,
  anthropicFallbackParams,
  anthropicModel,
  anthropicUsageTokens,
  echoableAssistantContent,
  getAnthropicClient,
  isLlmConfigured,
  llmModel,
  llmProviderNotice,
  openAiModel,
  resetAnthropicClient,
  resolveLlmProvider,
} from './provider'
import { jsonResponse, queuedFetch, sseResponse } from './testing/anthropic-sse'

const PROVIDER_ENV = [
  'LLM_PROVIDER',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_FALLBACKS',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_BASE_URL',
] as const

beforeEach(() => {
  for (const name of PROVIDER_ENV) vi.stubEnv(name, '')
  resetAnthropicClient()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetAnthropicClient()
})

describe('resolveLlmProvider', () => {
  it('is unconfigured when no provider key or pin is present', () => {
    expect(resolveLlmProvider({})).toEqual({
      provider: null,
      configured: false,
      model: null,
      configurationError: null,
    })
  })

  it('keeps an OpenAI-only deployment on OpenAI (zero-downtime upgrade)', () => {
    expect(resolveLlmProvider({ OPENAI_API_KEY: 'sk-openai' })).toEqual({
      provider: 'openai',
      configured: true,
      model: 'gpt-5.5',
      configurationError: null,
    })
  })

  it('selects Anthropic when its key is present', () => {
    expect(resolveLlmProvider({ ANTHROPIC_API_KEY: 'sk-ant' })).toEqual({
      provider: 'anthropic',
      configured: true,
      model: 'claude-opus-5-5',
      configurationError: null,
    })
  })

  it('prefers Anthropic when both keys are present', () => {
    expect(
      resolveLlmProvider({ ANTHROPIC_API_KEY: 'sk-ant', OPENAI_API_KEY: 'sk-openai' }).provider
    ).toBe('anthropic')
  })

  it('refuses to guess when a custom OpenAI-compatible endpoint and an Anthropic key are both configured', () => {
    // An in-network OPENAI_BASE_URL must not silently lose its traffic to the
    // public Anthropic API because an ANTHROPIC_API_KEY is also present.
    const env = {
      ANTHROPIC_API_KEY: 'sk-ant',
      OPENAI_API_KEY: 'sk-openai',
      OPENAI_BASE_URL: 'https://gateway.internal/v1',
    }
    expect(resolveLlmProvider(env)).toEqual({
      provider: null,
      configured: false,
      model: null,
      configurationError: AMBIGUOUS_PROVIDER_ERROR,
    })
    expect(activeLlmProvider(env)).toBeNull()
    expect(resolveLlmProvider({ ...env, LLM_PROVIDER: 'openai' })).toMatchObject({ provider: 'openai', configured: true })
    expect(resolveLlmProvider({ ...env, LLM_PROVIDER: 'anthropic' })).toMatchObject({ provider: 'anthropic', configured: true })
    // Without an OpenAI key there is no OpenAI LLM path to protect.
    expect(resolveLlmProvider({ ANTHROPIC_API_KEY: 'sk-ant', OPENAI_BASE_URL: 'https://gateway.internal/v1' }).provider)
      .toBe('anthropic')
    expect(JSON.stringify(resolveLlmProvider(env))).not.toMatch(/sk-|gateway\.internal/)
  })

  it('lets an explicit LLM_PROVIDER pin win over key detection', () => {
    expect(
      resolveLlmProvider({
        LLM_PROVIDER: 'openai',
        ANTHROPIC_API_KEY: 'sk-ant',
        OPENAI_API_KEY: 'sk-openai',
      })
    ).toMatchObject({ provider: 'openai', configured: true, model: 'gpt-5.5' })
  })

  it('normalizes the pin case and surrounding whitespace', () => {
    expect(
      resolveLlmProvider({ LLM_PROVIDER: '  Anthropic ', ANTHROPIC_API_KEY: 'sk-ant' }).provider
    ).toBe('anthropic')
  })

  it('never falls back to the other provider when the pinned key is missing', () => {
    expect(resolveLlmProvider({ LLM_PROVIDER: 'anthropic', OPENAI_API_KEY: 'sk-openai' })).toEqual({
      provider: 'anthropic',
      configured: false,
      model: 'claude-opus-5-5',
      configurationError: 'LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY',
    })
    expect(resolveLlmProvider({ LLM_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'sk-ant' })).toEqual({
      provider: 'openai',
      configured: false,
      model: 'gpt-5.5',
      configurationError: 'LLM_PROVIDER=openai requires OPENAI_API_KEY',
    })
  })

  it('fails closed on an unsupported pin even when keys are present', () => {
    expect(
      resolveLlmProvider({
        LLM_PROVIDER: 'gemini',
        ANTHROPIC_API_KEY: 'sk-ant',
        OPENAI_API_KEY: 'sk-openai',
      })
    ).toEqual({
      provider: null,
      configured: false,
      model: null,
      configurationError: 'LLM_PROVIDER must be either anthropic or openai',
    })
  })

  it('treats blank values as unset', () => {
    expect(
      resolveLlmProvider({ LLM_PROVIDER: '   ', ANTHROPIC_API_KEY: '  ', OPENAI_API_KEY: 'sk-openai' })
        .provider
    ).toBe('openai')
  })

  it('applies model overrides per provider', () => {
    const env = {
      ANTHROPIC_API_KEY: 'sk-ant',
      ANTHROPIC_MODEL: 'claude-sonnet-5-5',
      OPENAI_MODEL: 'gpt-local',
    }
    expect(resolveLlmProvider(env).model).toBe('claude-sonnet-5-5')
    expect(anthropicModel(env)).toBe('claude-sonnet-5-5')
    expect(openAiModel(env)).toBe('gpt-local')
    expect(anthropicModel({})).toBe('claude-opus-5-5')
    expect(openAiModel({})).toBe('gpt-5.5')
  })

  it('never includes a secret in the result', () => {
    const result = JSON.stringify(
      resolveLlmProvider({ LLM_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'sk-ant-secret' })
    )
    expect(result).not.toContain('sk-ant-secret')
  })
})

describe('provider helpers', () => {
  it('reports the active provider only when it is configured', () => {
    expect(activeLlmProvider({ ANTHROPIC_API_KEY: 'sk-ant' })).toBe('anthropic')
    expect(activeLlmProvider({ LLM_PROVIDER: 'anthropic' })).toBeNull()
    expect(isLlmConfigured({ OPENAI_API_KEY: 'sk-openai' })).toBe(true)
    expect(isLlmConfigured({ LLM_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'sk-ant' })).toBe(false)
  })

  it('reads process.env by default', () => {
    expect(isLlmConfigured()).toBe(false)
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant')
    expect(isLlmConfigured()).toBe(true)
    expect(activeLlmProvider()).toBe('anthropic')
  })

  it('logs the provider choice once when both keys are set without a pin, never a secret', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-secret')
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-secret')
    expect(activeLlmProvider()).toBe('anthropic')
    expect(isLlmConfigured()).toBe(true)
    expect(activeLlmProvider()).toBe('anthropic')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toBe(
      '[ai] ANTHROPIC_API_KEY and OPENAI_API_KEY are both set; AI requests use Anthropic. Set LLM_PROVIDER to choose explicitly.'
    )

    vi.stubEnv('OPENAI_BASE_URL', 'https://gateway.internal/v1')
    expect(activeLlmProvider()).toBeNull()
    expect(isLlmConfigured()).toBe(false)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[1][0]).toBe(`[ai] ${AMBIGUOUS_PROVIDER_ERROR}`)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret')

    vi.stubEnv('LLM_PROVIDER', 'openai')
    expect(llmProviderNotice()).toBeNull()
  })

  it('names the model of the selected provider for provenance', () => {
    expect(llmModel({ OPENAI_API_KEY: 'sk-openai' })).toBe('gpt-5.5')
    expect(llmModel({ ANTHROPIC_API_KEY: 'sk-ant' })).toBe('claude-opus-5-5')
    expect(llmModel({})).toBe('claude-opus-5-5')
  })

  it('enables server-side refusal fallbacks unless explicitly turned off', () => {
    expect(anthropicFallbackParams({})).toEqual({
      betas: [ANTHROPIC_SERVER_FALLBACK_BETA],
      fallbacks: 'default',
    })
    expect(ANTHROPIC_SERVER_FALLBACK_BETA).toBe('server-side-fallback-2026-07-01')
    expect(anthropicFallbackParams({ ANTHROPIC_FALLBACKS: 'OFF' })).toEqual({})
  })
})

describe('anthropicUsageTokens', () => {
  const usage = (overrides: Partial<BetaUsage>): BetaUsage => ({
    cache_creation: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    fallback_credit: null,
    inference_geo: null,
    input_tokens: 0,
    iterations: null,
    output_tokens: 0,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: 'standard',
    speed: null,
    ...overrides,
  })

  it('counts cache reads and writes as input', () => {
    expect(
      anthropicUsageTokens(
        usage({
          input_tokens: 100,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 300,
          output_tokens: 50,
        })
      )
    ).toEqual({ inputTokens: 420, outputTokens: 50 })
  })

  it('sums every model attempt when iterations are reported', () => {
    expect(
      anthropicUsageTokens(
        usage({
          input_tokens: 5,
          output_tokens: 5,
          iterations: [
            {
              type: 'message',
              model: 'claude-opus-5-5',
              input_tokens: 100,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 10,
              output_tokens: 0,
              cache_creation: null,
            },
            {
              type: 'fallback_message',
              model: 'claude-opus-5',
              input_tokens: 100,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              output_tokens: 40,
              cache_creation: null,
            },
          ],
        })
      )
    ).toEqual({ inputTokens: 210, outputTokens: 40 })
  })

  it('tolerates missing usage', () => {
    expect(anthropicUsageTokens(null)).toEqual({ inputTokens: 0, outputTokens: 0 })
  })
})

describe('echoableAssistantContent', () => {
  it('returns content unchanged when no fallback happened', () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 'toolu_1', name: 'memory_list', input: {}, caller: { type: 'direct' } },
    ] as unknown as BetaContentBlock[]
    expect(echoableAssistantContent(content)).toEqual(content)
  })

  it('drops the declined model’s internal blocks before the last fallback boundary', () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 'declined' },
      { type: 'text', text: 'Partial ', citations: null },
      { type: 'server_tool_use', id: 'srvtoolu_paired', name: 'web_search', input: {}, caller: { type: 'direct' } },
      { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_paired', content: [], caller: { type: 'direct' } },
      { type: 'server_tool_use', id: 'srvtoolu_orphan', name: 'web_search', input: {}, caller: { type: 'direct' } },
      { type: 'tool_use', id: 'toolu_declined', name: 'memory_list', input: {}, caller: { type: 'direct' } },
      { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' }, trigger: { type: 'refusal' } },
      { type: 'thinking', thinking: '', signature: 'served' },
      { type: 'text', text: 'answer', citations: null },
    ] as unknown as BetaContentBlock[]

    expect(echoableAssistantContent(content).map((block) => [block.type, 'id' in block ? block.id : null])).toEqual([
      ['text', null],
      ['server_tool_use', 'srvtoolu_paired'],
      ['web_search_tool_result', null],
      ['fallback', null],
      ['thinking', null],
      ['text', null],
    ])
  })
})

describe('getAnthropicClient', () => {
  it('refuses to build a client without an API key', () => {
    expect(() => getAnthropicClient()).toThrow('Anthropic is not configured (ANTHROPIC_API_KEY)')
  })

  it('reuses one client per isolate until the key or base URL changes', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-1')
    const first = getAnthropicClient()
    expect(getAnthropicClient()).toBe(first)
    expect(first).toBeInstanceOf(Anthropic)

    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-2')
    const second = getAnthropicClient()
    expect(second).not.toBe(first)

    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://gateway.internal')
    expect(getAnthropicClient()).not.toBe(second)
  })

  it('returns a fresh client for an injected fetch', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant')
    const { fetch } = queuedFetch([])
    expect(getAnthropicClient({ fetch })).not.toBe(getAnthropicClient({ fetch }))
  })

  it('streams a beta Messages request with key auth and refusal fallbacks (mocked fetch)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'must-not-be-sent')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://gateway.internal/')
    const { fetch, requests } = queuedFetch([
      sseResponse({
        content: [{ type: 'text', text: 'Hello from Claude', citations: null }],
        usage: { input_tokens: 12, output_tokens: 4, cache_read_input_tokens: 3 },
      }),
    ])

    const client = getAnthropicClient({ fetch })
    const stream = client.beta.messages.stream({
      model: anthropicModel(),
      max_tokens: 1024,
      system: 'system prompt',
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Say hello' }],
      ...anthropicFallbackParams(),
    })
    const message = await stream.finalMessage()

    expect(message.stop_reason).toBe('end_turn')
    expect(message.content).toEqual([{ type: 'text', text: 'Hello from Claude', citations: null }])
    expect(anthropicUsageTokens(message.usage)).toEqual({ inputTokens: 15, outputTokens: 4 })

    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request.url).toBe('https://gateway.internal/v1/messages?beta=true')
    expect(request.headers.get('x-api-key')).toBe('sk-ant-test')
    expect(request.headers.get('authorization')).toBeNull()
    expect(request.headers.get('anthropic-beta')).toBe('server-side-fallback-2026-07-01')
    expect(request.cache).toBe('no-store')
    expect(request.json).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 1024,
      stream: true,
      fallbacks: 'default',
      output_config: { effort: 'low' },
    })
    expect(request.json).not.toHaveProperty('thinking')
    expect(request.json).not.toHaveProperty('betas')
  })

  it('captures the global fetch when the cached client is created (test pattern for callers)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    const { fetch, requests } = queuedFetch([
      sseResponse({ content: [{ type: 'text', text: 'ok', citations: null }] }),
    ])
    vi.stubGlobal('fetch', fetch)
    try {
      resetAnthropicClient()
      const message = await getAnthropicClient()
        .beta.messages.stream({
          model: anthropicModel(),
          max_tokens: 16,
          messages: [{ role: 'user', content: 'x' }],
        })
        .finalMessage()
      expect(message.content).toEqual([{ type: 'text', text: 'ok', citations: null }])
      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe('https://api.anthropic.com/v1/messages?beta=true')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('surfaces API failures as typed SDK errors', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    const { fetch } = queuedFetch([
      jsonResponse(
        { type: 'error', error: { type: 'invalid_request_error', message: 'bad request' } },
        400
      ),
    ])
    const client = getAnthropicClient({ fetch })
    await expect(
      client.beta.messages
        .stream({
          model: anthropicModel(),
          max_tokens: 16,
          messages: [{ role: 'user', content: 'x' }],
        })
        .finalMessage()
    ).rejects.toBeInstanceOf(Anthropic.BadRequestError)
  })
})
