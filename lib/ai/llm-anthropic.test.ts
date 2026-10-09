import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import {
  ANTHROPIC_RESEARCH_REQUIRED_SUFFIX,
  anthropicMaxTokens,
  askLlm,
  askLlmWithFileInputs,
  askLlmWithUsage,
  describeLlmError,
  type LlmFileInput,
  type LlmWebSearchOptions,
} from './llm'
import { OFFICE_TEXT_EMPTY_MARKER } from './office-text'
import { resetAnthropicClient } from './provider'
import { verifiedFileSources } from './streaming-body'
import {
  jsonResponse,
  messageToSse,
  queuedFetch,
  sseResponse,
  type MockMessage,
  type RecordedRequest,
} from './testing/anthropic-sse'
import { zip } from './testing/office-zip'

const ENV = [
  'LLM_PROVIDER',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_FALLBACKS',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
] as const

beforeEach(() => {
  for (const name of ENV) vi.stubEnv(name, '')
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
  resetAnthropicClient()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetAnthropicClient()
})

type Responder = Response | ((request: RecordedRequest) => Response)

/** Routes the cached client's traffic through a recording mock. */
function mockFetch(responses: Responder[]) {
  const queued = queuedFetch(responses)
  vi.stubGlobal('fetch', queued.fetch)
  resetAnthropicClient()
  return queued.requests
}

const message = (overrides: Partial<MockMessage> & { content: MockMessage['content'] }) =>
  sseResponse({ usage: { input_tokens: 100, output_tokens: 20 }, ...overrides })

const text = (value: string, citations: Record<string, unknown>[] | null = null) =>
  ({ type: 'text', text: value, citations })

const uploaded = (id: string) =>
  jsonResponse({
    id,
    type: 'file',
    filename: 'petrios-ai-x',
    mime_type: 'application/pdf',
    size_bytes: 1,
    created_at: '2026-10-09T10:00:00Z',
    expires_at: '2026-10-09T11:00:00Z',
  })

const deleted = (request: RecordedRequest) =>
  jsonResponse({ id: new URL(request.url).pathname.split('/').pop(), type: 'file_deleted' })

const isMessages = (request: RecordedRequest) => request.url.includes('/v1/messages')
const isUpload = (request: RecordedRequest) => request.method === 'POST' && request.url.endsWith('/v1/files')
const isDelete = (request: RecordedRequest) => request.method === 'DELETE'

function chunked(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close()
        return
      }
      controller.enqueue(bytes.slice(offset, offset + size))
      offset += size
    },
  })
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function fileInput(
  filename: string,
  mimeType: string,
  bytes: Uint8Array,
  events: string[] = []
): LlmFileInput & { opens: number } {
  const input = {
    filename,
    mimeType,
    sha256: sha256(bytes),
    opens: 0,
    open: async () => {
      input.opens += 1
      events.push(`open:${filename}`)
      return chunked(bytes, 3)
    },
  }
  return input
}

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const PDF = new TextEncoder().encode('%PDF-1.7 handout')

async function docxBytes(body: string): Promise<Uint8Array> {
  return zip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'word/document.xml', data: `<w:document><w:body><w:p><w:r><w:t>${body}</w:t></w:r></w:p></w:body></w:document>` },
  ])
}

async function pptxBytes(): Promise<Uint8Array> {
  return zip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'ppt/slides/slide1.xml', data: '<p:sld><a:p><a:r><a:t>Airway first</a:t></a:r></a:p></p:sld>' },
  ])
}

const RESEARCH: LlmWebSearchOptions = {
  allowedDomains: ['nice.org.uk', 'nhs.uk'],
  searchContextSize: 'medium',
  maxUses: 4,
  userLocation: { country: 'GB' },
  required: true,
}

describe('anthropicMaxTokens', () => {
  it('applies an effort floor and the ceiling', () => {
    expect(anthropicMaxTokens('low')).toBe(8192)
    expect(anthropicMaxTokens('low', 2048)).toBe(8192)
    expect(anthropicMaxTokens('medium', 5000)).toBe(16_384)
    expect(anthropicMaxTokens('high', 3200)).toBe(32_768)
    expect(anthropicMaxTokens('medium', 40_000)).toBe(40_000)
    expect(anthropicMaxTokens('low', 500_000)).toBe(64_000)
  })
})

