import { createHash } from 'node:crypto'
import type { ZodType } from 'zod'
import {
  askLlmWithFileInputs,
  askLlmWithUsage,
  LLM_MODEL,
  isLlmConfigured,
  type LlmFileInput,
  type LlmResult,
  type LlmWebSearchOptions,
} from '@/lib/ai/llm'
import { opsEnabled } from './flags'
import type { OpsRun } from './run'

/**
 * The single inference choke point for Petrios Ops. Every LLM call the agent
 * layer makes goes through opsInference: the purpose must be on the
 * allow-list below, and each call writes an audit step (purpose, model,
 * sha256 prompt hash, token counts — never the raw prompt text) to the run
 * it belongs to. The assistant's tool-use loop (lib/ops/agent-loop.ts) is
 * the one other sanctioned caller of the OpenAI API, because tool calling
 * needs the raw message stream.
 */

const OPS_PURPOSES = [
  'feedback_synthesis',
  'email_draft',
  'newsletter',
  'low_score_digest',
  'recall_questions',
  'audio_recap',
  'assistant',
] as const

export type OpsPurpose = (typeof OPS_PURPOSES)[number]

export function hashPrompt(system: string, prompt: string): string {
  return createHash('sha256').update(system).update('\0').update(prompt).digest('hex')
}

/** Pull the first JSON object/array out of a model reply (tolerates fences/prose). */
export function extractJson(text: string): string | null {
  const start = text.search(/[[{]/)
  if (start === -1) return null
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  const end = text.lastIndexOf(close)
  if (end <= start) return null
  return text.slice(start, end + 1)
}

const JSON_INSTRUCTION =
  'Respond with ONLY a single valid JSON value matching the requested shape. No markdown fences, no commentary.'

/**
 * Run one gated inference. Returns the parsed value (when `schema` is given)
 * or the raw text, or null when the configured model is unavailable, declines, or the
 * output fails validation twice — callers treat null as "skip this item".
 * Throws only on misuse: ops disabled or unknown purpose.
 */
export async function opsInference<T = string>(input: {
  purpose: OpsPurpose
  system: string
  prompt: string
  maxTokens?: number
  effort?: 'low' | 'medium' | 'high'
  schema?: ZodType<T>
  run?: OpsRun
  stepName?: string
  /** Private files are sent only for an explicitly file-backed Ops purpose. */
  files?: LlmFileInput[]
  /** Optional hosted research configuration; currently recap-only. */
  webSearch?: LlmWebSearchOptions
  /** Allows the caller to retain citations without bypassing this gateway. */
  onResult?: (result: LlmResult) => void
}): Promise<T | null> {
  if (!opsEnabled()) {
    throw new Error('Petrios Ops is disabled (OPS_ENABLED=false)')
  }
  if (!OPS_PURPOSES.includes(input.purpose)) {
    throw new Error(`Unknown ops inference purpose: ${input.purpose}`)
  }
  if (input.files?.length && !['audio_recap', 'newsletter'].includes(input.purpose)) {
    throw new Error('Private file inputs are allowed only for audio recap or newsletter generation')
  }
  if (input.webSearch && input.purpose !== 'audio_recap') {
    throw new Error('Hosted web search is allowed only for the audio_recap purpose')
  }
  if (input.webSearch && !input.files?.length) {
    throw new Error('Audio recap web search requires attached learning documents')
  }
  if (!isLlmConfigured()) return null

  const system = input.schema ? `${input.system}\n\n${JSON_INSTRUCTION}` : input.system

  const attempt = async (prompt: string, name: string): Promise<string | null> => {
    const fileFingerprint = input.files?.length
      ? `\nfiles:\n${input.files.map((file) => `${file.filename}:${file.sha256}`).join('\n')}`
      : ''
    const researchFingerprint = input.webSearch
      ? `\nweb_search:${JSON.stringify(input.webSearch)}`
      : ''
    const hash = hashPrompt(system, `${prompt}${fileFingerprint}${researchFingerprint}`)
    try {
      const result = input.files?.length
        ? await askLlmWithFileInputs({
            system,
            prompt,
            files: input.files,
            maxTokens: input.maxTokens,
            webSearch: input.webSearch,
          })
        : await askLlmWithUsage({
            system,
            prompt,
            maxTokens: input.maxTokens,
            effort: input.effort,
            jsonMode: !!input.schema,
          })
      await input.run?.logLlm({
        name,
        purpose: input.purpose,
        model: result?.model ?? LLM_MODEL,
        promptHash: hash,
        inputTokens: result?.usage.inputTokens,
        outputTokens: result?.usage.outputTokens,
      })
      if (result) input.onResult?.(result)
      return result?.text ?? null
    } catch (err) {
      // Refusal or API failure: audit it and let the caller skip this item
      // rather than abort the batch.
      console.error(`Ops inference failed (${input.purpose}):`, err)
      await input.run?.logLlm({
        name: `${name}:error`,
        purpose: input.purpose,
        model: LLM_MODEL,
        promptHash: hash,
        detail: { error: err instanceof Error ? err.message : String(err) },
      })
      return null
    }
  }

  const stepName = input.stepName ?? `llm:${input.purpose}`
  const text = await attempt(input.prompt, stepName)
  if (text === null) return null

  if (!input.schema) return text as unknown as T

  const parseAttempt = (raw: string): { ok: true; value: T } | { ok: false; error: string } => {
    const json = extractJson(raw)
    if (!json) return { ok: false, error: 'No JSON value found in response' }
    try {
      const parsed = input.schema!.safeParse(JSON.parse(json))
      if (parsed.success) return { ok: true, value: parsed.data }
      return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON' }
    }
  }

  const first = parseAttempt(text)
  if (first.ok) return first.value

  // One retry with the validation error attached — never trust partial parses.
  const retryText = await attempt(
    `${input.prompt}\n\nYour previous response was invalid: ${first.error}\nReturn ONLY corrected JSON.`,
    `${stepName}:retry`
  )
  if (retryText === null) return null

  const second = parseAttempt(retryText)
  if (second.ok) return second.value

  await input.run?.log(`${stepName}:invalid`, { error: second.error })
  return null
}
