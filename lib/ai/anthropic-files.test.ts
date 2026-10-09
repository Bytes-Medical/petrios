import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import {
  ANTHROPIC_FILE_PREFIX,
  deleteAnthropicFiles,
  sweepAnthropicFiles,
  textUploadSource,
  uploadAnthropicFile,
  type AnthropicUploadSource,
} from './anthropic-files'
import { getAnthropicClient, resetAnthropicClient } from './provider'
import { verifiedFileSources } from './streaming-body'
import { jsonResponse, queuedFetch, type RecordedRequest } from './testing/anthropic-sse'

beforeEach(() => {
  for (const name of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'LLM_PROVIDER']) vi.stubEnv(name, '')
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
  resetAnthropicClient()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetAnthropicClient()
})

const fileMetadata = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'file',
  filename: `${ANTHROPIC_FILE_PREFIX}x.pdf`,
  mime_type: 'application/pdf',
  size_bytes: 4,
  created_at: '2026-10-09T10:00:00Z',
  expires_at: '2026-10-09T11:00:00Z',
  ...extra,
})

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

function pdfSource(bytes: Uint8Array): AnthropicUploadSource & { opens: number } {
  const source = {
    kind: 'pdf' as const,
    opens: 0,
    open: async () => {
      source.opens += 1
      return chunked(bytes, 2)
    },
  }
  return source
}

/** Parses the recorded multipart body into its parts. */
function multipart(request: RecordedRequest) {
  const boundary = /boundary=(.+)$/.exec(request.headers.get('content-type') ?? '')?.[1]
  expect(boundary).toMatch(/^petrios-[0-9a-f-]{36}$/)
  expect(request.body.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true)
  const sections = request.body.split(`--${boundary}`).slice(1, -1)
  return sections.map((section) => {
    const [head, ...rest] = section.slice(2).split('\r\n\r\n')
    return { head, body: rest.join('\r\n\r\n').slice(0, -2) }
  })
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])