describe('Anthropic text calls', () => {
  it('streams one beta Messages request with explicit effort, fallbacks and no thinking', async () => {
    const requests = mockFetch([
      message({
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          text('Hello'),
          text(' world '),
        ],
        usage: { input_tokens: 40, output_tokens: 12, cache_read_input_tokens: 2 },
      }),
    ])

    const result = await askLlmWithUsage({
      system: 'You are terse.',
      prompt: 'Say hello',
      maxTokens: 2048,
      effort: 'low',
      jsonMode: true,
    })

    expect(result).toEqual({
      text: 'Hello world',
      usage: { inputTokens: 42, outputTokens: 12 },
      model: 'claude-opus-5-5',
      sources: [],
      webSearchRequests: 0,
    })
    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request.url).toBe('https://api.anthropic.com/v1/messages?beta=true')
    expect(request.headers.get('anthropic-beta')).toBe('server-side-fallback-2026-07-01')
    expect(request.headers.get('x-api-key')).toBe('sk-ant-test')
    expect(request.json).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 8192,
      system: 'You are terse.',
      output_config: { effort: 'low' },
      fallbacks: 'default',
      messages: [{ role: 'user', content: 'Say hello' }],
      stream: true,
    })
  })

  it('uses the caller default effort, then medium, and honours ANTHROPIC_MODEL', async () => {
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-sonnet-5-5')
    const requests = mockFetch([message({ content: [text('a')] }), message({ content: [text('b')] })])

    await askLlmWithUsage({ system: 's', prompt: 'p', defaultEffort: 'high' })
    await askLlm({ system: 's', prompt: 'p' })

    expect(requests[0].json).toMatchObject({
      model: 'claude-sonnet-5-5',
      output_config: { effort: 'high' },
      max_tokens: 32_768,
    })
    expect(requests[1].json).toMatchObject({ output_config: { effort: 'medium' }, max_tokens: 16_384 })
  })

  it('drops the fallback beta when ANTHROPIC_FALLBACKS=off', async () => {
    vi.stubEnv('ANTHROPIC_FALLBACKS', 'off')
    const requests = mockFetch([message({ content: [text('ok')] })])
    await askLlmWithUsage({ system: 's', prompt: 'p', effort: 'low' })
    expect(requests[0].headers.get('anthropic-beta')).toBeNull()
    expect(requests[0].json).not.toHaveProperty('fallbacks')
  })

  it('reports the model that served a refusal fallback', async () => {
    mockFetch([
      message({
        model: 'claude-opus-5-5',
        content: [
          { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' }, trigger: { type: 'refusal' } },
          text('Served answer'),
        ],
      }),
    ])
    const result = await askLlmWithUsage({ system: 's', prompt: 'p', effort: 'low' })
    expect(result).toMatchObject({ text: 'Served answer', model: 'claude-opus-5' })
  })

  it.each([
    ['refusal', 'The AI assistant declined this request.'],
    ['max_tokens', 'The AI response was cut off before it finished (max_tokens).'],
    ['model_context_window_exceeded', 'The AI request was too large for the model context window.'],
    ['pause_turn', 'The AI response ended unexpectedly.'],
    ['tool_use', 'The AI response requested an unexpected tool call.'],
  ])('throws on stop_reason %s and never returns partial text', async (stopReason, error) => {
    mockFetch([
      message({
        content: [text('partial')],
        stop_reason: stopReason,
        stop_details: stopReason === 'refusal' ? { type: 'refusal', category: 'bio', explanation: null } : null,
      }),
    ])
    await expect(askLlmWithUsage({ system: 's', prompt: 'p', effort: 'low' })).rejects.toThrow(error)
  })

  it('surfaces API failures as typed SDK errors with a prompt-free description', async () => {
    mockFetch([
      jsonResponse({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401),
    ])
    const error = await askLlmWithUsage({ system: 'secret system', prompt: 'secret prompt', effort: 'low' })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Anthropic.AuthenticationError)
    const described = describeLlmError(error)
    expect(described).toMatch(/^AuthenticationError 401 request_id=req_test type=authentication_error: /)
    expect(described).not.toContain('secret')
  })

  it('returns null without a configured provider and makes no request', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const requests = mockFetch([])
    await expect(askLlmWithUsage({ system: 's', prompt: 'p' })).resolves.toBeNull()
    await expect(askLlmWithFileInputs({ system: 's', prompt: 'p', files: [] })).resolves.toBeNull()
    expect(requests).toHaveLength(0)
  })
})

