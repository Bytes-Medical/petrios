import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { postOpenAiChatCompletion } from '@/lib/ai/llm'
import {
  anthropicFallbackParams,
  anthropicModel,
  anthropicUsageTokens,
  echoableAssistantContent,
  getAnthropicClient,
  openAiModel,
  resolveLlmProvider,
} from '@/lib/ai/provider'
import { hashPrompt, OPS_PURPOSE_EFFORT } from './gateway'
import type { OpsRun } from './run'
import { toAnthropicTool, type OpsTool, type ToolContext } from './tools'

/**
 * The assistant's tool-use loop. This is the ONE sanctioned LLM provider call
 * site outside lib/ai/llm.ts: tool calling needs the raw message stream, so
 * it can't go through askLlm. It still follows every gateway rule: an audit
 * step per model call (prompt hash + token counts, never text), refusal
 * handling, and a hard iteration cap.
 *
 * The provider comes from the shared resolution in lib/ai/provider.ts:
 * Anthropic (default) runs a manual streaming tool loop on the beta Messages
 * endpoint; the OpenAI-compatible adapter keeps the Chat Completions loop.
 * Tool handlers are the same for both and always take org scope from the
 * caller's ToolContext, never from model input.
 */

const MAX_ITERATIONS = 8
/** OpenAI adapter: unchanged per-turn completion budget. */
const OPENAI_MAX_TOKENS = 4096
/** Anthropic: adaptive thinking counts toward max_tokens; billed only as used. */
const ANTHROPIC_MAX_TOKENS = 16384
const TOOL_RESULT_MAX_CHARS = 20000
/** Consecutive unreadable streamed responses re-issued before giving up. */
const MAX_UNREADABLE_RETRIES = 2

const NOT_CONFIGURED_TEXT =
  'The AI assistant is not configured yet — an administrator needs to set ANTHROPIC_API_KEY (or OPENAI_API_KEY for an OpenAI-compatible endpoint).'
const REFUSAL_TEXT = 'I can’t help with that request.'
const TOO_LONG_TEXT = 'That answer was too long for one message. Ask me for a shorter version.'
const CONTEXT_FULL_TEXT = 'This conversation is too long. Start a new thread.'
const ITERATION_LIMIT_TEXT =
  'I hit my tool-use limit for one message — ask me to continue and I’ll pick up from here.'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentLoopResult {
  text: string
  toolTrace: { name: string; ok: boolean }[]
}

interface AgentLoopInput {
  system: string
  history: ChatTurn[]
  userMessage: string
  tools: OpsTool[]
  ctx: ToolContext
  run: OpsRun
}

export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const config = resolveLlmProvider()
  if (!config.configured || !config.provider) {
    return {
      text: config.configurationError
        ? `The AI assistant is not configured correctly — ${config.configurationError}.`
        : NOT_CONFIGURED_TEXT,
      toolTrace: [],
    }
  }
  return config.provider === 'anthropic' ? runAnthropicAgentLoop(input) : runOpenAiAgentLoop(input)
}

/**
 * Run one requested tool. Unknown tools and handler failures become error
 * results the model can read; results are JSON, capped in size.
 */
async function executeTool(
  tools: OpsTool[],
  ctx: ToolContext,
  name: string,
  readInput: () => unknown
): Promise<{ content: string; ok: boolean }> {
  const tool = tools.find((t) => t.name === name)
  if (!tool) return { content: `Unknown tool: ${name}`, ok: false }
  try {
    const result = await tool.handler(ctx, readInput())
    return { content: JSON.stringify(result ?? null).slice(0, TOOL_RESULT_MAX_CHARS), ok: true }
  } catch (err) {
    return { content: `Tool error: ${err instanceof Error ? err.message : 'failed'}`, ok: false }
  }
}

// ---------------------------------------------------------------------------
// Anthropic (default provider)
// ---------------------------------------------------------------------------

/**
 * Persisted chat history is plain text (no thinking or tool blocks), so it
 * replays as simple turns. The first message must be from the user, so
 * leading assistant turns (possible after HISTORY_LIMIT slicing) are dropped,
 * as are empty turns. Consecutive same-role turns are allowed (the API merges
 * them).
 */
function toAnthropicHistory(history: ChatTurn[], userMessage: string): BetaMessageParam[] {
  const turns = history.filter((turn) => turn.content.trim().length > 0)
  const firstUser = turns.findIndex((turn) => turn.role === 'user')
  const kept = firstUser === -1 ? [] : turns.slice(firstUser)
  return [
    ...kept.map((turn): BetaMessageParam => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: userMessage },
  ]
}