describe('uploadAnthropicFile', () => {
  it('streams a multipart upload with a one-hour expiry and an opaque filename (no beta header)', async () => {
    const { fetch, requests } = queuedFetch([jsonResponse(fileMetadata('file_1'))])
    const client = getAnthropicClient({ fetch })

    const metadata = await uploadAnthropicFile(client, pdfSource(PDF), new AbortController().signal)

    expect(metadata.id).toBe('file_1')
    const [request] = requests
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.anthropic.com/v1/files')
    expect(request.headers.get('x-api-key')).toBe('sk-ant-test')
    expect(request.headers.get('anthropic-beta')).toBeNull()
    expect(request.cache).toBe('no-store')
    expect(request.redirect).toBe('error')
    const [expiry, file] = multipart(request)
    expect(expiry).toEqual({
      head: 'Content-Disposition: form-data; name="expires_in_seconds"',
      body: '3600',
    })
    expect(file.head).toMatch(
      /^Content-Disposition: form-data; name="file"; filename="petrios-ai-[0-9a-f-]{36}\.pdf"\r\nContent-Type: application\/pdf$/
    )
    expect(file.body).toBe('%PDF-1')
  })

  it('hands fetch a ReadableStream body (never a buffered Blob or FormData)', async () => {
    let body: unknown = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      body = init?.body
      await new Request(input, init).arrayBuffer()
      return jsonResponse(fileMetadata('file_1'))
    })
    const client = getAnthropicClient({ fetch: fetchMock })
    await uploadAnthropicFile(client, pdfSource(PDF), new AbortController().signal)
    expect(body).toBeInstanceOf(ReadableStream)
    expect((fetchMock.mock.calls[0][1] as RequestInit & { duplex?: string }).duplex).toBe('half')
  })

  it('uploads extracted text as text/plain UTF-8', async () => {
    const { fetch, requests } = queuedFetch([jsonResponse(fileMetadata('file_t'))])
    const text = 'Slide 1\nCafé – “ward” 7\n'.repeat(5000)
    await uploadAnthropicFile(getAnthropicClient({ fetch }), textUploadSource(text), new AbortController().signal)
    const [, file] = multipart(requests[0])
    expect(file.head).toMatch(/filename="petrios-ai-[0-9a-f-]{36}\.txt"\r\nContent-Type: text\/plain$/)
    expect(file.body).toBe(text)
  })

  it('uses manual redirects on Workers', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' })
    const { fetch, requests } = queuedFetch([jsonResponse(fileMetadata('file_1'))])
    await uploadAnthropicFile(getAnthropicClient({ fetch }), pdfSource(PDF), new AbortController().signal)
    expect(requests[0].redirect).toBe('manual')
  })

  it('retries once on a rate limit, re-opening the source', async () => {
    const { fetch, requests } = queuedFetch([
      jsonResponse({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 429),
      jsonResponse(fileMetadata('file_2')),
    ])
    const source = pdfSource(PDF)
    const metadata = await uploadAnthropicFile(getAnthropicClient({ fetch }), source, new AbortController().signal)
    expect(metadata.id).toBe('file_2')
    expect(source.opens).toBe(2)
    expect(requests).toHaveLength(2)
    expect(multipart(requests[1])[1].body).toBe('%PDF-1')
  })

  it('releases each attempt (and the source it holds) as soon as it ends, while the request signal lives on', async () => {
    // A live per-attempt signal keeps its abort listener, and through it the
    // source (e.g. a document's extracted text), reachable for as long as the
    // request signal lives: across every later upload and the whole generation.
    const attemptSignals: AbortSignal[] = []
    const tracked = (text: string): AnthropicUploadSource => {
      const inner = textUploadSource(text)
      return {
        kind: inner.kind,
        open: (signal) => {
          attemptSignals.push(signal)
          return inner.open(signal)
        },
      }
    }
    const request = new AbortController()
    const { fetch } = queuedFetch([
      jsonResponse(fileMetadata('file_1')),
      jsonResponse({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 429),
      jsonResponse(fileMetadata('file_2')),
      jsonResponse({ type: 'error', error: { type: 'invalid_request_error', message: 'bad file' } }, 400),
    ])
    const client = getAnthropicClient({ fetch })

    await uploadAnthropicFile(client, tracked('first document'), request.signal)
    await uploadAnthropicFile(client, tracked('second document (retried)'), request.signal)
    await expect(uploadAnthropicFile(client, tracked('third document'), request.signal))
      .rejects.toBeInstanceOf(Anthropic.BadRequestError)

    expect(request.signal.aborted).toBe(false)
    expect(attemptSignals).toHaveLength(4)
    expect(attemptSignals.map((signal) => signal.aborted)).toEqual([true, true, true, true])
  }, 10_000)

  it('gives up after the second failed attempt and never retries a 400', async () => {
    const overloaded = () =>
      jsonResponse({ type: 'error', error: { type: 'api_error', message: 'boom' } }, 500)
    const twice = queuedFetch([overloaded(), overloaded()])
    await expect(
      uploadAnthropicFile(getAnthropicClient({ fetch: twice.fetch }), pdfSource(PDF), new AbortController().signal)
    ).rejects.toBeInstanceOf(Anthropic.InternalServerError)
    expect(twice.requests).toHaveLength(2)

    const bad = queuedFetch([
      jsonResponse({ type: 'error', error: { type: 'invalid_request_error', message: 'bad file' } }, 400),
    ])
    await expect(
      uploadAnthropicFile(getAnthropicClient({ fetch: bad.fetch }), pdfSource(PDF), new AbortController().signal)
    ).rejects.toBeInstanceOf(Anthropic.BadRequestError)
    expect(bad.requests).toHaveLength(1)
  }, 10_000)

  it('rethrows a source integrity failure unchanged and never retries it', async () => {
    const { fetch, requests } = queuedFetch([jsonResponse(fileMetadata('never'))])
    let reads = 0
    const sources = verifiedFileSources([{
      filename: 'handout.pdf',
      mimeType: 'application/pdf',
      byteSize: PDF.byteLength,
      sha256: 'f'.repeat(64),
      read: async () => {
        reads += 1
        return chunked(PDF, 2)
      },
      integrityError: () => new Error('Document "handout.pdf" failed its integrity check.'),
    }])
    const file = sources.files[0]

    await expect(
      uploadAnthropicFile(
        getAnthropicClient({ fetch }),
        { kind: 'pdf', open: (signal) => file.open(signal) },
        new AbortController().signal
      )
    ).rejects.toThrow('Document "handout.pdf" failed its integrity check.')
    expect(reads).toBe(1)
    expect(requests).toHaveLength(0)
  })

  it('rejects and deletes a file the endpoint accepted although the body failed', async () => {
    const deleted: string[] = []
    let sourceFailed = false
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.method === 'DELETE') {
        deleted.push(new URL(request.url).pathname)
        return jsonResponse({ id: 'file_early', type: 'file_deleted' })
      }
      await request.arrayBuffer().catch(() => {})
      return jsonResponse(fileMetadata('file_early'))
    }
    const failing: AnthropicUploadSource = {
      kind: 'pdf',
      open: async () =>
        new ReadableStream<Uint8Array>({
          pull(controller) {
            sourceFailed = true
            controller.error(new Error('Storage responded 500'))
          },
        }),
    }
    await expect(
      uploadAnthropicFile(getAnthropicClient({ fetch: fetchMock }), failing, new AbortController().signal)
    ).rejects.toThrow('Storage responded 500')
    expect(sourceFailed).toBe(true)
    expect(deleted).toEqual(['/v1/files/file_early'])
  })

  it('aborts the upload and cancels the source read when the signal fires', async () => {
    const controller = new AbortController()
    let cancelled: unknown = null
    const stalled: AnthropicUploadSource = {
      kind: 'pdf',
      open: async () =>
        new ReadableStream<Uint8Array>({
          pull() {
            return new Promise(() => {})
          },
          cancel(reason) {
            cancelled = reason
          },
        }, { highWaterMark: 0 }),
    }
    const fetchMock = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const reader = (init!.body as ReadableStream<Uint8Array>).getReader()
      await reader.read()
      const pending = reader.read()
      setTimeout(() => controller.abort(new Error('timed out')), 5)
      await pending.catch(() => {})
      throw init!.signal!.reason
    }
    await expect(
      uploadAnthropicFile(getAnthropicClient({ fetch: fetchMock }), stalled, controller.signal)
    ).rejects.toThrow()
    expect(cancelled).not.toBeNull()
  })
})

