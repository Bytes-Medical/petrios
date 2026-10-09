import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  Base64Encoder,
  streamJsonWithFileData,
  verifiedFileSources,
  type LlmFileInput,
  type VerifiedFileSource,
} from './streaming-body'

function seededBytes(length: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length)
  let state = seed >>> 0
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    bytes[i] = state >>> 24
  }
  return bytes
}

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

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  const reader = stream.getReader()
  for (let read = await reader.read(); !read.done; read = await reader.read()) parts.push(read.value)
  return Buffer.concat(parts)
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const text = new TextEncoder()
const neverAborted = new AbortController().signal

function memoryFile(bytes: Uint8Array, mimeType: string, chunkSize: number): LlmFileInput {
  return {
    filename: 'file',
    mimeType,
    sha256: sha256(bytes),
    open: async () => chunked(bytes, chunkSize),
  }
}

describe('Base64Encoder', () => {
  it('matches one-shot base64 for every length and chunking, carrying partial groups', () => {
    for (let length = 0; length <= 40; length++) {
      const bytes = seededBytes(length, length + 1)
      const expected = Buffer.from(bytes).toString('base64')
      for (let size = 1; size <= 8; size++) {
        const encoder = new Base64Encoder()
        let out = ''
        for (let offset = 0; offset < length; offset += size) {
          out += Buffer.from(encoder.encode(bytes.subarray(offset, offset + size))).toString('latin1')
        }
        out += Buffer.from(encoder.flush()).toString('latin1')
        expect(out, `length ${length}, chunk ${size}`).toBe(expected)
      }
    }
  })

  it('matches for large inputs split at irregular boundaries', () => {
    const bytes = seededBytes(1_000_003, 7)
    const encoder = new Base64Encoder()
    const parts: Buffer[] = []
    const sizes = [1, 65_536, 2, 3, 4097, 100_000, 5]
    for (let offset = 0, step = 0; offset < bytes.byteLength; step++) {
      const size = sizes[step % sizes.length]
      parts.push(Buffer.from(encoder.encode(bytes.subarray(offset, offset + size))))
      offset += size
    }
    parts.push(Buffer.from(encoder.flush()))
    expect(Buffer.concat(parts).toString('latin1')).toBe(Buffer.from(bytes).toString('base64'))
  })
})

