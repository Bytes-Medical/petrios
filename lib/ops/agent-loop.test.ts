import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'

const llm = vi.hoisted(() => ({
  postOpenAiChatCompletion: vi.fn(),
  askLlmWithUsage: vi.fn(),
  askLlmWithFileInputs: vi.fn(),
  isLlmConfigured: vi.fn(),
  llmModel: vi.fn(),
  describeLlmError: vi.fn(),
}))

// Only the OpenAI adapter's HTTP helper is used from lib/ai/llm.ts (owned by
// implementer A); the Anthropic branch runs the real SDK against a mocked fetch.
vi.mock('@/lib/ai/llm', () => llm)

import { resetAnthropicClient } from '@/lib/ai/provider'
import {
  jsonResponse,
  messageToSse,
  queuedFetch,
  sseResponse,
  type MockMessage,
  type RecordedRequest,
} from '@/lib/ai/testing/anthropic-sse'
import { runAgentLoop, type ChatTurn } from './agent-loop'
import { hashPrompt } from './gateway'
import type { OpsRun } from './run'
import type { OpsTool, ToolContext } from './tools'

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

const SYSTEM = 'ASSISTANT-SYSTEM-RULES for the organiser assistant'
const USER_MESSAGE = 'Which sessions still need a speaker?'

const NOT_CONFIGURED =
  'The AI assistant is not configured yet — an administrator needs to set ANTHROPIC_API_KEY (or OPENAI_API_KEY for an OpenAI-compatible endpoint).'
const REFUSAL = 'I can’t help with that request.'
const ITERATION_LIMIT =
  'I hit my tool-use limit for one message — ask me to continue and I’ll pick up from here.'

const NO_INPUT = { type: 'object', properties: {}, additionalProperties: false }
const SESSION_INPUT = {
  type: 'object',
  properties: { sessionId: { type: 'string', description: 'Session id (UUID)' } },
  required: ['sessionId'],
  additionalProperties: false,
}
const MEMORY_INPUT = {
  type: 'object',
  properties: { key: { type: 'string' }, value: { type: 'string' } },
  required: ['key', 'value'],
  additionalProperties: false,
}

type Handler = OpsTool['handler']

let handlers: {
  sessions_get: Mock<Handler>
  memory_list: Mock<Handler>
  memory_save: Mock<Handler>
  failing: Mock<Handler>
}

function buildTools(): OpsTool[] {
  return [
    { name: 'sessions_get', description: 'Get one session', inputSchema: SESSION_INPUT, handler: handlers.sessions_get },
    { name: 'memory_list', description: 'List saved notes', inputSchema: NO_INPUT, handler: handlers.memory_list },
    { name: 'memory_save', description: 'Save a note', inputSchema: MEMORY_INPUT, handler: handlers.memory_save },
    { name: 'failing', description: 'Always fails', inputSchema: NO_INPUT, handler: handlers.failing },
  ]
}

function fakeRun() {
  return {
    id: 'run-1',
    log: vi.fn<OpsRun['log']>(async () => {}),
    logLlm: vi.fn<OpsRun['logLlm']>(async () => {}),
    finish: vi.fn<OpsRun['finish']>(async () => {}),
  } satisfies OpsRun
}

function setup(responses: Array<Response | ((request: RecordedRequest) => Response)>) {
  const queued = queuedFetch(responses)
  vi.stubGlobal('fetch', queued.fetch)
  const run = fakeRun()
  const ctx: ToolContext = { orgId: 'org-1', userId: 'user-1', run }
  const tools = buildTools()
  const call = (history: ChatTurn[] = [], userMessage = USER_MESSAGE) =>
    runAgentLoop({ system: SYSTEM, history, userMessage, tools, ctx, run })
  return { ...queued, run, ctx, tools, call }
}

const text = (value: string) => ({ type: 'text', text: value, citations: null })
const toolUse = (id: string, name: string, input: Record<string, unknown> = {}) => ({
  type: 'tool_use',
  id,
  name,
  input,
  caller: { type: 'direct' },
})

