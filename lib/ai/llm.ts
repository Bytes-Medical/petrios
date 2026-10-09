/**
 * Server-side LLM boundary. The single entry point for AI inference in the
 * app — nothing else may call an LLM provider API except the Petrios Ops
 * tool-use loop in lib/ops/agent-loop.ts, which needs raw tool-call
 * messages. lib/ai/provider.ts builds the Anthropic client (no calls) and
 * lib/ai/anthropic-files.ts handles Files API uploads/deletes (no inference).
 *
 * Provider (lib/ai/provider.ts → resolveLlmProvider): LLM_PROVIDER pin, else
 * ANTHROPIC_API_KEY → Anthropic (default), else OPENAI_API_KEY → the
 * OpenAI-compatible adapter, else unconfigured (every feature degrades).
 *
 * Anthropic (official SDK, default model claude-opus-5-5 / ANTHROPIC_MODEL):
 *   - every call streams through the beta Messages endpoint (refusal
 *     fallbacks: `fallbacks: 'default'` + server-side-fallback-2026-07-01);
 *   - adaptive thinking is always on (the `thinking` field is never sent);
 *     effort is always explicit in output_config; no prefill, no sampling
 *     parameters, no forced tool_choice;
 *   - documents go through the Files API one at a time (PDF bytes streamed;
 *     DOCX/PPTX converted to plain text first), are referenced by file_id,
 *     and are deleted in `finally`;
 *   - recap research uses the web_search_20260209 server tool called
 *     directly with a domain allow-list; pause_turn resumes the same turn.
 *
 * OpenAI-compatible adapter (optional, for self-hosters): Chat Completions
 * and Responses file inputs over fetch, unchanged from the previous
 * implementation. OPENAI_API_KEY, OPENAI_MODEL (default gpt-5.5),
 * OPENAI_BASE_URL (Azure OpenAI, a gateway, or an in-network model).
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaRequestDocumentBlock,
  BetaServerToolUseBlock,
  BetaToolUnion,
  BetaWebSearchTool20260209,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import {
  deleteAnthropicFiles,
  textUploadSource,
  uploadAnthropicFile,
  type AnthropicUploadSource,
} from './anthropic-files'
import { extractOfficeText, officeKindForMime } from './office-text'
import {
  activeLlmProvider,
  addTokenUsage,
  anthropicFallbackParams,
  anthropicModel,
  anthropicUsageTokens,
  echoableAssistantContent,
  getAnthropicClient,
  openAiModel,
  type LlmTokenUsage,
} from './provider'
import {
  streamedBodyRedirectMode,
  streamJsonWithFileData,
  type LlmFileInput,
} from './streaming-body'

export type { LlmFileInput } from './streaming-body'
export { activeLlmProvider, isLlmConfigured, llmModel } from './provider'

export type LlmEffort = 'low' | 'medium' | 'high'

/** Token counts for the audit trail (Anthropic: cache reads/writes count as input). */
export type LlmUsage = LlmTokenUsage

export interface LlmResult {
  text: string | null
  usage: LlmUsage
  /** The model that served the response (a refusal fallback can differ from the configured one). */
  model: string
  /** Public web sources returned by a provider-hosted search, if requested. */
  sources: LlmSource[]
  /** Hosted web searches the provider ran for this result (0 when none). */
  webSearchRequests: number
  /** Search error codes the provider reported in-band (logging only; never fatal by themselves). */
  webSearchErrors?: string[]
}

export interface LlmSource {
  url: string
  title: string
}

export interface LlmWebSearchOptions {
  /** Authoritative domains the hosted search is permitted to consult. */
  allowedDomains: readonly string[]
  /** OpenAI-compatible adapter only. */
  searchContextSize?: 'low' | 'medium' | 'high'
  /** Anthropic only: cap on searches per request (default 6). */
  maxUses?: number
  userLocation?: {
    country?: string
    city?: string
    region?: string
    timezone?: string
  }
  /**
   * Require research. OpenAI: tool_choice 'required'. Anthropic: a fixed
   * system instruction (forced tool_choice is rejected by the model); the
   * caller checks webSearchRequests/sources afterwards.
   */
  required?: boolean
}

