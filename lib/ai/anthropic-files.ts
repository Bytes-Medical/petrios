import { randomUUID } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import type { FileMetadata } from '@anthropic-ai/sdk/resources/files'
import { getAnthropicClient } from './provider'
import { streamedBodyRedirectMode } from './streaming-body'

/**
 * Anthropic Files API lifecycle for private learning documents (upload,
 * delete, orphan sweep). Files-only: no inference happens here; model calls
 * stay in lib/ai/llm.ts, which uploads a request's documents one at a time,
 * references them by file_id, and deletes them in a `finally` block.
 *
 * Every upload:
 *   - streams a multipart body through the SDK's generic `client.post` (the
 *     SDK's `files.upload()` materialises the whole file as a Blob), so at
 *     most a few chunks of one document are in memory at a time;
 *   - carries an opaque `petrios-ai-<uuid>` filename (no display name or
 *     other personal data in provider file metadata) that the sweep matches;
 *   - expires after one hour (`expires_in_seconds`, the API minimum) as a
 *     server-side backstop if both the delete and the sweep fail.
 *
 * Files are workspace-scoped: run Petrios with a dedicated Anthropic
 * workspace and key. File ids are server-side only and never accepted from
 * users.
 */

export const ANTHROPIC_FILE_PREFIX = 'petrios-ai-'
export const ANTHROPIC_FILE_TTL_SECONDS = 3600
export const ANTHROPIC_UPLOAD_TIMEOUT_MS = 5 * 60 * 1000
export const ANTHROPIC_DELETE_TIMEOUT_MS = 30 * 1000
/** One retry for transient failures; the body is re-opened from its source each time. */
export const ANTHROPIC_UPLOAD_ATTEMPTS = 2

const UPLOAD_RETRY_DELAY_MS = 1000
const SWEEP_DEFAULT_AGE_MS = 2 * 60 * 60 * 1000
const SWEEP_DEFAULT_MAX_DELETES = 200
const SWEEP_MAX_SCANNED = 2000

export type AnthropicUploadKind = 'pdf' | 'text'

export interface AnthropicUploadSource {
  kind: AnthropicUploadKind
  /** A fresh read of the bytes for one upload attempt; aborting the signal cancels it. */
  open(signal: AbortSignal): Promise<ReadableStream<Uint8Array>>
}

const TEXT_CHUNK_BYTES = 64 * 1024

/** Upload source for extracted document text (UTF-8, streamed in 64 KiB chunks). */
export function textUploadSource(text: string): AnthropicUploadSource {
  return {
    kind: 'text',
    async open() {
      const bytes = new TextEncoder().encode(text)
      let offset = 0
      return new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (offset >= bytes.byteLength) {
              controller.close()
              return
            }
            controller.enqueue(bytes.subarray(offset, offset + TEXT_CHUNK_BYTES))
            offset += TEXT_CHUNK_BYTES
          },
        },
        { highWaterMark: 0 }
      )
    },
  }
}

interface MultipartBody {
  stream: ReadableStream<Uint8Array>
  /** First error raised by the document source (undefined if none, or if caused by abort). */
  failure(): unknown
  /**
   * Ends this attempt: cancels a source read still in flight and releases the
   * attempt's abort listener. Until then the listener (and through it the
   * source, e.g. a document's extracted text) stays reachable from the
   * request signal for as long as that signal lives.
   */
  dispose(): void
}

/**
 * multipart/form-data with an `expires_in_seconds` field and the file part.
 * The closing boundary is emitted only after the source ends cleanly, so a
 * storage or integrity failure never completes the upload.
 */
function multipartBody(input: {
  boundary: string
  filename: string
  contentType: string
  source: AnthropicUploadSource
  signal: AbortSignal
}): MultipartBody {
  const encoder = new TextEncoder()
  const head = encoder.encode(
    `--${input.boundary}\r\n` +
      'Content-Disposition: form-data; name="expires_in_seconds"\r\n\r\n' +
      `${ANTHROPIC_FILE_TTL_SECONDS}\r\n` +
      `--${input.boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${input.filename}"\r\n` +
      `Content-Type: ${input.contentType}\r\n\r\n`
  )
  const tail = encoder.encode(`\r\n--${input.boundary}--\r\n`)

  const cancelled = new AbortController()
  const linked = AbortSignal.any([input.signal, cancelled.signal])
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  // Cancelling the reader settles a read already in flight.
  linked.addEventListener('abort', () => void reader?.cancel(linked.reason).catch(() => {}), {
    once: true,
  })

  let started = false
  let failure: unknown = undefined
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          linked.throwIfAborted()
          if (!started) {
            started = true
            controller.enqueue(head)
            return
          }
          reader ??= (await input.source.open(linked)).getReader()
          linked.throwIfAborted()
          const read = await reader.read()
          linked.throwIfAborted()
          if (read.done) {
            controller.enqueue(tail)
            controller.close()
            // Done with the source: release this attempt's listener now.
            cancelled.abort()
          } else {
            controller.enqueue(read.value)
          }
        } catch (error) {
          if (!linked.aborted && failure === undefined) failure = error
          controller.error(error)
          await reader?.cancel(error).catch(() => {})
          cancelled.abort(error)
        }
      },
      cancel(reason) {
        cancelled.abort(reason)
      },
    },
    { highWaterMark: 0 }
  )
  return { stream, failure: () => failure, dispose: () => cancelled.abort() }
}

