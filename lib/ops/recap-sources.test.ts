import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listDocumentsMock, fetchObjectMock } = vi.hoisted(() => ({
  listDocumentsMock: vi.fn(),
  fetchObjectMock: vi.fn(),
}))

vi.mock('@/lib/db/session-documents', () => ({
  listSessionDocumentsAsSystem: listDocumentsMock,
  fetchDocumentObject: fetchObjectMock,
}))

import {
  AUDIO_RECAP_MAX_SOURCE_BYTES,
  buildRecapSourceSnapshot,
  loadRecapSourceFiles,
  recapSourcesAreCurrent,
} from './recap-sources'

const rows = [
  {
    id: 'b',
    display_name: 'slides.pptx',
    mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' as const,
    byte_size: 200,
    sha256: 'b'.repeat(64),
  },
  {
    id: 'a',
    display_name: 'handout.pdf',
    mime_type: 'application/pdf' as const,
    byte_size: 100,
    sha256: 'a'.repeat(64),
  },
]

describe('audio recap source snapshot', () => {
  it('is stable across database ordering and totals source bytes', () => {
    const first = buildRecapSourceSnapshot(rows)
    const second = buildRecapSourceSnapshot([...rows].reverse())
    expect(first).toEqual(second)
    expect(first.documents.map((document) => document.id)).toEqual(['a', 'b'])
    expect(first.totalBytes).toBe(300)
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('requires verified hashes and treats legacy/no-document recaps as stale', () => {
    expect(() => buildRecapSourceSnapshot([{ ...rows[0], sha256: null }])).toThrow(
      'no verified integrity hash'
    )
    const snapshot = buildRecapSourceSnapshot(rows)
    expect(recapSourcesAreCurrent(snapshot.digest, snapshot)).toBe(true)
    expect(recapSourcesAreCurrent(null, snapshot)).toBe(false)
    expect(recapSourcesAreCurrent(snapshot.digest, buildRecapSourceSnapshot([]))).toBe(false)
  })
})

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function storedRow(id: string, name: string, bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
  return {
    id,
    display_name: name,
    mime_type: 'application/pdf' as const,
    byte_size: bytes.byteLength,
    sha256: sha256(bytes),
    storage_path: `org/session/${id}.pdf`,
    ...overrides,
  }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = []
  const reader = stream.getReader()
  for (let read = await reader.read(); !read.done; read = await reader.read()) parts.push(read.value)
  return Buffer.concat(parts)
}

describe('loadRecapSourceFiles', () => {
  const handout = new TextEncoder().encode('%PDF-1.7 handout')
  const slides = new TextEncoder().encode('%PDF-1.7 slides as pdf')

  beforeEach(() => {
    listDocumentsMock.mockReset()
    fetchObjectMock.mockReset()
    fetchObjectMock.mockImplementation(async (storagePath: string) =>
      new Response(storagePath.endsWith('a.pdf') ? handout : slides)
    )
  })

  it('returns lazy inputs in snapshot order that stream verified storage objects', async () => {
    listDocumentsMock.mockResolvedValue([storedRow('b', 'slides.pdf', slides), storedRow('a', 'handout.pdf', handout)])

    const { snapshot, files, throwIfSourceFailed } = await loadRecapSourceFiles('session-1')

    expect(fetchObjectMock).not.toHaveBeenCalled()
    expect(snapshot.documents.map((document) => document.id)).toEqual(['a', 'b'])
    expect(files.map((file) => [file.filename, file.mimeType, file.sha256])).toEqual([
      ['handout.pdf', 'application/pdf', sha256(handout)],
      ['slides.pdf', 'application/pdf', sha256(slides)],
    ])

    const signal = new AbortController().signal
    expect((await readAll(await files[0].open(signal))).equals(Buffer.from(handout))).toBe(true)
    expect(fetchObjectMock).toHaveBeenCalledWith('org/session/a.pdf', { signal })
    expect(() => throwIfSourceFailed()).not.toThrow()
  })

  it('fails the stream and reports the original message when stored integrity does not match', async () => {
    listDocumentsMock.mockResolvedValue([storedRow('a', 'handout.pdf', handout, { sha256: 'f'.repeat(64) })])

    const { files, throwIfSourceFailed } = await loadRecapSourceFiles('session-1')
    const message = 'Document "handout.pdf" failed its integrity check. Re-upload it before generating the recap.'

    await expect(readAll(await files[0].open(new AbortController().signal))).rejects.toThrow(message)
    expect(() => throwIfSourceFailed()).toThrow(message)
  })

  it('reports a storage read failure through throwIfSourceFailed', async () => {
    listDocumentsMock.mockResolvedValue([storedRow('a', 'handout.pdf', handout)])
    fetchObjectMock.mockRejectedValue(new Error('Failed to read session document: Storage responded 404'))

    const { files, throwIfSourceFailed } = await loadRecapSourceFiles('session-1')

    await expect(files[0].open(new AbortController().signal)).rejects.toThrow('Storage responded 404')
    expect(() => throwIfSourceFailed()).toThrow('Storage responded 404')
  })

  it('rejects empty and oversized document sets before any storage read', async () => {
    listDocumentsMock.mockResolvedValue([])
    await expect(loadRecapSourceFiles('session-1')).rejects.toThrow('Upload at least one')

    listDocumentsMock.mockResolvedValue([
      storedRow('a', 'big.pdf', handout, { byte_size: AUDIO_RECAP_MAX_SOURCE_BYTES }),
      storedRow('b', 'more.pdf', slides),
    ])
    await expect(loadRecapSourceFiles('session-1')).rejects.toThrow('50 MiB combined AI input limit')
    expect(fetchObjectMock).not.toHaveBeenCalled()
  })
})