/**
 * Describes a provider failure for logs and the Ops audit: error class, HTTP
 * status, API error type and request id when known, and the message capped
 * at 300 chars. The API error type survives a minified server bundle (class
 * names may not). Provider error bodies do not echo request content.
 *
 * An SDK failure that is not an HTTP error (the response stream could not be
 * read or parsed) is described only as `unreadable_response`: its message can
 * quote model output, such as the JSON of a web_search query the model wrote
 * from private documents.
 */
export function describeLlmError(error: unknown): string {
  const name = error instanceof Error ? error.constructor.name : typeof error
  const unreadable = [error, error instanceof Error ? error.cause : undefined].find(
    (candidate) => candidate instanceof Anthropic.AnthropicError && !(candidate instanceof Anthropic.APIError)
  )
  if (unreadable) {
    const inner = unreadable !== error ? ` (${(unreadable as Error).constructor.name})` : ''
    return `${name}${inner}: unreadable_response`
  }

  const api = error instanceof Anthropic.APIError
    ? error
    : error instanceof Error && error.cause instanceof Anthropic.APIError
      ? error.cause
      : null
  const cause = api && api !== error ? ` (${api.constructor.name})` : ''
  const status = api?.status ? ` ${api.status}` : ''
  const requestId = api?.requestID ? ` request_id=${api.requestID}` : ''
  const type = api?.type ? ` type=${api.type}` : ''
  const message = error instanceof Error ? error.message : String(error)
  return `${name}${cause}${status}${requestId}${type}: ${message.slice(0, 300)}`
}

// ===================================================================
// Provider dispatch
// ===================================================================

/**
 * One system+user completion, reporting token usage and the model that
 * served the request (the Petrios Ops gateway records both in its audit
 * trail). Returns null when no provider is configured; throws on API errors,
 * refusals and truncated output so callers can degrade per-item.
 */
export async function askLlmWithUsage(input: {
  system: string
  prompt: string
  maxTokens?: number
  /** Explicit effort (OpenAI: reasoning_effort, as before). */
  effort?: LlmEffort
  /** Anthropic only: used when `effort` is omitted (the API default would otherwise apply). */
  defaultEffort?: LlmEffort
  /** OpenAI: json_object mode. Anthropic: no request change (callers validate the JSON). */
  jsonMode?: boolean
}): Promise<LlmResult | null> {
  const provider = activeLlmProvider()
  if (provider === 'anthropic') return anthropicAskWithUsage(input)
  if (provider === 'openai') return openAiAskWithUsage(input)
  return null
}

export async function askLlm(input: {
  system: string
  prompt: string
  maxTokens?: number
  effort?: LlmEffort
}): Promise<string | null> {
  const result = await askLlmWithUsage(input)
  return result?.text ?? null
}

/**
 * File-backed completion for private learning documents (PDF/DOCX/PPTX),
 * optionally with hosted research. Documents are read from storage one at a
 * time; any failure or abort cancels the read in flight. Returns null when
 * no provider is configured.
 */
export async function askLlmWithFileInputs(input: {
  system: string
  prompt: string
  files: LlmFileInput[]
  maxTokens?: number
  /** Anthropic only (the OpenAI file request is unchanged and sends no effort). */
  effort?: LlmEffort
  defaultEffort?: LlmEffort
  webSearch?: LlmWebSearchOptions
  signal?: AbortSignal
}): Promise<LlmResult | null> {
  const provider = activeLlmProvider()
  if (!provider) return null
  if (input.files.length === 0) throw new Error('At least one document is required')
  return provider === 'anthropic'
    ? anthropicAskWithFileInputs(input)
    : openAiAskWithFileInputs(input)
}

// ===================================================================
// Anthropic adapter
// ===================================================================