function isRetryableUploadError(error: unknown): boolean {
  if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError) {
    return true
  }
  return error instanceof Anthropic.APIConnectionError
    && !(error instanceof Anthropic.APIConnectionTimeoutError)
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Streams one document to `POST /v1/files` (stable Files API; no beta
 * header). Retries once on a rate limit, 5xx or connection failure; never
 * retries when the document source itself failed (storage or integrity),
 * which is rethrown unchanged.
 */
export async function uploadAnthropicFile(
  client: Anthropic,
  source: AnthropicUploadSource,
  signal: AbortSignal
): Promise<FileMetadata> {
  for (let attempt = 1; ; attempt++) {
    const boundary = `petrios-${randomUUID()}`
    const extension = source.kind === 'pdf' ? 'pdf' : 'txt'
    const body = multipartBody({
      boundary,
      filename: `${ANTHROPIC_FILE_PREFIX}${randomUUID()}.${extension}`,
      contentType: source.kind === 'pdf' ? 'application/pdf' : 'text/plain',
      source,
      signal,
    })

    let metadata: FileMetadata
    try {
      metadata = await client.post<FileMetadata>('/v1/files', {
        body: body.stream,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        // 'error'/'manual' keeps Node from teeing the streamed body for a
        // redirect replay; no-store keeps Next's fetch cache off the body.
        fetchOptions: { redirect: streamedBodyRedirectMode(), cache: 'no-store' },
        signal,
        timeout: ANTHROPIC_UPLOAD_TIMEOUT_MS,
        // The SDK never retries a stream body; retries happen here so each
        // attempt re-opens the source.
        maxRetries: 0,
      })
    } catch (error) {
      body.dispose()
      const failure = body.failure()
      if (failure !== undefined) throw failure
      if (signal.aborted || attempt >= ANTHROPIC_UPLOAD_ATTEMPTS || !isRetryableUploadError(error)) {
        throw error
      }
      await delay(UPLOAD_RETRY_DELAY_MS * attempt, signal)
      continue
    }

    body.dispose()
    // A body that failed never completed, so nothing the endpoint returned
    // can be accepted (and anything it stored is removed).
    const failure = body.failure()
    if (failure !== undefined) {
      if (typeof metadata?.id === 'string') await deleteAnthropicFiles(client, [metadata.id])
      throw failure
    }
    if (typeof metadata?.id !== 'string' || !metadata.id) {
      throw new Error('The AI provider returned an invalid file upload response')
    }
    return metadata
  }
}

/**
 * Deletes every id (allSettled, own timeout, no request signal: this runs in
 * `finally` after the request signal may already be aborted). A 404 counts as
 * deleted. Returns the number of failures; only counts are logged.
 */
export async function deleteAnthropicFiles(client: Anthropic, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0
  const results = await Promise.allSettled(
    ids.map((id) => client.files.delete(id, {}, { timeout: ANTHROPIC_DELETE_TIMEOUT_MS }))
  )
  const failed = results.filter(
    (result) => result.status === 'rejected' && !(result.reason instanceof Anthropic.NotFoundError)
  ).length
  if (failed > 0) {
    console.warn(`[ai] ${failed} Anthropic file deletion(s) failed; the daily sweep will retry`)
  }
  return failed
}

export interface AnthropicFileSweepResult {
  scanned: number
  deleted: number
  failed: number
}

/**
 * Deletes leftover Petrios uploads (filename prefix match) older than
 * `olderThanMs` (default 2 h, longer than any generation). Also clears the
 * 30-day metadata of expired files. Lists newest first with auto-pagination;
 * bounded by `maxDeletes` and a scan cap. Files without the prefix are never
 * touched.
 */
export async function sweepAnthropicFiles(options: {
  client?: Anthropic
  olderThanMs?: number
  maxDeletes?: number
  now?: Date
} = {}): Promise<AnthropicFileSweepResult> {
  const client = options.client ?? getAnthropicClient()
  const cutoff = (options.now ?? new Date()).getTime() - (options.olderThanMs ?? SWEEP_DEFAULT_AGE_MS)
  const maxDeletes = options.maxDeletes ?? SWEEP_DEFAULT_MAX_DELETES
  const result: AnthropicFileSweepResult = { scanned: 0, deleted: 0, failed: 0 }

  for await (const file of client.files.list({ limit: 100 })) {
    if (result.scanned >= SWEEP_MAX_SCANNED) break
    result.scanned += 1
    if (!file.filename.startsWith(ANTHROPIC_FILE_PREFIX)) continue
    const created = Date.parse(file.created_at)
    if (!(created < cutoff)) continue
    try {
      await client.files.delete(file.id, {}, { timeout: ANTHROPIC_DELETE_TIMEOUT_MS })
      result.deleted += 1
    } catch (error) {
      if (error instanceof Anthropic.NotFoundError) result.deleted += 1
      else result.failed += 1
    }
    if (result.deleted + result.failed >= maxDeletes) break
  }
  return result
}