describe('streamJsonWithFileData', () => {
  const tricky = [
    'plain',
    'quotes " and \\ backslashes',
    'newline\nand\ttab and \u0000 control',
    'unicode é ü 漢字 and emoji 😀 and lone \ud800 surrogate',
    '</script><!-- and "data:x;base64,AAAA"',
  ]

  function build(files: { name: string; mimeType: string; bytes: Uint8Array }[], prompt: string) {
    return (fileData: (index: number) => string) => ({
      instructions: tricky.join(' | '),
      nested: { list: [1, 2.5, true, null], prompt },
      content: [
        ...files.map((file, index) => ({
          type: 'input_file',
          filename: file.name,
          file_data: fileData(index),
          ...(file.mimeType === 'application/pdf' ? { detail: 'auto' } : {}),
        })),
        { type: 'input_text', text: prompt },
      ],
    })
  }

  it('is byte-for-byte JSON.stringify of the materialized body for any chunk size', async () => {
    const samples = [
      [{ name: tricky[3], mimeType: 'application/pdf', bytes: seededBytes(1, 1) }],
      [
        { name: tricky[1], mimeType: 'application/pdf', bytes: seededBytes(2, 2) },
        { name: tricky[2], mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', bytes: seededBytes(3, 3) },
        { name: tricky[4], mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: seededBytes(1000, 4) },
      ],
      [
        { name: 'a.pdf', mimeType: 'application/pdf', bytes: seededBytes(65_537, 5) },
        { name: 'b.pdf', mimeType: 'application/pdf', bytes: new Uint8Array(0) },
        { name: 'c.pdf', mimeType: 'application/pdf', bytes: seededBytes(4, 6) },
      ],
    ]
    for (const files of samples) {
      const template = build(files, tricky.join('\n'))
      const expected = JSON.stringify(
        template((index) =>
          `data:${files[index].mimeType};base64,${Buffer.from(files[index].bytes).toString('base64')}`
        )
      )
      for (const size of [1, 2, 3, 4, 5, 7, 11, 64, 1000, 4096, 1_000_000]) {
        const body = streamJsonWithFileData(
          template,
          files.map((file) => memoryFile(file.bytes, file.mimeType, size)),
          neverAborted
        )
        const actual = await readAll(body.stream)
        expect(Buffer.from(actual).equals(Buffer.from(text.encode(expected))), `chunk ${size}`).toBe(true)
        expect(body.failure()).toBeUndefined()
      }
    }
  })

  it('rejects a template that omits, repeats, or reorders a file placeholder', () => {
    const files = [memoryFile(seededBytes(3, 1), 'application/pdf', 3), memoryFile(seededBytes(3, 2), 'application/pdf', 3)]
    expect(() => streamJsonWithFileData((fileData) => [fileData(0)], files, neverAborted)).toThrow('exactly once')
    expect(() =>
      streamJsonWithFileData((fileData) => [fileData(0), fileData(0), fileData(1)], files, neverAborted)
    ).toThrow('exactly once')
    expect(() => streamJsonWithFileData((fileData) => [fileData(1), fileData(0)], files, neverAborted)).toThrow(
      'exactly once'
    )
  })

  it('opens each document only when the body reaches it, one at a time', async () => {
    const events: string[] = []
    const files = ['a', 'b', 'c'].map((name, index): LlmFileInput => ({
      filename: name,
      mimeType: 'application/pdf',
      sha256: '0'.repeat(64),
      async open() {
        events.push(`open ${name}`)
        const bytes = seededBytes(10, index + 1)
        let sent = false
        return new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent) {
              events.push(`end ${name}`)
              controller.close()
            } else {
              sent = true
              controller.enqueue(bytes)
            }
          },
        })
      },
    }))
    const body = streamJsonWithFileData((fileData) => files.map((_, i) => fileData(i)), files, neverAborted)
    expect(events).toEqual([])
    await readAll(body.stream)
    expect(events).toEqual(['open a', 'end a', 'open b', 'end b', 'open c', 'end c'])
  })

  it('streams a 50 MiB document with bounded buffering instead of materializing it', async () => {
    const size = 50 * 1024 * 1024
    const sourceChunk = 64 * 1024 + 1
    const byteAt = (position: number) => (Math.imul(position, 2654435761) >>> 24) & 0xff
    const fill = (start: number, length: number) => {
      const chunk = new Uint8Array(length)
      for (let i = 0; i < length; i++) chunk[i] = byteAt(start + i)
      return chunk
    }

    // Independent expectation: hash of prefix + base64 (via Buffer, 3-aligned
    // blocks) + suffix, computed without holding the document either.
    const expectedSource = createHash('sha256')
    const expectedBody = createHash('sha256')
    const prefix = '{"file_data":"data:application/pdf;base64,'
    expectedBody.update(prefix)
    for (let start = 0; start < size; start += 3 * 65_536) {
      const block = fill(start, Math.min(3 * 65_536, size - start))
      expectedSource.update(block)
      expectedBody.update(Buffer.from(block).toString('base64'))
    }
    expectedBody.update('"}')
    const documentSha256 = expectedSource.digest('hex')

    let produced = 0
    let consumedBase64 = 0
    let maxLag = 0
    let maxChunk = 0
    const [file] = verifiedFileSources([{
      filename: 'large.pdf',
      mimeType: 'application/pdf',
      byteSize: size,
      sha256: documentSha256,
      read: async () =>
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (produced >= size) {
              controller.close()
              return
            }
            const length = Math.min(sourceChunk, size - produced)
            controller.enqueue(fill(produced, length))
            produced += length
          },
        }, { highWaterMark: 0 }),
      integrityError: () => new Error('integrity'),
    }]).files

    const body = streamJsonWithFileData((fileData) => ({ file_data: fileData(0) }), [file], neverAborted)
    const actualBody = createHash('sha256')
    const reader = body.stream.getReader()
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      actualBody.update(read.value)
      maxChunk = Math.max(maxChunk, read.value.byteLength)
      consumedBase64 += read.value.byteLength
      // Source bytes pulled from storage but not yet handed to the consumer.
      maxLag = Math.max(maxLag, produced - Math.floor(((consumedBase64 - prefix.length) * 3) / 4))
    }

    expect(produced).toBe(size)
    expect(actualBody.digest('hex')).toBe(expectedBody.digest('hex'))
    expect(maxChunk).toBeLessThanOrEqual(256 * 1024 + 2)
    expect(maxLag).toBeLessThanOrEqual(2 * sourceChunk)
  }, 60_000)
})

function source(bytes: Uint8Array, overrides: Partial<VerifiedFileSource> = {}): VerifiedFileSource {
  return {
    filename: 'handout.pdf',
    mimeType: 'application/pdf',
    byteSize: bytes.byteLength,
    sha256: sha256(bytes),
    read: async () => chunked(bytes, 7),
    integrityError: () => new Error('Document "handout.pdf" failed its integrity check.'),
    ...overrides,
  }
}