const DEFAULT_EFFORT: LlmEffort = 'medium'
const DEFAULT_MAX_TOKENS = 8192
const MAX_TOKENS_CEILING = 64_000
/** Thinking counts toward max_tokens (billed only as used), so higher effort gets more room. */
const MAX_TOKENS_FLOOR: Record<LlmEffort, number> = {
  low: 8192,
  medium: 16_384,
  high: 32_768,
}
export const ANTHROPIC_MAX_PAUSE_CONTINUATIONS = 5
const DEFAULT_WEB_SEARCH_MAX_USES = 6
const MAX_SOURCES = 20

export const ANTHROPIC_RESEARCH_REQUIRED_SUFFIX =
  '\n\nBefore writing, use the web_search tool at least once to check current UK guidance relevant to the attached documents.'

const OFFICE_TEXT_CONTEXT =
  'Plain text extracted from the original Office document; images, layout and embedded objects are not included.'

const DOCUMENTS_REJECTED =
  'The AI provider rejected this request (the documents may exceed its 600-page or context limits, a file could not be read, or web search is not enabled for the workspace). Archive some documents or check the AI configuration, then try again.'

export function anthropicMaxTokens(effort: LlmEffort, requested?: number): number {
  return Math.min(MAX_TOKENS_CEILING, Math.max(requested ?? DEFAULT_MAX_TOKENS, MAX_TOKENS_FLOOR[effort]))
}

interface AnthropicTurn {
  /** Every response of the turn (pause_turn continuations included), in order. */
  messages: BetaMessage[]
  text: string | null
  usage: LlmTokenUsage
  model: string
  webSearchRequests: number
  webSearchErrors: string[]
}

/** Throws for every stop reason other than a complete answer; partial content is discarded. */
function assertCompleted(message: BetaMessage): void {
  switch (message.stop_reason) {
    case 'end_turn':
    case 'stop_sequence':
      return
    case 'refusal':
      // Informational only; never branch on the category.
      console.warn(`[ai] request declined (category: ${message.stop_details?.category ?? 'unspecified'})`)
      throw new Error('The AI assistant declined this request.')
    case 'max_tokens':
      throw new Error('The AI response was cut off before it finished (max_tokens).')
    case 'model_context_window_exceeded':
      throw new Error('The AI request was too large for the model context window.')
    case 'tool_use':
      throw new Error('The AI response requested an unexpected tool call.')
    default:
      throw new Error('The AI response ended unexpectedly.')
  }
}

/**
 * One assistant turn: streams the request, resumes `pause_turn` (server tools
 * only) by echoing the paused content with the same tools and no extra user
 * message, then applies the stop-reason rules to the final response.
 */
async function runAnthropicTurn(input: {
  client: Anthropic
  system: string
  content: string | BetaContentBlockParam[]
  effort: LlmEffort
  maxTokens?: number
  tools?: BetaToolUnion[]
  cache?: boolean
  signal?: AbortSignal
}): Promise<AnthropicTurn> {
  const base: Omit<BetaMessageStreamParams, 'messages'> = {
    model: anthropicModel(),
    max_tokens: anthropicMaxTokens(input.effort, input.maxTokens),
    system: input.system,
    output_config: { effort: input.effort },
    ...(input.cache ? { cache_control: { type: 'ephemeral' } } : {}),
    ...(input.tools ? { tools: input.tools } : {}),
    ...anthropicFallbackParams(),
  }
  const messages: BetaMessageParam[] = [{ role: 'user', content: input.content }]
  const chain: BetaMessage[] = []
  for (let continuation = 0; ; continuation++) {
    const message = await input.client.beta.messages
      .stream({ ...base, messages: [...messages] }, { signal: input.signal })
      .finalMessage()
    chain.push(message)
    if (message.stop_reason !== 'pause_turn' || !input.tools) break
    if (continuation >= ANTHROPIC_MAX_PAUSE_CONTINUATIONS) {
      throw new Error('The AI research step did not finish (pause_turn limit).')
    }
    messages.push({ role: 'assistant', content: echoableAssistantContent(message.content) })
  }

  const last = chain[chain.length - 1]
  assertCompleted(last)

  const blocks = chain.flatMap((message) => message.content)
  const webSearchErrors: string[] = []
  for (const block of blocks) {
    if (block.type === 'web_search_tool_result' && !Array.isArray(block.content)) {
      webSearchErrors.push(block.content.error_code)
    }
  }
  if (webSearchErrors.length > 0) {
    console.warn(`[ai] web search reported error codes: ${webSearchErrors.join(', ')}`)
  }
  return {
    messages: chain,
    text: answerText(blocks),
    usage: chain.reduce<LlmTokenUsage>(
      (total, message) => addTokenUsage(total, anthropicUsageTokens(message.usage)),
      { inputTokens: 0, outputTokens: 0 }
    ),
    model: last.model,
    webSearchRequests: Math.max(
      chain.reduce(
        (total, message) => total + (message.usage.server_tool_use?.web_search_requests ?? 0),
        0
      ),
      completedWebSearches(blocks)
    ),
    webSearchErrors,
  }
}