/** A streamed response whose tool input is not JSON (the SDK cannot parse it). */
function unreadableToolInputResponse(): Response {
  const body = messageToSse({ content: [toolUse('toolu_bad', 'memory_list')], stop_reason: 'tool_use' })
    .replace('"partial_json":"{}"', '"partial_json":"nonsense"')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

beforeEach(() => {
  for (const name of PROVIDER_ENV) vi.stubEnv(name, '')
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
  resetAnthropicClient()
  handlers = {
    sessions_get: vi.fn<Handler>(async (_ctx, input) => ({
      id: (input as { sessionId: string }).sessionId,
      title: 'Sepsis update',
    })),
    memory_list: vi.fn<Handler>(async () => [{ key: 'slot-preference', value: 'Tuesday lunch' }]),
    memory_save: vi.fn<Handler>(async () => ({ saved: true })),
    failing: vi.fn<Handler>(async () => {
      throw new Error('boom')
    }),
  }
  for (const fn of Object.values(llm)) fn.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  resetAnthropicClient()
})

describe('runAgentLoop configuration', () => {
  it('explains how to configure the assistant when no provider key is set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const { call, requests, run } = setup([])
    expect(await call()).toEqual({ text: NOT_CONFIGURED, toolTrace: [] })
    expect(requests).toHaveLength(0)
    expect(llm.postOpenAiChatCompletion).not.toHaveBeenCalled()
    expect(run.logLlm).not.toHaveBeenCalled()
  })

  it('reports a pinned provider whose key is missing instead of falling back', async () => {
    vi.stubEnv('LLM_PROVIDER', 'openai')
    const { call, requests } = setup([])
    expect((await call()).text).toBe(
      'The AI assistant is not configured correctly — LLM_PROVIDER=openai requires OPENAI_API_KEY.'
    )
    expect(requests).toHaveLength(0)
    expect(llm.postOpenAiChatCompletion).not.toHaveBeenCalled()
  })

  it('fails closed on an unsupported provider pin', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini')
    const { call, requests } = setup([])
    expect((await call()).text).toBe(
      'The AI assistant is not configured correctly — LLM_PROVIDER must be either anthropic or openai.'
    )
    expect(requests).toHaveLength(0)
  })
})

