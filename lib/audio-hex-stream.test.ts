import { describe, expect, it } from 'vitest'
import {
  createHexJsonValueDecoderStream,
  decodeHexJsonValueBody,
  HexJsonValueDecoder,
  HexJsonValueError,
} from './audio-hex-stream'

const encoder = new TextEncoder()

// What PostgREST sends for `select=audio` with the singular-object Accept.
function postgrestBody(bytes: Uint8Array): string {
  return `{"audio":"\\\\x${Buffer.from(bytes).toString('hex')}"}`
}

function decodeChunks(chunks: (string | Uint8Array)[]): Uint8Array {
  const decoder = new HexJsonValueDecoder()
  const parts = chunks.map((chunk) =>
    decoder.push(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
  )
  decoder.finish()
  return Uint8Array.from(parts.flatMap((part) => Array.from(part)))
}

function expectDecodeError(chunks: string[], code: 'NULL_VALUE' | 'MALFORMED') {
  let caught: unknown
  try {
    decodeChunks(chunks)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(HexJsonValueError)
  expect((caught as HexJsonValueError).code).toBe(code)
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const bytes: number[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return Uint8Array.from(bytes)
    bytes.push(...value)
  }
}

describe('HexJsonValueDecoder', () => {
  const sample = Uint8Array.from([0x49, 0x44, 0x33, 0x00, 0xff, 0x0a, 0x22, 0x5c, 0xab])

  it('detects the JSON-escaped \\x prefix and decodes the hex value', () => {
    expect(postgrestBody(sample)).toBe('{"audio":"\\\\x494433' + '00ff0a225cab"}')
    expect(decodeChunks([postgrestBody(sample)])).toEqual(sample)
  })

  it('accepts uppercase hex digits', () => {
    expect(decodeChunks(['{"audio":"\\\\xABcd"}'])).toEqual(Uint8Array.from([0xab, 0xcd]))
  })

  it('requires the escaped backslash before x, restarting partial prefix matches', () => {
    // A preceding `"\\"` (an escaped backslash string) partially matches the
    // prefix and must not swallow the real opening that follows it.
    expect(decodeChunks(['{"note":"\\\\","audio":"\\\\x0102"}'])).toEqual(Uint8Array.from([1, 2]))
    expectDecodeError(['{"audio":"\\x0102"}'], 'MALFORMED')
  })

  it('decodes identically for every two-way chunk split', () => {
    const body = encoder.encode(postgrestBody(sample))
    for (let split = 0; split <= body.length; split++) {
      expect(decodeChunks([body.subarray(0, split), body.subarray(split)])).toEqual(sample)
    }
  })

  it('decodes identically for every three-way chunk split and one-byte chunks', () => {
    const body = encoder.encode(postgrestBody(sample))
    for (let first = 0; first <= body.length; first++) {
      for (let second = first; second <= body.length; second++) {
        expect(
          decodeChunks([
            body.subarray(0, first),
            body.subarray(first, second),
            body.subarray(second),
          ])
        ).toEqual(sample)
      }
    }
    expect(decodeChunks(Array.from(body, (byte) => Uint8Array.of(byte)))).toEqual(sample)
  })

  it('carries an odd nibble across chunk boundaries', () => {
    const decoder = new HexJsonValueDecoder()
    expect(decoder.push(encoder.encode('{"audio":"\\\\x0'))).toEqual(new Uint8Array(0))
    expect(decoder.push(encoder.encode('a1'))).toEqual(Uint8Array.from([0x0a]))
    expect(decoder.push(encoder.encode('f"}'))).toEqual(Uint8Array.from([0x1f]))
    decoder.finish()
  })

  it('round-trips a larger random payload in uneven chunks', () => {
    const payload = Uint8Array.from({ length: 20_000 }, (_, i) => (i * 7919 + 13) & 0xff)
    const body = encoder.encode(postgrestBody(payload))
    const chunks: Uint8Array[] = []
    for (let offset = 0, size = 1; offset < body.length; offset += size, size = (size * 3 + 1) % 4093 || 1) {
      chunks.push(body.subarray(offset, offset + size))
    }
    expect(decodeChunks(chunks)).toEqual(payload)
  })

  it('rejects non-hex characters and an odd digit count', () => {
    expectDecodeError(['{"audio":"\\\\x0g"}'], 'MALFORMED')
    expectDecodeError(['{"audio":"\\\\x0 1"}'], 'MALFORMED')
    expectDecodeError(['{"audio":"\\\\x012"}'], 'MALFORMED')
    expectDecodeError(['{"audio":"\\\\x01', '2"}'], 'MALFORMED')
  })

  it('ignores trailing JSON after the closing quote', () => {
    expect(decodeChunks(['{"audio":"\\\\x0102"}\n'])).toEqual(Uint8Array.from([1, 2]))
    expect(decodeChunks(['{"audio":"\\\\x0102"', ',"other":"zz"}'])).toEqual(Uint8Array.from([1, 2]))
  })

  it('decodes an empty BYTEA value to no bytes', () => {
    expect(decodeChunks(['{"audio":"\\\\x"}'])).toEqual(new Uint8Array(0))
  })

  it('reports a NULL value distinctly from a malformed or missing one', () => {
    expectDecodeError(['{"audio":null}'], 'NULL_VALUE')
    expectDecodeError(['{"audio":', 'null}'], 'NULL_VALUE')
    expectDecodeError(['{}'], 'MALFORMED')
    expectDecodeError(['{"audio":"abc"}'], 'MALFORMED')
    expectDecodeError([''], 'MALFORMED')
  })

  it('rejects an unterminated hex value', () => {
    expectDecodeError(['{"audio":"\\\\x0102'], 'MALFORMED')
  })

  it('bounds the JSON it skips before the value', () => {
    expectDecodeError([`{"padding":"${'a'.repeat(2000)}","audio":"\\\\x01"}`], 'MALFORMED')
  })
})

describe('createHexJsonValueDecoderStream', () => {
  it('pipes chunks through to decoded bytes', async () => {
    const body = encoder.encode(postgrestBody(Uint8Array.from([5, 6, 7])))
    const decoded = streamOf([body.subarray(0, 12), body.subarray(12)])
      .pipeThrough(createHexJsonValueDecoderStream())
    expect(await collect(decoded)).toEqual(Uint8Array.from([5, 6, 7]))
  })

  it('errors the stream on a NULL value', async () => {
    const decoded = streamOf([encoder.encode('{"audio":null}')])
      .pipeThrough(createHexJsonValueDecoderStream())
    await expect(collect(decoded)).rejects.toMatchObject({ code: 'NULL_VALUE' })
  })
})

describe('decodeHexJsonValueBody', () => {
  it('resolves a stream of the decoded bytes', async () => {
    const payload = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff)
    const body = encoder.encode(postgrestBody(payload))
    const chunks = [body.subarray(0, 5), body.subarray(5, 211), body.subarray(211)]
    const stream = await decodeHexJsonValueBody(streamOf(chunks))
    expect(stream).not.toBeNull()
    expect(await collect(stream!)).toEqual(payload)
  })

  it('resolves null for a NULL value before any bytes are produced', async () => {
    await expect(decodeHexJsonValueBody(streamOf([encoder.encode('{"audio":null}')]))).resolves.toBeNull()
  })

  it('rejects a malformed body instead of resolving a stream', async () => {
    await expect(
      decodeHexJsonValueBody(streamOf([encoder.encode('{"audio":"\\\\xzz"}')]))
    ).rejects.toMatchObject({ code: 'MALFORMED' })
  })

  it('errors the returned stream when corruption follows valid bytes', async () => {
    const stream = await decodeHexJsonValueBody(
      streamOf([encoder.encode('{"audio":"\\\\x0102'), encoder.encode('zz"}')])
    )
    await expect(collect(stream!)).rejects.toMatchObject({ code: 'MALFORMED' })
  })

  it('cancels the source when the consumer cancels', async () => {
    let cancelled = false
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"audio":"\\\\x0102'))
      },
      cancel() {
        cancelled = true
      },
    })
    const stream = await decodeHexJsonValueBody(source)
    await stream!.cancel('client went away')
    expect(cancelled).toBe(true)
  })
})