/**
 * The answer is the text written after the turn's last server-tool result.
 * Text before or between searches is the model's working notes ("Checking
 * current guidance…"), which must not reach a recap script that is read
 * aloud. Without any tool result this is every text block. Citations split
 * one answer into many text blocks, so they are joined without separators;
 * thinking and fallback blocks in between are ignored (after a mid-output
 * refusal fallback the declined partial text and its continuation form one
 * answer).
 */
function answerText(blocks: BetaContentBlock[]): string | null {
  const lastResult = blocks.findLastIndex((block) => block.type.endsWith('_tool_result'))
  const text = blocks
    .slice(lastResult + 1)
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim()
  return text || null
}

/**
 * Searches that actually returned results, counted from content: a
 * web_search server_tool_use with its matching result list. Usage counters
 * only cover the attempt that produced the returned message, so after a
 * refusal fallback the declined attempt's searches (whose blocks stay in
 * content and are not re-run) would otherwise not be counted.
 */
function completedWebSearches(blocks: BetaContentBlock[]): number {
  const searches = new Set(
    blocks
      .filter((block): block is BetaServerToolUseBlock =>
        block.type === 'server_tool_use' && block.name === 'web_search')
      .map((block) => block.id)
  )
  return blocks.filter(
    (block) => block.type === 'web_search_tool_result'
      && Array.isArray(block.content)
      && searches.has(block.tool_use_id)
  ).length
}

function turnResult(turn: AnthropicTurn, sources: LlmSource[]): LlmResult {
  return {
    text: turn.text,
    usage: turn.usage,
    model: turn.model,
    sources,
    webSearchRequests: turn.webSearchRequests,
    ...(turn.webSearchErrors.length > 0 ? { webSearchErrors: turn.webSearchErrors } : {}),
  }
}

async function anthropicAskWithUsage(input: {
  system: string
  prompt: string
  maxTokens?: number
  effort?: LlmEffort
  defaultEffort?: LlmEffort
}): Promise<LlmResult> {
  const turn = await runAnthropicTurn({
    client: getAnthropicClient(),
    system: input.system,
    content: input.prompt,
    effort: input.effort ?? input.defaultEffort ?? DEFAULT_EFFORT,
    maxTokens: input.maxTokens,
  })
  return turnResult(turn, [])
}

function anthropicWebSearchTool(options: LlmWebSearchOptions): BetaWebSearchTool20260209 {
  return {
    type: 'web_search_20260209',
    name: 'web_search',
    // Direct calls: no dynamic filtering, so no code-execution container and
    // the search step stays eligible for zero data retention.
    allowed_callers: ['direct'],
    allowed_domains: [...options.allowedDomains],
    max_uses: options.maxUses ?? DEFAULT_WEB_SEARCH_MAX_USES,
    ...(options.userLocation
      ? { user_location: { type: 'approximate', ...options.userLocation } }
      : {}),
  }
}

