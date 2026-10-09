import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { askLlmWithFileInputs, LLM_MODEL, type LlmFileInput, type LlmWebSearchOptions } from './llm'
import { verifiedFileSources } from './streaming-body'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

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

function fileInput(
  filename: string,
  mimeType: string,
  bytes: Uint8Array,
  chunkSize = 3
): LlmFileInput & { opens: number } {
  const input = {
    filename,
    mimeType,
    sha256: sha256(bytes),
    opens: 0,
    open: async () => {
      input.opens += 1
      return chunked(bytes, chunkSize)
    },
  }
  return input
}

async function readBody(body: unknown): Promise<string> {
  expect(body).toBeInstanceOf(ReadableStream)
  const parts: Uint8Array[] = []
  const reader = (body as ReadableStream<Uint8Array>).getReader()
  for (let read = await reader.read(); !read.done; read = await reader.read()) parts.push(read.value)
  return Buffer.concat(parts).toString('utf8')
}

/** Mimics fetch: uploads the whole body, then answers; a body error fails the call. */
function respondingFetch(data: unknown, bodies: string[] = []) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    try {
      bodies.push(await readBody(init.body))
    } catch (cause) {
      throw new TypeError('fetch failed', { cause })
    }
    return new Response(JSON.stringify(data), { status: 200 })
  })
}

const okData = {
  model: 'test-model',
  output: [{ type: 'message', content: [{ type: 'output_text', text: 'A document-grounded recap.' }] }],
  usage: { input_tokens: 123, output_tokens: 45 },
}

