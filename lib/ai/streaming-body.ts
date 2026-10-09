import { createHash, randomUUID } from 'node:crypto'

/**
 * Streaming request bodies for file-backed provider calls. Private documents
 * are read one at a time while the body uploads, so the extra memory is a few
 * chunks however large the documents are (a Workers isolate has 128 MB in
 * total, shared by concurrent requests).
 *
 * Base64Encoder/streamJsonWithFileData serve the OpenAI-compatible Responses
 * adapter only; verifiedFileSources and streamedBodyRedirectMode are shared
 * with the Anthropic Files API upload (lib/ai/anthropic-files.ts).
 */

/**
 * Node's fetch keeps a tee of a streamed body so it could replay it after a
 * redirect, which holds the whole upload in memory unless redirects are
 * refused outright. Workers do not buffer the body but reject 'error', so
 * they use 'manual' and a 3xx then fails the status check.
 */
export function streamedBodyRedirectMode(): RequestRedirect {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'
    ? 'manual'
    : 'error'
}

export interface LlmFileInput {
  filename: string
  mimeType: string
  /** Stored integrity hash used by the Ops audit fingerprint. */
  sha256: string
  /** A fresh read for one request attempt; aborting the signal cancels it. */
  open(signal: AbortSignal): Promise<ReadableStream<Uint8Array>>
}

const BASE64_CODES = new TextEncoder().encode(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
)
const BASE64_PAD = 0x3d

/** Bounds each emitted chunk to 256 KiB of base64 even if a source yields huge chunks. */
const MAX_ENCODE_SLICE = 3 * 64 * 1024

/** Incremental base64 that carries 0–2 bytes across chunk boundaries. */
export class Base64Encoder {
  private readonly carry = new Uint8Array(2)
  private carried = 0

  /** Encodes every complete 3-byte group seen so far, as ASCII bytes. */
  encode(chunk: Uint8Array): Uint8Array {
    const total = this.carried + chunk.byteLength
    if (total < 3) {
      this.carry.set(chunk, this.carried)
      this.carried = total
      return new Uint8Array(0)
    }
    const out = new Uint8Array(Math.floor(total / 3) * 4)
    let o = 0
    let i = 0
    if (this.carried > 0) {
      i = 3 - this.carried
      o = writeGroup(out, 0, this.carry[0], this.carried === 2 ? this.carry[1] : chunk[0], chunk[i - 1])
    }
    const end = chunk.byteLength - ((chunk.byteLength - i) % 3)
    for (; i < end; i += 3) o = writeGroup(out, o, chunk[i], chunk[i + 1], chunk[i + 2])
    this.carried = chunk.byteLength - end
    this.carry.set(chunk.subarray(end))
    return out
  }

  /** Encodes the final 0–2 carried bytes with padding. */
  flush(): Uint8Array {
    const carried = this.carried
    this.carried = 0
    if (carried === 0) return new Uint8Array(0)
    const b0 = this.carry[0]
    const b1 = carried === 2 ? this.carry[1] : 0
    return Uint8Array.of(
      BASE64_CODES[b0 >> 2],
      BASE64_CODES[((b0 & 0x03) << 4) | (b1 >> 4)],
      carried === 2 ? BASE64_CODES[(b1 & 0x0f) << 2] : BASE64_PAD,
      BASE64_PAD
    )
  }
}

function writeGroup(out: Uint8Array, o: number, b0: number, b1: number, b2: number): number {
  out[o] = BASE64_CODES[b0 >> 2]
  out[o + 1] = BASE64_CODES[((b0 & 0x03) << 4) | (b1 >> 4)]
  out[o + 2] = BASE64_CODES[((b1 & 0x0f) << 2) | (b2 >> 6)]
  out[o + 3] = BASE64_CODES[b2 & 0x3f]
  return o + 4
}

export interface StreamedJsonBody {
  stream: ReadableStream<Uint8Array>
  /** First error raised while producing the body (undefined if none, or if caused by abort). */
  failure(): unknown
}

/**
 * Streams the bytes of `JSON.stringify(build(fileData))` where `fileData(i)`
 * stands for the `data:<mime>;base64,...` URL of `files[i]`. Every non-file
 * byte comes from that one JSON.stringify call, so the stream is identical to
 * serializing the fully materialized body.
 */
export function streamJsonWithFileData(
  build: (fileData: (index: number) => string) => unknown,
  files: readonly LlmFileInput[],
  signal: AbortSignal
): StreamedJsonBody {
  const nonce = randomUUID()
  const placeholder = (index: number) => `${nonce}:${index}`
  const segments = splitAtPlaceholders(
    JSON.stringify(build(placeholder)),
    files.map((_, index) => JSON.stringify(placeholder(index)))
  )

  const cancelled = new AbortController()
  const linked = AbortSignal.any([signal, cancelled.signal])
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null
  // Cancelling the reader settles a read that is already in flight; the
  // aborted check in pull() then stops a cancelled read from ending the JSON.
  linked.addEventListener('abort', () => void activeReader?.cancel(linked.reason).catch(() => {}), {
    once: true,
  })
  const chunks = bodyChunks(segments, files, linked, (reader) => {
    activeReader = reader
  })

  let failure: unknown = undefined
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          linked.throwIfAborted()
          const next = await chunks.next()
          linked.throwIfAborted()
          if (next.done) controller.close()
          else controller.enqueue(next.value)
        } catch (error) {
          if (!linked.aborted && failure === undefined) failure = error
          controller.error(error)
        }
      },
      cancel(reason) {
        cancelled.abort(reason)
      },
    },
    { highWaterMark: 0 }
  )
  return { stream, failure: () => failure }
}