describe('Anthropic file-backed calls', () => {
  it('uploads PDF, DOCX and PPTX one at a time, references them by file_id, and deletes them all', async () => {
    const events: string[] = []
    const requests = mockFetch([
      () => {
        events.push('upload:1')
        return uploaded('file_pdf')
      },
      () => {
        events.push('upload:2')
        return uploaded('file_docx')
      },
      () => {
        events.push('upload:3')
        return uploaded('file_pptx')
      },
      () => {
        events.push('messages')
        return message({
          content: [text('A document-grounded recap.')],
          usage: { input_tokens: 10, output_tokens: 30, cache_creation_input_tokens: 5000 },
        })
      },
      deleted,
      deleted,
      deleted,
    ])
    const files = [
      fileInput('handout.pdf', PDF_MIME, PDF, events),
      fileInput('session-1-document-2-notes.docx', DOCX_MIME, await docxBytes('Fluids &amp; sepsis'), events),
      fileInput('slides.pptx', PPTX_MIME, await pptxBytes(), events),
    ]

    const result = await askLlmWithFileInputs({
      system: 'Use only the files.',
      prompt: 'Create the newsletter.',
      files,
      maxTokens: 5000,
      effort: 'medium',
    })

    expect(result).toEqual({
      text: 'A document-grounded recap.',
      usage: { inputTokens: 5010, outputTokens: 30 },
      model: 'claude-opus-5-5',
      sources: [],
      webSearchRequests: 0,
    })
    // Sequential: each document is fully read and uploaded before the next is opened
    // (Office documents are read twice: central directory, then parts).
    expect(events).toEqual([
      'open:handout.pdf',
      'upload:1',
      'open:session-1-document-2-notes.docx',
      'open:session-1-document-2-notes.docx',
      'upload:2',
      'open:slides.pptx',
      'open:slides.pptx',
      'upload:3',
      'messages',
    ])

    const uploads = requests.filter(isUpload)
    expect(uploads.map((request) => request.body)).toEqual([
      expect.stringContaining('name="expires_in_seconds"\r\n\r\n3600\r\n'),
      expect.stringContaining('name="expires_in_seconds"\r\n\r\n3600\r\n'),
      expect.stringContaining('name="expires_in_seconds"\r\n\r\n3600\r\n'),
    ])
    expect(uploads[0].body).toMatch(/filename="petrios-ai-[0-9a-f-]{36}\.pdf"\r\nContent-Type: application\/pdf\r\n\r\n%PDF-1\.7 handout\r\n/)
    expect(uploads[1].body).toMatch(/filename="petrios-ai-[0-9a-f-]{36}\.txt"\r\nContent-Type: text\/plain\r\n\r\nFluids & sepsis\r\n/)
    expect(uploads[2].body).toContain('\r\n\r\nSlide 1\nAirway first\r\n')
    // Display names never reach the Files API metadata.
    expect(uploads.some((request) => request.body.includes('notes.docx'))).toBe(false)

    const [messagesRequest] = requests.filter(isMessages)
    expect(messagesRequest.json).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 16_384,
      system: 'Use only the files.',
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      fallbacks: 'default',
    })
    expect(messagesRequest.json).not.toHaveProperty('thinking')
    expect(messagesRequest.json).not.toHaveProperty('tools')
    expect(messagesRequest.json).not.toHaveProperty('tool_choice')
    const office = 'Plain text extracted from the original Office document; images, layout and embedded objects are not included.'
    expect(messagesRequest.json?.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'file', file_id: 'file_pdf' }, title: 'handout.pdf' },
        {
          type: 'document',
          source: { type: 'file', file_id: 'file_docx' },
          title: 'session-1-document-2-notes.docx',
          context: office,
        },
        { type: 'document', source: { type: 'file', file_id: 'file_pptx' }, title: 'slides.pptx', context: office },
        { type: 'text', text: 'Create the newsletter.' },
      ],
    }])
    expect(requests.filter(isDelete).map((request) => new URL(request.url).pathname).sort()).toEqual([
      '/v1/files/file_docx',
      '/v1/files/file_pdf',
      '/v1/files/file_pptx',
    ])
  })

  it('uploads the empty-text marker for an Office file without text', async () => {
    const requests = mockFetch([uploaded('file_docx'), message({ content: [text('Too little material.')] }), deleted])
    await askLlmWithFileInputs({
      system: 's',
      prompt: 'p',
      files: [fileInput('blank.docx', DOCX_MIME, await docxBytes(''))],
    })
    expect(requests.filter(isUpload)[0].body).toContain(`\r\n\r\n${OFFICE_TEXT_EMPTY_MARKER}\r\n`)
  })

  it('deletes every uploaded file when the model refuses', async () => {
    const requests = mockFetch([
      uploaded('file_a'),
      uploaded('file_b'),
      message({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: null } }),
      deleted,
      deleted,
    ])
    await expect(askLlmWithFileInputs({
      system: 's',
      prompt: 'p',
      files: [fileInput('a.pdf', PDF_MIME, PDF), fileInput('b.pdf', PDF_MIME, PDF)],
    })).rejects.toThrow('The AI assistant declined this request.')
    expect(requests.filter(isDelete)).toHaveLength(2)
  })

  it('deletes earlier uploads when a later upload fails, and never calls the model', async () => {
    const requests = mockFetch([
      uploaded('file_a'),
      jsonResponse({ type: 'error', error: { type: 'invalid_request_error', message: 'bad file' } }, 400),
      deleted,
    ])
    await expect(askLlmWithFileInputs({
      system: 's',
      prompt: 'p',
      files: [fileInput('a.pdf', PDF_MIME, PDF), fileInput('b.pdf', PDF_MIME, PDF)],
    })).rejects.toBeInstanceOf(Anthropic.BadRequestError)
    expect(requests.filter(isMessages)).toHaveLength(0)
    expect(requests.filter(isDelete).map((request) => new URL(request.url).pathname)).toEqual(['/v1/files/file_a'])
  })

  it('fails with the integrity error, deletes earlier uploads, and leaves the failure for throwIfFailed', async () => {
    const requests = mockFetch([uploaded('file_a'), deleted])
    const sources = verifiedFileSources([
      {
        filename: 'a.pdf',
        mimeType: PDF_MIME,
        byteSize: PDF.byteLength,
        sha256: sha256(PDF),
        read: async () => chunked(PDF, 4),
        integrityError: () => new Error('Document "a.pdf" failed its integrity check.'),
      },
      {
        filename: 'b.pdf',
        mimeType: PDF_MIME,
        byteSize: PDF.byteLength,
        sha256: 'f'.repeat(64),
        read: async () => chunked(PDF, 4),
        integrityError: () => new Error('Document "b.pdf" failed its integrity check.'),
      },
    ])
    await expect(askLlmWithFileInputs({ system: 's', prompt: 'p', files: sources.files }))
      .rejects.toThrow('Document "b.pdf" failed its integrity check.')
    expect(requests.filter(isUpload)).toHaveLength(1)
    expect(requests.filter(isMessages)).toHaveLength(0)
    expect(requests.filter(isDelete)).toHaveLength(1)
    expect(() => sources.throwIfFailed()).toThrow('Document "b.pdf" failed its integrity check.')
  })

  it('maps a 400 on the Messages call to a document-limits error that keeps the cause', async () => {
    const requests = mockFetch([
      uploaded('file_a'),
      jsonResponse({ type: 'error', error: { type: 'invalid_request_error', message: 'too many pages' } }, 400),
      deleted,
    ])
    const error = await askLlmWithFileInputs({
      system: 's',
      prompt: 'p',
      files: [fileInput('a.pdf', PDF_MIME, PDF)],
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('600-page or context limits')
    expect((error as Error).cause).toBeInstanceOf(Anthropic.BadRequestError)
    expect(describeLlmError(error)).toMatch(/^Error \(BadRequestError\) 400 request_id=req_test type=invalid_request_error: /)
    expect(requests.filter(isDelete)).toHaveLength(1)
  })

  it('deletes the uploads when the caller aborts during generation', async () => {
    const controller = new AbortController()
    const requests = mockFetch([
      uploaded('file_a'),
      () => {
        controller.abort(new Error('moderator navigated away'))
        return message({ content: [text('late')] })
      },
      deleted,
    ])
    await expect(askLlmWithFileInputs({
      system: 's',
      prompt: 'p',
      files: [fileInput('a.pdf', PDF_MIME, PDF)],
      signal: controller.signal,
    })).rejects.toThrow()
    expect(requests.filter(isDelete)).toHaveLength(1)
  })

  it('rejects a document type the provider cannot read', async () => {
    mockFetch([])
    await expect(askLlmWithFileInputs({
      system: 's',
      prompt: 'p',
      files: [fileInput('sheet.xlsx', 'application/vnd.ms-excel', new Uint8Array([1]))],
    })).rejects.toThrow('Document "sheet.xlsx" has a type the AI provider cannot read')
  })
})