/** Answer text is every text block joined as-is (citations split one answer into several). */
function textOf(content: BetaContentBlock[]): string {
  return content
    .filter((block): block is Extract<BetaContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

/** Audit detail for a failed model call: error type, status and request id only. */
function failureDetail(err: unknown): Record<string, unknown> {
  if (err instanceof Anthropic.APIError) {
    return {
      error: err.type ?? (err.status ? 'api_error' : 'connection_error'),
      status: err.status ?? null,
      request_id: err.requestID ?? null,
    }
  }
  return { error: 'unreadable_response' }
}

async function runAnthropicAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const toolTrace: { name: string; ok: boolean }[] = []
  const client = getAnthropicClient()
  const model = anthropicModel()
  // `system`, `tools` and earlier messages stay byte-identical for the whole
  // loop (append-only), which keeps preserved thinking valid and the prompt
  // cache warm across tool turns.
  const tools = input.tools.map(toAnthropicTool)
  const messages = toAnthropicHistory(input.history, input.userMessage)
  // Text of the current assistant turn, carried across pause_turn resumptions.
  let turnText = ''
  let unreadableRetries = 0

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const stepName = `assistant:turn:${iteration + 1}`
    const promptHash = hashPrompt(input.system, JSON.stringify(messages.at(-1)?.content ?? ''))

    let message: BetaMessage
    try {
      message = await client.beta.messages
        .stream({
          model,
          max_tokens: ANTHROPIC_MAX_TOKENS,
          system: input.system,
          // Thinking is adaptive and always on for the default model; never
          // send `thinking`, sampling parameters, a forced tool_choice
          // (default auto) or an assistant prefill.
          output_config: { effort: OPS_PURPOSE_EFFORT.assistant },
          cache_control: { type: 'ephemeral' },
          tools,
          messages,
          ...anthropicFallbackParams(),
        })
        .finalMessage()
    } catch (err) {
      await input.run.logLlm({
        name: `${stepName}:error`,
        purpose: 'assistant',
        model,
        promptHash,
        detail: failureDetail(err),
      })
      if (err instanceof Anthropic.APIError) throw err
      // The stream could not be read (for example tool input that is not
      // JSON). The SDK's message can quote model output, so it never leaves
      // this function; re-issue the same request a bounded number of times.
      if (unreadableRetries++ < MAX_UNREADABLE_RETRIES) continue
      throw new Error('The AI response could not be read. Please try again.')
    }
    unreadableRetries = 0

    const usage = anthropicUsageTokens(message.usage)
    await input.run.logLlm({
      name: stepName,
      purpose: 'assistant',
      model: message.model,
      promptHash,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      detail: {
        stop_reason: message.stop_reason,
        ...(message.stop_reason === 'refusal' && message.stop_details
          ? { refusal_category: message.stop_details.category }
          : {}),
      },
    })

    // Refusal and truncation are checked before any tool runs: a refusal or
    // max_tokens can cut a tool_use block off mid-input.
    if (message.stop_reason === 'refusal') return { text: REFUSAL_TEXT, toolTrace }
    if (message.stop_reason === 'max_tokens') return { text: TOO_LONG_TEXT, toolTrace }
    if (message.stop_reason === 'model_context_window_exceeded') {
      return { text: CONTEXT_FULL_TEXT, toolTrace }
    }

    // After a mid-output refusal fallback, the declined model's blocks are
    // not sent back (and its tool calls are never run).
    const assistantContent = echoableAssistantContent(message.content)
    turnText += textOf(message.content)

    if (message.stop_reason === 'pause_turn') {
      // Resume the paused turn: resend it as-is, with no extra user message.
      messages.push({ role: 'assistant', content: assistantContent })
      continue
    }

    const toolUses = assistantContent.filter(
      (block: BetaContentBlockParam): block is BetaToolUseBlockParam => block.type === 'tool_use'
    )
    if (message.stop_reason !== 'tool_use' || toolUses.length === 0) {
      return { text: turnText.trim() || 'Done.', toolTrace }
    }

    // Echo the full assistant turn (thinking blocks included, unmodified),
    // then answer every tool call in ONE user message of tool_result blocks.
    messages.push({ role: 'assistant', content: assistantContent })
    const results: BetaToolResultBlockParam[] = []
    for (const toolUse of toolUses) {
      const outcome = await executeTool(input.tools, input.ctx, toolUse.name, () => toolUse.input)
      toolTrace.push({ name: toolUse.name, ok: outcome.ok })
      await input.run.log(`assistant:tool:${toolUse.name}`, { ok: outcome.ok })
      results.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: outcome.content,
        ...(outcome.ok ? {} : { is_error: true }),
      })
    }
    messages.push({ role: 'user', content: results })
    turnText = ''
  }

  return { text: ITERATION_LIMIT_TEXT, toolTrace }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible adapter (optional; LLM_PROVIDER=openai or OPENAI_API_KEY only)
// ---------------------------------------------------------------------------

interface OpenAiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAiAssistantMessage {
  role: 'assistant'
  content: string | null
  refusal?: string | null
  tool_calls?: OpenAiToolCall[]
}

type ChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | OpenAiAssistantMessage
  | { role: 'tool'; tool_call_id: string; content: string }

async function runOpenAiAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const toolTrace: { name: string; ok: boolean }[] = []
  const model = openAiModel()

  const apiTools = input.tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }))

  const messages: ChatMessage[] = [
    { role: 'system', content: input.system },
    ...input.history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: input.userMessage },
  ]

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const data = (await postOpenAiChatCompletion({
      model,
      max_completion_tokens: OPENAI_MAX_TOKENS,
      messages,
      tools: apiTools,
    })) as {
      model?: string
      choices?: { message?: OpenAiAssistantMessage; finish_reason?: string }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }

    await input.run.logLlm({
      name: `assistant:turn:${iteration + 1}`,
      purpose: 'assistant',
      model: data.model ?? model,
      promptHash: hashPrompt(input.system, JSON.stringify(messages.at(-1)?.content ?? '')),
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
    })

    const choice = data.choices?.[0]
    const message = choice?.message
    if (!message || message.refusal || choice?.finish_reason === 'content_filter') {
      return { text: REFUSAL_TEXT, toolTrace }
    }

    const toolCalls = message.tool_calls ?? []
    if (toolCalls.length === 0) {
      return { text: message.content || 'Done.', toolTrace }
    }

    // Execute every requested tool and answer each call with a tool message.
    messages.push(message)
    for (const toolCall of toolCalls) {
      const outcome = await executeTool(input.tools, input.ctx, toolCall.function.name, () =>
        toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {}
      )
      toolTrace.push({ name: toolCall.function.name, ok: outcome.ok })
      await input.run.log(`assistant:tool:${toolCall.function.name}`, { ok: outcome.ok })
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: outcome.content })
    }
  }

  return { text: ITERATION_LIMIT_TEXT, toolTrace }
}
