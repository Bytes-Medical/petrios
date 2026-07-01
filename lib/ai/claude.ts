import Anthropic from '@anthropic-ai/sdk'

/**
 * Server-side Claude client. Uses Claude Fable 5 with a server-side fallback
 * to Opus 4.8: Fable's safety classifiers can false-positive on benign
 * clinical content, and the fallback transparently re-serves the request on
 * Opus inside the same call instead of failing it.
 */
export const CLAUDE_MODEL = 'claude-fable-5'
const FALLBACK_MODEL = 'claude-opus-4-8'

export function isClaudeConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

export async function askClaude(input: {
  system: string
  prompt: string
  maxTokens?: number
  effort?: 'low' | 'medium' | 'high'
}): Promise<string | null> {
  if (!isClaudeConfigured()) return null

  const client = new Anthropic()

  const response = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: input.maxTokens ?? 8192,
    betas: ['server-side-fallback-2026-06-01'],
    fallbacks: [{ model: FALLBACK_MODEL }],
    ...(input.effort ? { output_config: { effort: input.effort } } : {}),
    system: input.system,
    messages: [{ role: 'user', content: input.prompt }],
  })

  // A refusal here means both Fable and the Opus fallback declined.
  if (response.stop_reason === 'refusal') {
    throw new Error('The AI assistant declined this request.')
  }

  let text = ''
  for (const block of response.content) {
    if (block.type === 'text') text += block.text
  }
  return text || null
}
