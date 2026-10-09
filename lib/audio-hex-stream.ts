/**
 * Streaming decoder for a PostgREST single-object JSON body whose one selected
 * column is a BYTEA, e.g. `{"audio":"\\x49443303..."}`. PostgREST renders
 * BYTEA as `\x` + hex, which JSON escapes to `"\\x`. Decoding chunk by chunk
 * avoids holding the hex string (2x the blob) and a decoded copy at once.
 */

export type HexJsonValueErrorCode = 'NULL_VALUE' | 'MALFORMED'

export class HexJsonValueError extends Error {
  readonly code: HexJsonValueErrorCode

  constructor(code: HexJsonValueErrorCode, message: string) {
    super(message)
    this.name = 'HexJsonValueError'
    this.code = code
  }
}

const QUOTE = 0x22
// `"\\x` — opening quote, JSON-escaped backslash, then the bytea hex marker.
const VALUE_OPENING = [QUOTE, 0x5c, 0x5c, 0x78]
const MAX_PREFIX_BYTES = 1024

const HEX_VALUES = (() => {
  const table = new Int8Array(256).fill(-1)
  for (let i = 0; i < 10; i++) table[0x30 + i] = i
  for (let i = 0; i < 6; i++) {
    table[0x41 + i] = 10 + i
    table[0x61 + i] = 10 + i
  }
  return table
})()

function malformed(message: string): HexJsonValueError {
  return new HexJsonValueError('MALFORMED', message)
}

function isSingleNullObject(prefix: number[]): boolean {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(prefix)))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const entries = Object.values(value)
    return entries.length === 1 && entries[0] === null
  } catch {
    return false
  }
}

export class HexJsonValueDecoder {
  private state: 'prefix' | 'hex' | 'suffix' = 'prefix'
  private prefix: number[] = []
  private matched = 0
  private pendingNibble = -1

  /** Returns the bytes decoded from this chunk (possibly empty). */
  push(chunk: Uint8Array): Uint8Array {
    let index = this.state === 'prefix' ? this.skipPrefix(chunk) : 0
    if (this.state !== 'hex') return new Uint8Array(0)

    const out = new Uint8Array((chunk.length - index + 1) >> 1)
    let written = 0
    let pending = this.pendingNibble
    for (; index < chunk.length; index++) {
      const byte = chunk[index]
      if (byte === QUOTE) {
        if (pending !== -1) throw malformed('BYTEA hex value has an odd number of digits')
        this.state = 'suffix'
        break
      }
      const value = HEX_VALUES[byte]
      if (value < 0) {
        throw malformed(`Unexpected byte 0x${byte.toString(16).padStart(2, '0')} in BYTEA hex value`)
      }
      if (pending === -1) {
        pending = value
      } else {
        out[written++] = (pending << 4) | value
        pending = -1
      }
    }
    this.pendingNibble = pending
    return out.subarray(0, written)
  }

  /** Call once the body has ended; throws unless a complete value was decoded. */
  finish(): void {
    if (this.state === 'suffix') return
    if (this.state === 'hex') throw malformed('BYTEA hex value is unterminated')
    if (isSingleNullObject(this.prefix)) {
      throw new HexJsonValueError('NULL_VALUE', 'BYTEA value is null')
    }
    throw malformed('No BYTEA hex value found in the response')
  }

  /** Consumes JSON up to and including `"\\x`; returns the index after it. */
  private skipPrefix(chunk: Uint8Array): number {
    for (let index = 0; index < chunk.length; index++) {
      const byte = chunk[index]
      if (this.prefix.length >= MAX_PREFIX_BYTES) {
        throw malformed('No BYTEA hex value found in the response')
      }
      this.prefix.push(byte)
      if (byte === VALUE_OPENING[this.matched]) {
        this.matched += 1
        if (this.matched === VALUE_OPENING.length) {
          this.state = 'hex'
          this.prefix = []
          return index + 1
        }
      } else {
        // Only the quote can restart a partial match: it occurs once, first.
        this.matched = byte === QUOTE ? 1 : 0
      }
    }
    return chunk.length
  }
}

export function createHexJsonValueDecoderStream(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new HexJsonValueDecoder()
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const bytes = decoder.push(chunk)
      if (bytes.length > 0) controller.enqueue(bytes)
    },
    flush() {
      decoder.finish()
    },
  })
}

/**
 * Decodes the body as a byte stream, resolving null for a NULL value so a
 * route can still answer 404 before committing to a 200. Reads ahead only
 * until the first decoded bytes (or the end of a short body).
 */
export async function decodeHexJsonValueBody(
  body: ReadableStream<Uint8Array>
): Promise<ReadableStream<Uint8Array> | null> {
  const reader = body.pipeThrough(createHexJsonValueDecoderStream()).getReader()
  let first: ReadableStreamReadResult<Uint8Array>
  try {
    first = await reader.read()
  } catch (error) {
    if (error instanceof HexJsonValueError && error.code === 'NULL_VALUE') return null
    throw error
  }

  let head = first.done ? undefined : first.value
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (head) {
        controller.enqueue(head)
        head = undefined
        return
      }
      const next = await reader.read()
      if (next.done) controller.close()
      else controller.enqueue(next.value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}