describe('Anthropic hosted research', () => {
  const searchCall = (id: string, query: string) =>
    ({ type: 'server_tool_use', id, name: 'web_search', input: { query }, caller: { type: 'direct' } })
  const searchResults = (id: string, results: Array<{ url: string; title: string }>) => ({
    type: 'web_search_tool_result',
    tool_use_id: id,
    caller: { type: 'direct' },
    content: results.map((result) => ({
      type: 'web_search_result',
      url: result.url,
      title: result.title,
      encrypted_content: 'enc',
      page_age: null,
    })),
  })
  const citation = (url: string, title: string | null) => ({
    type: 'web_search_result_location',
    url,
    title,
    cited_text: 'quoted guidance',
    encrypted_index: 'idx',
  })

  it('sends a direct, allow-listed web search tool and a fixed research instruction (never forced)', async () => {
    const requests = mockFetch([
      uploaded('file_a'),
      message({
        content: [
          searchCall('srvtoolu_1', 'sepsis guidance'),
          searchResults('srvtoolu_1', [{ url: 'https://www.nice.org.uk/guidance/ng51', title: 'NICE NG51' }]),
          text('Recap.', [citation('https://www.nice.org.uk/guidance/ng51', 'NICE NG51')]),
        ],
        usage: { input_tokens: 10, output_tokens: 10, server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
      }),
      deleted,
    ])

    const result = await askLlmWithFileInputs({
      system: 'Documents lead.',
      prompt: 'Create the recap.',
      files: [fileInput('a.pdf', PDF_MIME, PDF)],
      maxTokens: 3200,
      defaultEffort: 'high',
      webSearch: RESEARCH,
    })

    expect(result).toMatchObject({
      text: 'Recap.',
      webSearchRequests: 1,
      sources: [{ url: 'https://www.nice.org.uk/guidance/ng51', title: 'NICE NG51' }],
    })
    const [request] = requests.filter(isMessages)
    expect(request.json).toMatchObject({
      system: `Documents lead.${ANTHROPIC_RESEARCH_REQUIRED_SUFFIX}`,
      output_config: { effort: 'high' },
      max_tokens: 32_768,
      tools: [{
        type: 'web_search_20260209',
        name: 'web_search',
        allowed_callers: ['direct'],
        allowed_domains: ['nice.org.uk', 'nhs.uk'],
        max_uses: 4,
        user_location: { type: 'approximate', country: 'GB' },
      }],
    })
    expect(request.json).not.toHaveProperty('tool_choice')
    expect(request.json).not.toHaveProperty('thinking')
  })

  it('resumes pause_turn with the same tools and the echoed content; the answer is the text after the last search', async () => {
    const firstContent = [
      text('Checking current guidance. '),
      searchCall('srvtoolu_1', 'sepsis fluids'),
      searchResults('srvtoolu_1', [{ url: 'https://www.nhs.uk/conditions/sepsis/', title: 'Sepsis - NHS' }]),
      searchCall('srvtoolu_2', 'sepsis antibiotics'),
    ]
    const requests = mockFetch([
      uploaded('file_a'),
      message({
        content: firstContent,
        stop_reason: 'pause_turn',
        usage: { input_tokens: 50, output_tokens: 10, server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
      }),
      message({
        content: [
          searchResults('srvtoolu_2', [{ url: 'https://www.nice.org.uk/guidance/ng51', title: 'NICE NG51' }]),
          text('Give fluids', [citation('https://www.nhs.uk/conditions/sepsis/', 'Sepsis - NHS')]),
          text(' early.'),
        ],
        usage: { input_tokens: 60, output_tokens: 15, cache_read_input_tokens: 40, server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
      }),
      deleted,
    ])

    const result = await askLlmWithFileInputs({
      system: 's',
      prompt: 'Create the recap.',
      files: [fileInput('a.pdf', PDF_MIME, PDF)],
      webSearch: RESEARCH,
    })

    expect(result).toMatchObject({
      // The note written before the searches is not part of the spoken answer.
      text: 'Give fluids early.',
      usage: { inputTokens: 150, outputTokens: 25 },
      webSearchRequests: 2,
      sources: [
        { url: 'https://www.nhs.uk/conditions/sepsis/', title: 'Sepsis - NHS' },
        { url: 'https://www.nice.org.uk/guidance/ng51', title: 'NICE NG51' },
      ],
    })
    const [first, second] = requests.filter(isMessages)
    expect(second.json?.tools).toEqual(first.json?.tools)
    expect(second.json?.system).toEqual(first.json?.system)
    const firstMessages = first.json?.messages as unknown[]
    const secondMessages = second.json?.messages as Array<{ role: string; content: unknown }>
    expect(secondMessages).toHaveLength(2)
    expect(secondMessages[0]).toEqual(firstMessages[0])
    expect(secondMessages[1]).toEqual({ role: 'assistant', content: firstContent })
  })

  it('drops working notes written before or between searches, but keeps their citations', async () => {
    mockFetch([
      uploaded('file_a'),
      message({
        content: [
          text('Let me check NICE first.'),
          searchCall('srvtoolu_1', 'sepsis'),
          searchResults('srvtoolu_1', [{ url: 'https://www.nice.org.uk/guidance/ng51', title: 'NICE NG51' }]),
          text('Found it; now the NHS page.', [citation('https://www.nhs.uk/conditions/sepsis/', 'Sepsis - NHS')]),
          searchCall('srvtoolu_2', 'sepsis nhs'),
          searchResults('srvtoolu_2', [{ url: 'https://www.nhs.uk/conditions/sepsis/', title: 'Sepsis - NHS' }]),
          { type: 'thinking', thinking: '', signature: 'sig' },
          text('Sepsis is a medical emergency', [citation('https://www.nice.org.uk/guidance/ng51', 'NICE NG51')]),
          text(' that needs prompt treatment.'),
        ],
        usage: { input_tokens: 1, output_tokens: 1, server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } },
      }),
      deleted,
    ])
    const result = await askLlmWithFileInputs({
      system: 's',
      prompt: 'p',
      files: [fileInput('a.pdf', PDF_MIME, PDF)],
      webSearch: RESEARCH,
    })
    expect(result?.text).toBe('Sepsis is a medical emergency that needs prompt treatment.')
    expect(result?.webSearchRequests).toBe(2)
    expect(result?.sources).toEqual([
      { url: 'https://www.nhs.uk/conditions/sepsis/', title: 'Sepsis - NHS' },
      { url: 'https://www.nice.org.uk/guidance/ng51', title: 'NICE NG51' },
    ])
  })

  it('joins every text block when no search ran', async () => {
    mockFetch([
      uploaded('file_a'),
      message({ content: [text('First part,'), text(' second part.')] }),
      deleted,
    ])
    const result = await askLlmWithFileInputs({
      system: 's',
      prompt: 'p',
      files: [fileInput('a.pdf', PDF_MIME, PDF)],
      webSearch: RESEARCH,
    })
    expect(result).toMatchObject({ text: 'First part, second part.', webSearchRequests: 0, sources: [] })
  })

  it('counts searches a declined attempt ran before a refusal fallback (usage covers only the serving attempt)', async () => {
    mockFetch([
      uploaded('file_a'),
      message({
        model: 'claude-opus-5',
        content: [
          searchCall('srvtoolu_1', 'asthma'),
          searchResults('srvtoolu_1', [{ url: 'https://www.nhs.uk/conditions/asthma/', title: 'Asthma - NHS' }]),
          // A failed search is not research.
          searchCall('srvtoolu_2', 'asthma nice'),
          { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_2', caller: { type: 'direct' }, content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } },
          text('Asthma care starts '),
          { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' }, trigger: { type: 'refusal' } },
          text('with a written action plan.'),
        ],
        usage: {
          input_tokens: 5,
          output_tokens: 5,
          server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
          iterations: [
            { type: 'message', input_tokens: 10, output_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            { type: 'fallback_message', input_tokens: 12, output_tokens: 6, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          ],
        },
      }),
      deleted,
    ])
    const result = await askLlmWithFileInputs({
      system: 's',
      prompt: 'p',
      files: [fileInput('a.pdf', PDF_MIME, PDF)],
      webSearch: RESEARCH,
    })
    expect(result).toMatchObject({
      text: 'Asthma care starts with a written action plan.',
      model: 'claude-opus-5',
      webSearchRequests: 1,
      webSearchErrors: ['unavailable'],
      sources: [{ url: 'https://www.nhs.uk/conditions/asthma/', title: 'Asthma - NHS' }],
    })
  })

  it('never describes an unreadable stream with the model output the SDK quotes (e.g. a search query)', async () => {
    const valid = messageToSse({
      content: [searchCall('srvtoolu_1', 'PRIVATE-QUERY about Jane Patient')],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    // The model's tool input arrives as JSON the SDK cannot parse.
    const broken = valid.replace('{\\"query\\":', '{\\"query\\" ')
    expect(broken).not.toBe(valid)
    mockFetch([
      uploaded('file_a'),
      new Response(broken, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      deleted,
    ])
    const error = await askLlmWithFileInputs({
      system: 's',
      prompt: 'p',
      files: [fileInput('a.pdf', PDF_MIME, PDF)],
      webSearch: RESEARCH,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Anthropic.AnthropicError)
    expect(error).not.toBeInstanceOf(Anthropic.APIError)
    // The SDK's own message quotes the model output...
    expect((error as Error).message).toContain('Jane Patient')
    // ...which therefore never reaches logs or the Ops audit.
    expect(describeLlmError(error)).toBe('AnthropicError: unreadable_response')
    expect(describeLlmError(new Error('wrapped', { cause: error }))).toBe('Error (AnthropicError): unreadable_response')
  })

  it('stops after five pause_turn continuations', async () => {
    const paused = () =>
      message({ content: [searchCall('srvtoolu_x', 'q')], stop_reason: 'pause_turn' })
    const requests = mockFetch([uploaded('file_a'), paused, paused, paused, paused, paused, paused, deleted])
    await expect(askLlmWithFileInputs({
      system: 's',
      prompt: 'p',
      files: [fileInput('a.pdf', PDF_MIME, PDF)],
      webSearch: RESEARCH,
    })).rejects.toThrow('The AI research step did not finish (pause_turn limit).')
    expect(requests.filter(isMessages)).toHaveLength(6)
    expect(requests.filter(isDelete)).toHaveLength(1)
  })

  it('keeps only http(s), allow-listed, de-duplicated sources (cited first) and caps them at 20', async () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      url: `https://www.nice.org.uk/guidance/ng${index}`,
      title: `NG${index}`,
    }))
    mockFetch([
      uploaded('file_a'),
      message({
        content: [
          searchCall('srvtoolu_1', 'q'),
          searchResults('srvtoolu_1', [
            { url: 'https://evil.example/nice.org.uk', title: 'Off-list' },
            { url: 'https://nhs.uk.evil.example/page', title: 'Lookalike' },
            { url: 'https://www.nhs.uk/conditions/asthma/', title: 'Asthma - NHS' },
            ...many,
          ]),
          text('Answer', [
            citation('https://cks.nice.org.uk/topics/asthma/', null),
            citation('javascript:alert(1)', 'Unsafe'),
            citation('https://www.nhs.uk/conditions/asthma/', 'Asthma (cited)'),
          ]),
          { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_2', caller: { type: 'direct' }, content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
        ],
        usage: { input_tokens: 1, output_tokens: 1, server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
      }),
      deleted,
    ])

    const result = await askLlmWithFileInputs({
      system: 's',
      prompt: 'p',
      files: [fileInput('a.pdf', PDF_MIME, PDF)],
      webSearch: RESEARCH,
    })

    expect(result?.sources).toHaveLength(20)
    expect(result?.sources.slice(0, 3)).toEqual([
      { url: 'https://cks.nice.org.uk/topics/asthma/', title: 'cks.nice.org.uk' },
      { url: 'https://www.nhs.uk/conditions/asthma/', title: 'Asthma (cited)' },
      { url: 'https://www.nice.org.uk/guidance/ng0', title: 'NG0' },
    ])
    expect(result?.sources.some((source) => source.url.includes('evil.example'))).toBe(false)
    expect(result?.webSearchErrors).toEqual(['max_uses_exceeded'])
    expect(JSON.stringify(result)).not.toContain('quoted guidance')
    expect(JSON.stringify(result)).not.toContain('encrypted')
  })
})