describe('Responses file-input adapter', () => {
  it('streams private documents as file inputs and reads output text', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const bodies: string[] = []
    const fetchMock = respondingFetch(okData, bodies)
    vi.stubGlobal('fetch', fetchMock)

    const result = await askLlmWithFileInputs({
      system: 'Use only the files.',
      prompt: 'Create the recap.',
      maxTokens: 900,
      files: [
        fileInput('handout.pdf', 'application/pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46])),
        fileInput(
          'slides.pptx',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          new Uint8Array([0x50, 0x4b, 0x03, 0x04])
        ),
      ],
    })

    expect(result?.text).toBe('A document-grounded recap.')
    expect(result?.usage).toEqual({ inputTokens: 123, outputTokens: 45 })
    expect(result?.sources).toEqual([])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { duplex?: string }]
    expect(url).toMatch(/\/responses$/)
    expect(init.duplex).toBe('half')
    expect(init.redirect).toBe('error')
    expect(init.cache).toBe('no-store')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    const body = JSON.parse(bodies[0])
    expect(body.instructions).toBe('Use only the files.')
    expect(body.max_output_tokens).toBe(900)
    expect(body.input[0].content).toEqual([
      expect.objectContaining({
        type: 'input_file',
        filename: 'handout.pdf',
        file_data: 'data:application/pdf;base64,JVBERg==',
        detail: 'auto',
      }),
      expect.objectContaining({
        type: 'input_file',
        filename: 'slides.pptx',
        file_data: 'data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,UEsDBA==',
      }),
      { type: 'input_text', text: 'Create the recap.' },
    ])
    expect(body.input[0].content[1]).not.toHaveProperty('detail')
  })

  it('requires bounded hosted search and returns de-duplicated clickable sources', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const bodies: string[] = []
    vi.stubGlobal('fetch', respondingFetch({
      output: [
        {
          type: 'web_search_call',
          action: {
            sources: [
              { url: 'https://www.nice.org.uk/guidance/ng80', title: 'NICE guidance' },
              { url: 'javascript:alert(1)', title: 'Unsafe' },
            ],
          },
        },
        {
          type: 'message',
          content: [{
            type: 'output_text',
            text: 'A researched recap.',
            annotations: [{
              type: 'url_citation',
              url: 'https://www.nice.org.uk/guidance/ng80',
              title: 'Duplicate citation',
            }],
          }],
        },
      ],
    }, bodies))

    const result = await askLlmWithFileInputs({
      system: 'Documents lead; research supplements.',
      prompt: 'Create the recap.',
      files: [fileInput('handout.pdf', 'application/pdf', new Uint8Array([1]))],
      webSearch: {
        allowedDomains: ['nice.org.uk', 'nhs.uk'],
        searchContextSize: 'medium',
        userLocation: { country: 'GB' },
        required: true,
      },
    })

    expect(result?.sources).toEqual([{
      url: 'https://www.nice.org.uk/guidance/ng80',
      title: 'NICE guidance',
    }])
    const body = JSON.parse(bodies[0])
    expect(body.tools).toEqual([expect.objectContaining({
      type: 'web_search',
      search_context_size: 'medium',
      external_web_access: true,
      filters: { allowed_domains: ['nice.org.uk', 'nhs.uk'] },
      user_location: { type: 'approximate', country: 'GB' },
    })])
    expect(body.tool_choice).toBe('required')
    expect(body.include).toEqual(['web_search_call.action.sources'])
  })

  it('streams exactly the bytes of the previous JSON.stringify body', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    // The pre-streaming request builder, kept verbatim as the reference.
    const previousBody = (input: {
      system: string
      prompt: string
      files: { filename: string; mimeType: string; bytes: Uint8Array }[]
      maxTokens?: number
      webSearch?: LlmWebSearchOptions
    }) => JSON.stringify({
      model: LLM_MODEL,
      instructions: input.system,
      max_output_tokens: input.maxTokens ?? 8192,
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
          ...input.files.map((file) => ({
            type: 'input_file',
            filename: file.filename,
            file_data: `data:${file.mimeType};base64,${Buffer.from(file.bytes).toString('base64')}`,
            ...(file.mimeType === 'application/pdf' ? { detail: 'auto' } : {}),
          })),
          { type: 'input_text', text: input.prompt },
        ],
      }],
    })

    const bytes = (length: number, seed: number) =>
      Uint8Array.from({ length }, (_, i) => (Math.imul(i + seed, 2654435761) >>> 24) & 0xff)
    const samples = [
      {
        system: 'System with "quotes", \\ backslash, newline\n, emoji 😀 and lone \ud83d.',
        prompt: 'Session title: Sepsis "bundle" </script>\n- handout.pdf (application/pdf, 10 bytes)',
        files: [
          { filename: 'Week 3 – “ward” notes.pdf', mimeType: 'application/pdf', bytes: bytes(10, 1) },
          {
            filename: 'session-1-document-2-slides\u0007.pptx',
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            bytes: bytes(65_539, 2),
          },
        ],
        maxTokens: 3200,
        webSearch: {
          allowedDomains: ['nice.org.uk', 'nhs.uk'],
          searchContextSize: 'medium' as const,
          userLocation: { country: 'GB' },
          required: true,
        },
      },
      {
        system: 'Newsletter',
        prompt: JSON.stringify([{ id: 's1', title: 'Ünïcödé' }]),
        files: [
          {
            filename: 'notes.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            bytes: bytes(1, 3),
          },
          { filename: 'two.pdf', mimeType: 'application/pdf', bytes: bytes(2, 4) },
          { filename: 'three.pdf', mimeType: 'application/pdf', bytes: bytes(3, 5) },
        ],
      },
    ]

    for (const sample of samples) {
      const expected = previousBody(sample)
      for (const chunkSize of [1, 2, 3, 4, 5, 7, 16, 1000, 65_536, 1_000_000]) {
        const bodies: string[] = []
        vi.stubGlobal('fetch', respondingFetch(okData, bodies))
        await askLlmWithFileInputs({
          ...sample,
          files: sample.files.map((file) => fileInput(file.filename, file.mimeType, file.bytes, chunkSize)),
        })
        expect(bodies[0] === expected, `chunk size ${chunkSize}`).toBe(true)
      }
    }
  })

  it('uses manual redirects on Workers, where a 3xx fails the status check', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' })
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      await readBody(init.body)
      return new Response(null, { status: 307, headers: { location: 'https://elsewhere.example/v1/responses' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      askLlmWithFileInputs({
        system: 's',
        prompt: 'p',
        files: [fileInput('a.pdf', 'application/pdf', new Uint8Array([1]))],
      })
    ).rejects.toThrow('file-input request failed (307)')
    expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe('manual')
  })

  it('re-opens every document for each call so a retry rebuilds the body', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const bodies: string[] = []
    vi.stubGlobal('fetch', respondingFetch(okData, bodies))
    const files = [
      fileInput('a.pdf', 'application/pdf', new Uint8Array([1, 2, 3, 4])),
      fileInput('b.pdf', 'application/pdf', new Uint8Array([5, 6])),
    ]

    await askLlmWithFileInputs({ system: 's', prompt: 'p', files })
    await askLlmWithFileInputs({ system: 's', prompt: 'p (retry)', files })

    expect(files.map((file) => file.opens)).toEqual([2, 2])
    expect(JSON.parse(bodies[1]).input[0].content[0].file_data).toBe(
      JSON.parse(bodies[0]).input[0].content[0].file_data
    )
  })

  it('fails with the integrity error and never accepts output when a document does not match', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const fetchMock = respondingFetch(okData)
    vi.stubGlobal('fetch', fetchMock)
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const sources = verifiedFileSources([{
      filename: 'handout.pdf',
      mimeType: 'application/pdf',
      byteSize: bytes.byteLength,
      sha256: 'f'.repeat(64),
      read: async () => chunked(bytes, 2),
      integrityError: () => new Error('Document "handout.pdf" failed its integrity check.'),
    }])

    await expect(
      askLlmWithFileInputs({ system: 's', prompt: 'p', files: sources.files })
    ).rejects.toThrow('Document "handout.pdf" failed its integrity check.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(() => sources.throwIfFailed()).toThrow('failed its integrity check')
  })

  it('rejects provider output if the body failed after the endpoint answered early', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const sources = verifiedFileSources([{
      filename: 'handout.pdf',
      mimeType: 'application/pdf',
      byteSize: bytes.byteLength,
      sha256: 'f'.repeat(64),
      read: async () => chunked(bytes, 5),
      integrityError: () => new Error('Document "handout.pdf" failed its integrity check.'),
    }])
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      await readBody(init.body).catch(() => {})
      return new Response(JSON.stringify(okData), { status: 200 })
    }))

    await expect(
      askLlmWithFileInputs({ system: 's', prompt: 'p', files: sources.files })
    ).rejects.toThrow('failed its integrity check')
  })

  it('cancels the in-flight storage read when the provider request fails mid-upload', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    let readSignal = null as AbortSignal | null
    let cancelled: unknown = null
    const stalled: LlmFileInput = {
      filename: 'big.pdf',
      mimeType: 'application/pdf',
      sha256: 'a'.repeat(64),
      open: async (signal) => {
        readSignal = signal
        let sent = 0
        return new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent++ < 2) controller.enqueue(new Uint8Array(3))
            else return new Promise(() => {})
          },
          cancel(reason) {
            cancelled = reason
          },
        }, { highWaterMark: 0 })
      },
    }
    // Reads part of the body, then the connection drops without cancelling it.
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const reader = (init.body as ReadableStream<Uint8Array>).getReader()
      for (let i = 0; i < 4; i++) await reader.read()
      throw new TypeError('fetch failed', { cause: new Error('socket hang up') })
    }))

    await expect(
      askLlmWithFileInputs({ system: 's', prompt: 'p', files: [stalled] })
    ).rejects.toThrow('fetch failed')
    expect(readSignal?.aborted).toBe(true)
    expect(cancelled).not.toBeNull()
  })

  it('aborts the request and the storage read when the caller signal fires', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const caller = new AbortController()
    let readSignal = null as AbortSignal | null
    const slow: LlmFileInput = {
      filename: 'big.pdf',
      mimeType: 'application/pdf',
      sha256: 'a'.repeat(64),
      open: async (signal) => {
        readSignal = signal
        return new ReadableStream<Uint8Array>({
          pull() {
            return new Promise(() => {})
          },
        })
      },
    }
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal?.aborted).toBe(false)
      const reader = (init.body as ReadableStream<Uint8Array>).getReader()
      await reader.read()
      await reader.read()
      const pending = reader.read()
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(readSignal?.aborted).toBe(false)
      caller.abort(new Error('timed out'))
      await pending.catch(() => {})
      throw init.signal!.reason
    }))

    await expect(
      askLlmWithFileInputs({ system: 's', prompt: 'p', files: [slow], signal: caller.signal })
    ).rejects.toThrow('timed out')
    expect(readSignal?.aborted).toBe(true)
  })
})