/** PDFs upload as their verified bytes; DOCX/PPTX as extracted plain text. */
async function anthropicUploadSource(file: LlmFileInput, signal: AbortSignal): Promise<AnthropicUploadSource> {
  const office = officeKindForMime(file.mimeType)
  if (office) return textUploadSource(await extractOfficeText(file, office, signal))
  if (file.mimeType === 'application/pdf') {
    return { kind: 'pdf', open: (attemptSignal) => file.open(attemptSignal) }
  }
  throw new Error(`Document "${file.filename}" has a type the AI provider cannot read`)
}

async function anthropicAskWithFileInputs(input: {
  system: string
  prompt: string
  files: LlmFileInput[]
  maxTokens?: number
  effort?: LlmEffort
  defaultEffort?: LlmEffort
  webSearch?: LlmWebSearchOptions
  signal?: AbortSignal
}): Promise<LlmResult> {
  const client = getAnthropicClient()
  const done = new AbortController()
  const signal = input.signal ? AbortSignal.any([input.signal, done.signal]) : done.signal
  const uploaded: string[] = []
  try {
    // Sequential: at most one document is being read or uploaded at a time.
    const documents: BetaRequestDocumentBlock[] = []
    for (const file of input.files) {
      const source = await anthropicUploadSource(file, signal)
      const metadata = await uploadAnthropicFile(client, source, signal)
      uploaded.push(metadata.id)
      documents.push({
        type: 'document',
        source: { type: 'file', file_id: metadata.id },
        // The newsletter manifest refers to documents by this exact name.
        title: file.filename,
        ...(source.kind === 'text' ? { context: OFFICE_TEXT_CONTEXT } : {}),
      })
    }

    let turn: AnthropicTurn
    try {
      turn = await runAnthropicTurn({
        client,
        system: input.webSearch?.required
          ? `${input.system}${ANTHROPIC_RESEARCH_REQUIRED_SUFFIX}`
          : input.system,
        // Documents first, instructions last.
        content: [...documents, { type: 'text', text: input.prompt }],
        effort: input.effort ?? input.defaultEffort ?? DEFAULT_EFFORT,
        maxTokens: input.maxTokens,
        tools: input.webSearch ? [anthropicWebSearchTool(input.webSearch)] : undefined,
        cache: true,
        signal,
      })
    } catch (error) {
      if (error instanceof Anthropic.BadRequestError) throw new Error(DOCUMENTS_REJECTED, { cause: error })
      throw error
    }
    return turnResult(turn, collectAnthropicSources(turn.messages, input.webSearch?.allowedDomains))
  } finally {
    done.abort()
    // No request signal here (it is aborted by now); deletion has its own timeout.
    await deleteAnthropicFiles(client, uploaded)
  }
}

function hostAllowed(url: string, allowedDomains: readonly string[]): boolean {
  const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '')
  return allowedDomains.some((entry) => {
    const domain = entry.toLowerCase().split('/')[0]
    return host === domain || host.endsWith(`.${domain}`)
  })
}

/**
 * Research sources for the existing Audio Recap storage (url + title only):
 * cited web results first (order of first appearance), then every search
 * result consulted. http(s) only, restricted to the allow-list (defence in
 * depth), de-duplicated, capped at 20. cited_text and encrypted fields are
 * never kept.
 */
function collectAnthropicSources(
  messages: BetaMessage[],
  allowedDomains: readonly string[] | undefined
): LlmSource[] {
  const cited: Array<{ url?: string; title?: string }> = []
  const searched: Array<{ url?: string; title?: string }> = []
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text') {
        for (const citation of block.citations ?? []) {
          if (citation.type === 'web_search_result_location') {
            cited.push({ url: citation.url, title: citation.title ?? undefined })
          }
        }
      } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const result of block.content) searched.push({ url: result.url, title: result.title })
      }
    }
  }
  const sources = new Map<string, LlmSource>()
  for (const candidate of [...cited, ...searched]) {
    const source = normaliseSource(candidate)
    if (!source || sources.has(source.url)) continue
    if (allowedDomains && !hostAllowed(source.url, allowedDomains)) continue
    sources.set(source.url, source)
    if (sources.size >= MAX_SOURCES) break
  }
  return [...sources.values()]
}