describe('verifiedFileSources', () => {
  it('opens lazily and passes verified bytes through unchanged', async () => {
    const bytes = seededBytes(100, 3)
    let reads = 0
    const sources = verifiedFileSources([
      source(bytes, {
        read: async () => {
          reads += 1
          return chunked(bytes, 7)
        },
      }),
    ])
    expect(reads).toBe(0)
    expect(sources.files[0]).toMatchObject({ filename: 'handout.pdf', mimeType: 'application/pdf', sha256: sha256(bytes) })
    const first = await readAll(await sources.files[0].open(neverAborted))
    const second = await readAll(await sources.files[0].open(neverAborted))
    expect(Buffer.from(first).equals(Buffer.from(bytes))).toBe(true)
    expect(Buffer.from(second).equals(Buffer.from(bytes))).toBe(true)
    expect(reads).toBe(2)
    expect(() => sources.throwIfFailed()).not.toThrow()
  })

  it('fails a hash mismatch before the JSON is completed and reports the original error', async () => {
    const bytes = seededBytes(100, 3)
    const sources = verifiedFileSources([source(bytes, { sha256: 'f'.repeat(64) })])
    const body = streamJsonWithFileData((fileData) => ({ file_data: fileData(0) }), sources.files, neverAborted)
    const received: Uint8Array[] = []
    const reader = body.stream.getReader()
    await expect((async () => {
      for (let read = await reader.read(); !read.done; read = await reader.read()) received.push(read.value)
    })()).rejects.toThrow('failed its integrity check')
    expect(Buffer.concat(received).toString('latin1')).not.toMatch(/"\}$/)
    expect(body.failure()).toBeInstanceOf(Error)
    expect(() => sources.throwIfFailed()).toThrow('Document "handout.pdf" failed its integrity check.')
  })

  it('stops reading as soon as the object is larger than its stored size', async () => {
    const bytes = seededBytes(1000, 4)
    let pulled = 0
    let cancelled: unknown = null
    const sources = verifiedFileSources([
      source(bytes, {
        byteSize: 10,
        read: async () =>
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulled += 1
              controller.enqueue(bytes.slice(0, 8))
            },
            cancel(reason) {
              cancelled = reason
            },
          }, { highWaterMark: 0 }),
      }),
    ])
    await expect(readAll(await sources.files[0].open(neverAborted))).rejects.toThrow('integrity check')
    expect(pulled).toBe(2)
    expect(cancelled).toBeInstanceOf(Error)
    expect(() => sources.throwIfFailed()).toThrow('integrity check')
  })

  it('treats a truncated or missing object as an integrity failure', async () => {
    const bytes = seededBytes(100, 5)
    const short = verifiedFileSources([source(bytes, { read: async () => chunked(bytes.slice(0, 99), 7) })])
    await expect(readAll(await short.files[0].open(neverAborted))).rejects.toThrow('integrity check')
    expect(() => short.throwIfFailed()).toThrow('integrity check')

    const missing = verifiedFileSources([source(bytes, { read: async () => null })])
    await expect(missing.files[0].open(neverAborted)).rejects.toThrow('integrity check')
    expect(() => missing.throwIfFailed()).toThrow('integrity check')
  })

  it('records storage failures but not reads cancelled by an abort', async () => {
    const bytes = seededBytes(100, 6)
    const failing = verifiedFileSources([
      source(bytes, { read: async () => { throw new Error('Failed to read session document') } }),
    ])
    await expect(failing.files[0].open(neverAborted)).rejects.toThrow('Failed to read session document')
    expect(() => failing.throwIfFailed()).toThrow('Failed to read session document')

    const aborted = new AbortController()
    const cancelledRead = verifiedFileSources([
      source(bytes, {
        read: async (signal) => {
          aborted.abort(new Error('provider failed'))
          throw signal.reason
        },
      }),
    ])
    await expect(cancelledRead.files[0].open(aborted.signal)).rejects.toThrow('provider failed')
    expect(() => cancelledRead.throwIfFailed()).not.toThrow()
  })

  it('cancels the in-flight storage read when the body is aborted', async () => {
    const controller = new AbortController()
    let readSignal = null as AbortSignal | null
    let cancelled: unknown = null
    const sources = verifiedFileSources([
      source(seededBytes(10, 7), {
        read: async (signal) => {
          readSignal = signal
          return new ReadableStream<Uint8Array>({
            pull() {
              // Never resolves: a stalled storage response.
              return new Promise(() => {})
            },
            cancel(reason) {
              cancelled = reason
            },
          }, { highWaterMark: 0 })
        },
      }),
    ])
    const body = streamJsonWithFileData((fileData) => ({ file_data: fileData(0) }), sources.files, controller.signal)
    const reader = body.stream.getReader()
    await reader.read()
    await reader.read()
    const stalled = reader.read()
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort(new Error('timeout'))
    await expect(stalled).rejects.toThrow('timeout')
    expect(readSignal!.aborted).toBe(true)
    expect(cancelled).toBeInstanceOf(Error)
    expect(body.failure()).toBeUndefined()
    expect(() => sources.throwIfFailed()).not.toThrow()
  })
})
