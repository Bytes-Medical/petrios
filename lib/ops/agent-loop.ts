import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_MODEL, isClaudeConfigured } from '@/lib/ai/claude'
import { hashPrompt } from './gateway'
import type { OpsRun } from './run'
import type { OpsTool, ToolContext } from './tools'

/**
 * The assistant's tool-use loop. This is the ONE sanctioned Anthropic call
 * site outside lib/ai/claude.ts — tool use needs the raw message stream, so
 * it can't go through askClaude. It still follows every gateway rule: audit
 * steps per model call (prompt hash + tokens, no raw text), refusal
 * handling, and a hard iteration cap.
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

export async function runAgentLoop(input: {
  system: string
  history: ChatTurn[]
  userMessage: string
  tools: OpsTool[]
  ctx: ToolContext
  run: OpsRun
}): Promise<AgentLoopResult> {
  if (!isClaudeConfigured()) {
    return {
      text: 'The AI assistant is not configured yet — an administrator needs to set ANTHROPIC_API_KEY.',
      toolTrace: [],
    }
  }

  const client = new Anthropic()
  const toolTrace: { name: string; ok: boolean }[] = []

  const apiTools = input.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Beta.BetaTool['input_schema'],
  }))

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...input.history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: 'user' as const, content: input.userMessage },
  ]

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const response = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      betas: ['server-side-fallback-2026-06-01'],
      fallbacks: [{ model: 'claude-opus-4-8' }],
      system: input.system,
      messages,
      tools: apiTools,
    })

    await input.run.logLlm({
      name: `assistant:turn:${iteration + 1}`,
      purpose: 'assistant',
      model: response.model ?? CLAUDE_MODEL,
      promptHash: hashPrompt(input.system, JSON.stringify(messages.at(-1)?.content ?? '')),
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
    })

    if (response.stop_reason === 'refusal') {
      return {
        text: 'I can’t help with that request.',
        toolTrace,
      }
    }

    const toolUses = response.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use'
    )

    if (toolUses.length === 0 || response.stop_reason !== 'tool_use') {
      let text = ''
      for (const block of response.content) {
        if (block.type === 'text') text += block.text
      }
      return { text: text || 'Done.', toolTrace }
    }

    // Execute every requested tool; return ALL results in ONE user message.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
    for (const toolUse of toolUses) {
      const tool = input.tools.find((t) => t.name === toolUse.name)
      let resultContent: string
      let ok = false
      if (!tool) {
        resultContent = `Unknown tool: ${toolUse.name}`
      } else {
        try {
          const result = await tool.handler(input.ctx, toolUse.input)
          resultContent = JSON.stringify(result).slice(0, 20000)
          ok = true
        } catch (err) {
          resultContent = `Tool error: ${err instanceof Error ? err.message : 'failed'}`
        }
      }
      toolTrace.push({ name: toolUse.name, ok })
      await input.run.log(`assistant:tool:${toolUse.name}`, { ok })
      results.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: resultContent,
        is_error: !ok,
      })
    }

    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: results })
  }

  return {
    text: 'I hit my tool-use limit for one message — ask me to continue and I’ll pick up from here.',
    toolTrace,
  }
}