// ===================================================================
// OpenAI-compatible adapter (optional; unchanged request shapes)
// ===================================================================

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
const OPENAI_ENDPOINT = `${OPENAI_BASE_URL}/chat/completions`
const OPENAI_RESPONSES_ENDPOINT = `${OPENAI_BASE_URL}/responses`

/**
 * Shared POST to the chat-completions endpoint (auth, error shaping). Also
 * used by the OpenAI branch of the Petrios Ops tool-use loop — the one
 * sanctioned caller outside this module.
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
    if (sources.size >= MAX_SOURCES) break
  }
  return [...sources.values()]
}

interface FileInputRequest {
  system: string
  prompt: string
  files: LlmFileInput[]
  maxTokens?: number
  webSearch?: LlmWebSearchOptions
}

function responsesFileInputBody(input: FileInputRequest, fileData: (index: number) => string) {
  return {
    model: openAiModel(),
    instructions: input.system,
    max_output_tokens: input.maxTokens ?? 8192,
    // Responses defaults to storing the response and its input items (the
    // documents) as retrievable application state; nothing here reads them back.
    store: false,
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
        ...input.files.map((file, index) => ({
          type: 'input_file',
          filename: file.filename,
          file_data: fileData(index),
          ...(file.mimeType === 'application/pdf' ? { detail: 'auto' } : {}),
        })),
        { type: 'input_text', text: input.prompt },
      ],
    }],
  }
}

/**
 * Responses API path for private document inputs. This stays separate from
 * the ordinary Chat Completions adapter because `input_file` is a multimodal
 * request shape and compatible custom endpoints may support chat without
 * supporting file-backed Responses calls.
 *
 * The body is streamed (chunked transfer encoding): each document is read
 * from storage and base64-encoded while the request uploads, so memory does
 * not grow with document size. Every call re-opens the documents, and any
 * failure or abort cancels the storage read in flight.
 */
async function openAiAskWithFileInputs(input: FileInputRequest & {
  signal?: AbortSignal
}): Promise<LlmResult> {
  const done = new AbortController()
  const signal = input.signal ? AbortSignal.any([input.signal, done.signal]) : done.signal
  const body = streamJsonWithFileData(
    (fileData) => responsesFileInputBody(input, fileData),
    input.files,
    signal
  )
  try {
    return await sendFileInputRequest(body.stream, signal, body.failure)
  } finally {
    done.abort()
  }
}

async function sendFileInputRequest(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  bodyFailure: () => unknown
): Promise<LlmResult> {
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body,
    // Node's fetch requires half duplex for a stream body.
    duplex: 'half',
    redirect: streamedBodyRedirectMode(),
    // Stops Next's fetch cache from reading the whole body to build a cache key.
    cache: 'no-store',
    signal,
  }
  let response: Response
  try {
    response = await fetch(OPENAI_RESPONSES_ENDPOINT, init)
  } catch (error) {
    throw bodyFailure() ?? error
  }
  // A body that failed (storage or integrity) never completed the JSON, so
  // nothing the endpoint returned can be accepted.
  const failure = bodyFailure()
  if (failure !== undefined) {
    await response.body?.cancel()
    throw failure
  }

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
    model: data.model ?? openAiModel(),
    sources: responseSources(data.output),
    webSearchRequests: (data.output ?? []).filter((item) => item.type === 'web_search_call').length,
  }
}

async function openAiAskWithUsage(input: {
  system: string
  prompt: string
  maxTokens?: number
  effort?: LlmEffort
  jsonMode?: boolean
}): Promise<LlmResult> {
  const data = (await postOpenAiChatCompletion({
    model: openAiModel(),
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
    model: data.model ?? openAiModel(),
    sources: [],
    webSearchRequests: 0,
  }
}
