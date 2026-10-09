/**
 * Test-only helpers: build Anthropic Messages streaming (SSE) responses for a
 * fetch mock injected through getAnthropicClient({ fetch }). Never imported by
 * application code; no real API calls are made in tests.
 */

type Json = Record<string, unknown>

export interface MockMessage {
  model?: string
  content: Json[]
  stop_reason?: string | null
  stop_details?: Json | null
  usage?: Json
}

function sse(event: string, data: Json): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/** Serialize a complete message as the event sequence a streamed request returns. */
export function messageToSse(message: MockMessage): string {
  const usage = {
    input_tokens: 10,
    output_tokens: 5,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    server_tool_use: null,
    service_tier: 'standard',
    ...message.usage,
  }
  const events: string[] = [
    sse('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: message.model ?? 'claude-opus-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        stop_details: null,
        container: null,
        context_management: null,
        diagnostics: null,
        usage: { ...usage, output_tokens: 1 },
      },
    }),
  ]

  message.content.forEach((block, index) => {
    if (block.type === 'text') {
      events.push(sse('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '', citations: null },
      }))
      events.push(sse('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: block.text },
      }))
      for (const citation of (block.citations as Json[] | null | undefined) ?? []) {
        events.push(sse('content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'citations_delta', citation },
        }))
      }
    } else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
      events.push(sse('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { ...block, input: {} },
      }))
      events.push(sse('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) },
      }))
    } else {
      events.push(sse('content_block_start', { type: 'content_block_start', index, content_block: block }))
    }
    events.push(sse('content_block_stop', { type: 'content_block_stop', index }))
  })

  events.push(sse('message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: message.stop_reason ?? 'end_turn',
      stop_sequence: null,
      stop_details: message.stop_details ?? null,
    },
    usage,
  }))
  events.push(sse('message_stop', { type: 'message_stop' }))
  return events.join('')
}

export function sseResponse(message: MockMessage): Response {
  return new Response(messageToSse(message), {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'request-id': 'req_test' },
  })
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
  })
}

export interface RecordedRequest {
  url: string
  method: string
  headers: Headers
  cache: RequestCache
  redirect: RequestRedirect
  /** Raw request body text (multipart uploads are drained into this). */
  body: string
  /** Parsed JSON body, or null for non-JSON (e.g. multipart) bodies. */
  json: Json | null
}

/**
 * A fetch mock that answers each call with the next queued response and
 * records what was sent. Body streams are drained so upload code paths finish.
 */
export function queuedFetch(responses: Array<Response | ((request: RecordedRequest) => Response)>) {
  const requests: RecordedRequest[] = []
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const text = await request.text()
    let json: Json | null = null
    try {
      json = text ? (JSON.parse(text) as Json) : null
    } catch {
      json = null
    }
    const recorded: RecordedRequest = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      cache: request.cache,
      redirect: request.redirect,
      body: text,
      json,
    }
    requests.push(recorded)
    const next = responses.shift()
    if (!next) throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    return typeof next === 'function' ? next(recorded) : next
  }
  return { fetch, requests }
}