function splitAtPlaceholders(json: string, tokens: string[]): string[] {
  const segments: string[] = []
  let cursor = 0
  for (const token of tokens) {
    const at = json.indexOf(token)
    if (at < cursor || at !== json.lastIndexOf(token)) {
      throw new Error('Each file must appear exactly once, in order, in the request body')
    }
    segments.push(json.slice(cursor, at))
    cursor = at + token.length
  }
  segments.push(json.slice(cursor))
  return segments
}

async function* bodyChunks(
  segments: string[],
  files: readonly LlmFileInput[],
  signal: AbortSignal,
  track: (reader: ReadableStreamDefaultReader<Uint8Array> | null) => void
): AsyncGenerator<Uint8Array, void, undefined> {
  const text = new TextEncoder()
  yield text.encode(segments[0])
  for (const [index, file] of files.entries()) {
    yield text.encode(JSON.stringify(`data:${file.mimeType};base64,`).slice(0, -1))
    const base64 = new Base64Encoder()
    const reader = (await file.open(signal)).getReader()
    track(reader)
    let complete = false
    try {
      signal.throwIfAborted()
      for (let read = await reader.read(); !read.done; read = await reader.read()) {
        for (let offset = 0; offset < read.value.byteLength; offset += MAX_ENCODE_SLICE) {
          const encoded = base64.encode(read.value.subarray(offset, offset + MAX_ENCODE_SLICE))
          if (encoded.byteLength > 0) yield encoded
        }
      }
      complete = true
    } finally {
      track(null)
      if (!complete) await reader.cancel().catch(() => {})
    }
    // The last 0–2 bytes and the closing quote are only emitted once the
    // source has ended cleanly, so a failed integrity check never completes the JSON.
    yield concatBytes(base64.flush(), text.encode(`"${segments[index + 1]}`))
  }
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.byteLength + right.byteLength)
  out.set(left)
  out.set(right, left.byteLength)
  return out
}

export interface VerifiedFileSource {
  filename: string
  mimeType: string
  byteSize: number
  sha256: string
  /** Reads the stored object; null means no body was returned. */
  read(signal: AbortSignal): Promise<ReadableStream<Uint8Array> | null>
  /** The error reported when the object does not match byteSize/sha256. */
  integrityError(): Error
}

/**
 * Lazy file inputs whose bytes are checked against the stored size and
 * SHA-256 while they stream. A mismatch errors the stream before the file's
 * data URL is closed, so the provider never receives a complete request.
 * The Ops gateway turns provider failures into null, so callers use
 * throwIfFailed() to report the original storage or integrity error.
 */
export function verifiedFileSources(sources: VerifiedFileSource[]): {
  files: LlmFileInput[]
  throwIfFailed(): void
} {
  let failure: { error: unknown } | null = null
  const files = sources.map((source): LlmFileInput => ({
    filename: source.filename,
    mimeType: source.mimeType,
    sha256: source.sha256,
    async open(signal) {
      const fail = (error: unknown) => {
        if (!signal.aborted && !failure) failure = { error }
        return error
      }
      let body: ReadableStream<Uint8Array> | null
      try {
        body = await source.read(signal)
      } catch (error) {
        throw fail(error)
      }
      if (!body) throw fail(source.integrityError())
      return verifiedByteStream(body, source, fail)
    },
  }))
  return {
    files,
    throwIfFailed() {
      if (failure) throw failure.error
    },
  }
}

function verifiedByteStream(
  source: ReadableStream<Uint8Array>,
  expected: Pick<VerifiedFileSource, 'byteSize' | 'sha256' | 'integrityError'>,
  fail: (error: unknown) => unknown
): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  const hash = createHash('sha256')
  let received = 0
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        let read: ReadableStreamReadResult<Uint8Array>
        try {
          read = await reader.read()
        } catch (error) {
          controller.error(fail(error))
          return
        }
        if (read.done) {
          if (received === expected.byteSize && hash.digest('hex') === expected.sha256) {
            controller.close()
          } else {
            controller.error(fail(expected.integrityError()))
          }
          return
        }
        received += read.value.byteLength
        if (received > expected.byteSize) {
          const error = fail(expected.integrityError())
          controller.error(error)
          await reader.cancel(error).catch(() => {})
          return
        }
        hash.update(read.value)
        controller.enqueue(read.value)
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    },
    { highWaterMark: 0 }
  )
}