describe('runAgentLoop on Anthropic', () => {
  it('streams a beta Messages request with strict tools, explicit effort and refusal fallbacks', async () => {
    const { call, requests, run } = setup([
      sseResponse({
        model: 'claude-opus-5-5',
        content: [{ type: 'thinking', thinking: '', signature: 'sig-1' }, text('Two sessions '), text('need speakers.')],
        usage: { input_tokens: 40, output_tokens: 12, cache_read_input_tokens: 900, cache_creation_input_tokens: 60 },
      }),
    ])
    const history: ChatTurn[] = [
      { role: 'assistant', content: 'Earlier reply that lost its question' },
      { role: 'user', content: '   ' },
      { role: 'user', content: 'What is coming up?' },
      { role: 'assistant', content: 'Three sessions next week.' },
    ]

    const result = await call(history)

    expect(result).toEqual({ text: 'Two sessions need speakers.', toolTrace: [] })
    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request.url).toBe('https://api.anthropic.com/v1/messages?beta=true')
    expect(request.headers.get('x-api-key')).toBe('sk-ant-test')
    expect(request.headers.get('anthropic-beta')).toBe('server-side-fallback-2026-07-01')
    // The whole body: no thinking, sampling, tool_choice, prefill or eager streaming.
    expect(request.json).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 16384,
      system: SYSTEM,
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      tools: [
        { name: 'sessions_get', description: 'Get one session', input_schema: SESSION_INPUT, strict: true },
        { name: 'memory_list', description: 'List saved notes', input_schema: NO_INPUT, strict: true },
        { name: 'memory_save', description: 'Save a note', input_schema: MEMORY_INPUT, strict: true },
        { name: 'failing', description: 'Always fails', input_schema: NO_INPUT, strict: true },
      ],
      // Leading assistant and empty turns are dropped; the new message is last.
      messages: [
        { role: 'user', content: 'What is coming up?' },
        { role: 'assistant', content: 'Three sessions next week.' },
        { role: 'user', content: USER_MESSAGE },
      ],
      fallbacks: 'default',
      stream: true,
    })

    expect(run.logLlm).toHaveBeenCalledTimes(1)
    expect(run.logLlm).toHaveBeenCalledWith({
      name: 'assistant:turn:1',
      purpose: 'assistant',
      model: 'claude-opus-5-5',
      promptHash: hashPrompt(SYSTEM, JSON.stringify(USER_MESSAGE)),
      inputTokens: 1000,
      outputTokens: 12,
      detail: { stop_reason: 'end_turn' },
    })
  })

  it('runs every tool call and answers them all in one user message of tool_result blocks', async () => {
    const firstTurn: MockMessage = {
      content: [
        { type: 'thinking', thinking: '', signature: 'sig-tools' },
        text('Let me check.'),
        toolUse('toolu_1', 'sessions_get', { sessionId: 's-1' }),
        toolUse('toolu_2', 'drop_tables'),
        toolUse('toolu_3', 'failing'),
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 500, output_tokens: 80 },
    }
    const { call, requests, run, ctx } = setup([
      sseResponse(firstTurn),
      sseResponse({ content: [text('Sepsis update has no speaker yet.')], usage: { input_tokens: 700, output_tokens: 20 } }),
    ])

    const result = await call()

    expect(result).toEqual({
      text: 'Sepsis update has no speaker yet.',
      toolTrace: [
        { name: 'sessions_get', ok: true },
        { name: 'drop_tables', ok: false },
        { name: 'failing', ok: false },
      ],
    })
    // Org scope comes from the caller's context, never from model input.
    expect(handlers.sessions_get).toHaveBeenCalledWith(ctx, { sessionId: 's-1' })
    expect(handlers.failing).toHaveBeenCalledTimes(1)

    expect(requests).toHaveLength(2)
    const toolResults = [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        content: JSON.stringify({ id: 's-1', title: 'Sepsis update' }),
      },
      { type: 'tool_result', tool_use_id: 'toolu_2', content: 'Unknown tool: drop_tables', is_error: true },
      { type: 'tool_result', tool_use_id: 'toolu_3', content: 'Tool error: boom', is_error: true },
    ]
    // The assistant turn is echoed unmodified (thinking signature included).
    expect(requests[1].json?.messages).toEqual([
      { role: 'user', content: USER_MESSAGE },
      { role: 'assistant', content: firstTurn.content },
      { role: 'user', content: toolResults },
    ])
    // System and tools are byte-identical across turns (preserved thinking, caching).
    expect(requests[1].json?.system).toEqual(requests[0].json?.system)
    expect(requests[1].json?.tools).toEqual(requests[0].json?.tools)

    expect(run.log.mock.calls).toEqual([
      ['assistant:tool:sessions_get', { ok: true }],
      ['assistant:tool:drop_tables', { ok: false }],
      ['assistant:tool:failing', { ok: false }],
    ])
    expect(run.logLlm.mock.calls.map(([step]) => step)).toEqual([
      {
        name: 'assistant:turn:1',
        purpose: 'assistant',
        model: 'claude-opus-5-5',
        promptHash: hashPrompt(SYSTEM, JSON.stringify(USER_MESSAGE)),
        inputTokens: 500,
        outputTokens: 80,
        detail: { stop_reason: 'tool_use' },
      },
      {
        name: 'assistant:turn:2',
        purpose: 'assistant',
        model: 'claude-opus-5-5',
        promptHash: hashPrompt(SYSTEM, JSON.stringify(toolResults)),
        inputTokens: 700,
        outputTokens: 20,
        detail: { stop_reason: 'end_turn' },
      },
    ])
    // Audit steps hold hashes and counts only: no prompt, reply or tool text.
    const audited = JSON.stringify([run.logLlm.mock.calls, run.log.mock.calls])
    for (const secret of [SYSTEM, USER_MESSAGE, 'Let me check', 'Sepsis update', 'boom']) {
      expect(audited).not.toContain(secret)
    }
  })

  it('never runs tools from a refused turn', async () => {
    const { call, requests, run } = setup([
      sseResponse({
        content: [text('Sure, '), toolUse('toolu_1', 'memory_save', { key: 'k', value: 'v' })],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'general_harms', explanation: null },
      }),
    ])
    expect(await call()).toEqual({ text: REFUSAL, toolTrace: [] })
    expect(handlers.memory_save).not.toHaveBeenCalled()
    expect(requests).toHaveLength(1)
    expect(run.logLlm.mock.calls[0][0].detail).toEqual({
      stop_reason: 'refusal',
      refusal_category: 'general_harms',
    })
  })

  it('never runs a tool call truncated by max_tokens', async () => {
    const { call, requests } = setup([
      sseResponse({
        content: [toolUse('toolu_1', 'memory_save', { key: 'k', value: 'partial' })],
        stop_reason: 'max_tokens',
      }),
    ])
    expect(await call()).toEqual({
      text: 'That answer was too long for one message. Ask me for a shorter version.',
      toolTrace: [],
    })
    expect(handlers.memory_save).not.toHaveBeenCalled()
    expect(requests).toHaveLength(1)
  })

  it('stops when the context window is exhausted', async () => {
    const { call } = setup([
      sseResponse({ content: [], stop_reason: 'model_context_window_exceeded' }),
    ])
    expect((await call()).text).toBe('This conversation is too long. Start a new thread.')
  })

  it('resumes a paused turn by resending it, without adding a user message', async () => {
    const paused: MockMessage = { content: [text('Part one, ')], stop_reason: 'pause_turn' }
    const { call, requests } = setup([
      sseResponse(paused),
      sseResponse({ content: [text('part two.')] }),
    ])
    expect(await call()).toEqual({ text: 'Part one, part two.', toolTrace: [] })
    expect(requests).toHaveLength(2)
    expect(requests[1].json?.messages).toEqual([
      { role: 'user', content: USER_MESSAGE },
      { role: 'assistant', content: paused.content },
    ])
    expect(requests[1].json?.tools).toEqual(requests[0].json?.tools)
  })

  it('stops at the iteration cap', async () => {
    const turns = Array.from({ length: 8 }, (_, index) =>
      sseResponse({ content: [toolUse(`toolu_${index}`, 'memory_list')], stop_reason: 'tool_use' })
    )
    const { call, requests, run } = setup(turns)
    const result = await call()
    expect(result.text).toBe(ITERATION_LIMIT)
    expect(result.toolTrace).toHaveLength(8)
    expect(requests).toHaveLength(8)
    expect(handlers.memory_list).toHaveBeenCalledTimes(8)
    expect(run.logLlm).toHaveBeenCalledTimes(8)
  })

  it('drops the declined model’s tool calls after a refusal fallback and audits the serving model', async () => {
    const { call, requests, run } = setup([
      sseResponse({
        model: 'claude-opus-5',
        content: [
          { type: 'thinking', thinking: '', signature: 'declined' },
          toolUse('toolu_declined', 'memory_save', { key: 'k', value: 'v' }),
          { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' }, trigger: { type: 'refusal' } },
          toolUse('toolu_served', 'memory_list'),
        ],
        stop_reason: 'tool_use',
      }),
      sseResponse({ model: 'claude-opus-5', content: [text('One saved note.')] }),
    ])

    const result = await call()

    expect(result).toEqual({ text: 'One saved note.', toolTrace: [{ name: 'memory_list', ok: true }] })
    expect(handlers.memory_save).not.toHaveBeenCalled()
    const [, assistant, toolResults] = requests[1].json?.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>
    expect(assistant.content.map((block) => block.id ?? block.type)).toEqual(['fallback', 'toolu_served'])
    expect(toolResults.content.map((block) => block.tool_use_id)).toEqual(['toolu_served'])
    expect(run.logLlm.mock.calls[0][0].model).toBe('claude-opus-5')
  })

  it('omits the fallback beta and parameter when ANTHROPIC_FALLBACKS=off', async () => {
    vi.stubEnv('ANTHROPIC_FALLBACKS', 'off')
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-sonnet-5-5')
    const { call, requests } = setup([sseResponse({ content: [text('ok')] })])
    await call()
    expect(requests[0].headers.get('anthropic-beta')).toBeNull()
    expect(requests[0].json).not.toHaveProperty('fallbacks')
    expect(requests[0].json?.model).toBe('claude-sonnet-5-5')
  })

  it('audits a failed call by error type only and rethrows the typed SDK error', async () => {
    const { call, run } = setup([
      jsonResponse({ type: 'error', error: { type: 'invalid_request_error', message: 'tools.0: invalid' } }, 400),
    ])
    await expect(call()).rejects.toBeInstanceOf(Anthropic.BadRequestError)
    expect(run.logLlm).toHaveBeenCalledWith({
      name: 'assistant:turn:1:error',
      purpose: 'assistant',
      model: 'claude-opus-5-5',
      promptHash: hashPrompt(SYSTEM, JSON.stringify(USER_MESSAGE)),
      detail: { error: 'invalid_request_error', status: 400, request_id: 'req_test' },
    })
  })

  it('re-issues a turn whose streamed tool input cannot be parsed', async () => {
    const { call, requests, run } = setup([
      unreadableToolInputResponse(),
      sseResponse({ content: [text('Recovered.')] }),
    ])
    expect(await call()).toEqual({ text: 'Recovered.', toolTrace: [] })
    expect(handlers.memory_list).not.toHaveBeenCalled()
    expect(requests).toHaveLength(2)
    expect(requests[1].json?.messages).toEqual(requests[0].json?.messages)
    expect(run.logLlm.mock.calls.map(([step]) => [step.name, step.detail])).toEqual([
      ['assistant:turn:1:error', { error: 'unreadable_response' }],
      ['assistant:turn:2', { stop_reason: 'end_turn' }],
    ])
  })

  it('gives up on repeatedly unreadable responses without echoing model output', async () => {
    const { call, requests } = setup([
      unreadableToolInputResponse(),
      unreadableToolInputResponse(),
      unreadableToolInputResponse(),
    ])
    const error = await call().catch((err: unknown) => err)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('The AI response could not be read. Please try again.')
    expect((error as Error).message).not.toContain('nonsense')
    expect(requests).toHaveLength(3)
  })
})

