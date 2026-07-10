import { LLM_MODEL, isLlmConfigured, postOpenAiChatCompletion } from '@/lib/ai/llm'
import { hashPrompt } from './gateway'
import type { OpsRun } from './run'
import type { OpsTool, ToolContext } from './tools'

/**
 * The assistant's tool-use loop. This is the ONE sanctioned OpenAI call site
 * outside lib/ai/llm.ts — tool calling needs the raw message stream, so it
 * can't go through askLlm. It still follows every gateway rule: audit steps
 * per model call (prompt hash + tokens, no raw text), refusal handling, and
 * a hard iteration cap.
 */

const MAX_ITERATIONS = 8
const MAX_TOKENS = 4096

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentLoopResult {
  text: string
  toolTrace: { name: string; ok: boolean }[]
}

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

export async function runAgentLoop(input: {
  system: string
  history: ChatTurn[]
  userMessage: string
  tools: OpsTool[]
  ctx: ToolContext
  run: OpsRun
}): Promise<AgentLoopResult> {
  if (!isLlmConfigured()) {
    return {
      text: 'The AI assistant is not configured yet — an administrator needs to set OPENAI_API_KEY.',
      toolTrace: [],
    }
  }

  const toolTrace: { name: string; ok: boolean }[] = []

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
      model: LLM_MODEL,
      max_completion_tokens: MAX_TOKENS,
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
      model: data.model ?? LLM_MODEL,
      promptHash: hashPrompt(input.system, JSON.stringify(messages.at(-1)?.content ?? '')),
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
    })

    const choice = data.choices?.[0]
    const message = choice?.message
    if (!message || message.refusal || choice?.finish_reason === 'content_filter') {
      return { text: 'I can’t help with that request.', toolTrace }
    }

    const toolCalls = message.tool_calls ?? []
    if (toolCalls.length === 0) {
      return { text: message.content || 'Done.', toolTrace }
    }

    // Execute every requested tool and answer each call with a tool message.
    messages.push(message)
    for (const toolCall of toolCalls) {
      const tool = input.tools.find((t) => t.name === toolCall.function.name)
      let resultContent: string
      let ok = false
      if (!tool) {
        resultContent = `Unknown tool: ${toolCall.function.name}`
      } else {
        try {
          const args: unknown = toolCall.function.arguments
            ? JSON.parse(toolCall.function.arguments)
            : {}
          const result = await tool.handler(input.ctx, args)
          resultContent = JSON.stringify(result).slice(0, 20000)
          ok = true
        } catch (err) {
          resultContent = `Tool error: ${err instanceof Error ? err.message : 'failed'}`
        }
      }
      toolTrace.push({ name: toolCall.function.name, ok })
      await input.run.log(`assistant:tool:${toolCall.function.name}`, { ok })
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: resultContent })
    }
  }

  return {
    text: 'I hit my tool-use limit for one message — ask me to continue and I’ll pick up from here.',
    toolTrace,
  }
}