describe('deleteAnthropicFiles', () => {
  it('deletes every id, treats 404 as deleted, and logs only a failure count', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { fetch, requests } = queuedFetch([
      jsonResponse({ id: 'file_a', type: 'file_deleted' }),
      jsonResponse({ type: 'error', error: { type: 'not_found_error', message: 'gone' } }, 404),
      jsonResponse({ type: 'error', error: { type: 'invalid_request_error', message: 'no' } }, 400),
    ])
    const failed = await deleteAnthropicFiles(getAnthropicClient({ fetch }), ['file_a', 'file_b', 'file_c'])

    expect(failed).toBe(1)
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      'DELETE /v1/files/file_a',
      'DELETE /v1/files/file_b',
      'DELETE /v1/files/file_c',
    ])
    expect(requests.every((request) => request.headers.get('anthropic-beta') === null)).toBe(true)
    expect(warn).toHaveBeenCalledWith('[ai] 1 Anthropic file deletion(s) failed; the daily sweep will retry')
  })

  it('does nothing for an empty list', async () => {
    const { fetch, requests } = queuedFetch([])
    await expect(deleteAnthropicFiles(getAnthropicClient({ fetch }), [])).resolves.toBe(0)
    expect(requests).toHaveLength(0)
  })
})

describe('sweepAnthropicFiles', () => {
  it('deletes only old Petrios-prefixed files across pages', async () => {
    const now = new Date('2026-10-09T12:00:00Z')
    const { fetch, requests } = queuedFetch([
      jsonResponse({
        data: [
          fileMetadata('file_new', { filename: `${ANTHROPIC_FILE_PREFIX}new.pdf`, created_at: '2026-10-09T11:30:00Z' }),
          fileMetadata('file_other', { filename: 'someone-else.pdf', created_at: '2026-10-01T00:00:00Z' }),
          fileMetadata('file_old', { filename: `${ANTHROPIC_FILE_PREFIX}old.txt`, created_at: '2026-10-09T08:00:00Z' }),
        ],
        next_page: 'cursor_2',
      }),
      jsonResponse({ id: 'file_old', type: 'file_deleted' }),
      jsonResponse({
        data: [
          fileMetadata('file_older', { filename: `${ANTHROPIC_FILE_PREFIX}older.pdf`, created_at: '2026-10-08T08:00:00Z' }),
        ],
        next_page: null,
      }),
      jsonResponse({ type: 'error', error: { type: 'not_found_error', message: 'gone' } }, 404),
    ])

    const result = await sweepAnthropicFiles({ client: getAnthropicClient({ fetch }), now })

    expect(result).toEqual({ scanned: 4, deleted: 2, failed: 0 })
    expect(requests.map((request) => {
      const url = new URL(request.url)
      return `${request.method} ${url.pathname}${url.search}`
    })).toEqual([
      'GET /v1/files?limit=100',
      'DELETE /v1/files/file_old',
      'GET /v1/files?limit=100&page=cursor_2',
      'DELETE /v1/files/file_older',
    ])
  })

  it('stops at maxDeletes', async () => {
    const { fetch, requests } = queuedFetch([
      jsonResponse({
        data: ['a', 'b', 'c'].map((id) =>
          fileMetadata(`file_${id}`, { filename: `${ANTHROPIC_FILE_PREFIX}${id}.pdf`, created_at: '2026-10-01T00:00:00Z' })),
        next_page: null,
      }),
      jsonResponse({ id: 'file_a', type: 'file_deleted' }),
    ])
    const result = await sweepAnthropicFiles({ client: getAnthropicClient({ fetch }), maxDeletes: 1 })
    expect(result).toEqual({ scanned: 1, deleted: 1, failed: 0 })
    expect(requests).toHaveLength(2)
  })
})