describe('runAgentLoop on the OpenAI-compatible adapter', () => {
  function openAiReply(message: Record<string, unknown>, finishReason = 'stop') {
    return {
      model: 'gpt-5.5-2026-08-01',
      choices: [{ message: { role: 'assistant', ...message }, finish_reason: finishReason }],
      usage: { prompt_tokens: 50, completion_tokens: 7 },
    }
  }

  function captureBodies() {
    const bodies: Array<Record<string, unknown>> = []
    return {
      bodies,
      record(...replies: unknown[]) {
        for (const reply of replies) {
          llm.postOpenAiChatCompletion.mockImplementationOnce(async (body: Record<string, unknown>) => {
            bodies.push(structuredClone(body))
            return reply
          })
        }
      },
    }
  }

  it('keeps the Chat Completions loop when only OPENAI_API_KEY is set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai')
    const { call, requests, run, ctx } = setup([])
    const { bodies, record } = captureBodies()
    record(
      openAiReply({
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'sessions_get', arguments: '{"sessionId":"s-1"}' } },
          { id: 'call_2', type: 'function', function: { name: 'failing', arguments: '' } },
        ],
      }, 'tool_calls'),
      openAiReply({ content: 'All set.' })
    )
    const history: ChatTurn[] = [{ role: 'assistant', content: 'Earlier reply' }]

    const result = await call(history)

    expect(result).toEqual({
      text: 'All set.',
      toolTrace: [
        { name: 'sessions_get', ok: true },
        { name: 'failing', ok: false },
      ],
    })
    expect(requests).toHaveLength(0)
    expect(handlers.sessions_get).toHaveBeenCalledWith(ctx, { sessionId: 's-1' })
    expect(bodies[0]).toEqual({
      model: 'gpt-5.5',
      max_completion_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'assistant', content: 'Earlier reply' },
        { role: 'user', content: USER_MESSAGE },
      ],
      tools: buildTools().map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      })),
    })
    expect((bodies[1].messages as unknown[]).slice(-2)).toEqual([
      { role: 'tool', tool_call_id: 'call_1', content: JSON.stringify({ id: 's-1', title: 'Sepsis update' }) },
      { role: 'tool', tool_call_id: 'call_2', content: 'Tool error: boom' },
    ])
    expect(run.logLlm.mock.calls[0][0]).toEqual({
      name: 'assistant:turn:1',
      purpose: 'assistant',
      model: 'gpt-5.5-2026-08-01',
      promptHash: hashPrompt(SYSTEM, JSON.stringify(USER_MESSAGE)),
      inputTokens: 50,
      outputTokens: 7,
    })
  })

  it('honours an explicit LLM_PROVIDER=openai pin when both keys are present', async () => {
    vi.stubEnv('LLM_PROVIDER', 'openai')
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai')
    vi.stubEnv('OPENAI_MODEL', 'gpt-local')
    const { call, requests } = setup([])
    const { bodies, record } = captureBodies()
    record(openAiReply({ content: 'Hello from OpenAI.' }))
    expect((await call()).text).toBe('Hello from OpenAI.')
    expect(requests).toHaveLength(0)
    expect(bodies[0].model).toBe('gpt-local')
  })

  it('maps an OpenAI refusal to the refusal reply', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai')
    const { call } = setup([])
    const { record } = captureBodies()
    record(openAiReply({ content: null, refusal: 'No.' }))
    expect(await call()).toEqual({ text: REFUSAL, toolTrace: [] })
  })
})
