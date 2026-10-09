import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpsSessionRow } from '@/lib/db/ops-reads'

const { listDocumentsMock, fetchObjectMock } = vi.hoisted(() => ({
  listDocumentsMock: vi.fn(),
  fetchObjectMock: vi.fn(),
}))

vi.mock('@/lib/db/session-documents', () => ({
  listSessionDocumentsAsSystem: listDocumentsMock,
  fetchDocumentObject: fetchObjectMock,
}))

import {
  loadNewsletterSourceFiles,
  NEWSLETTER_MAX_SOURCE_BYTES,
  NEWSLETTER_MAX_SOURCE_FILES,
} from './newsletter-sources'

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function session(id: string, title: string): OpsSessionRow {
  return {
    id,
    org_id: 'org',
    department_id: 'dept',
    title,
    description: null,
    date_start: '2026-10-05T09:00:00Z',
    date_end: '2026-10-05T10:00:00Z',
    location_type: 'IN_PERSON',
    status: 'PUBLISHED',
    session_type: null,
  }
}

function storedRow(id: string, name: string, bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
  return {
    id,
    display_name: name,
    mime_type: 'application/pdf',
    byte_size: bytes.byteLength,
    sha256: sha256(bytes),
    storage_path: `org/${id}.pdf`,
    ...overrides,
  }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = []
  const reader = stream.getReader()
  for (let read = await reader.read(); !read.done; read = await reader.read()) parts.push(read.value)
  return Buffer.concat(parts)
}

describe('loadNewsletterSourceFiles', () => {
  const objects: Record<string, Uint8Array<ArrayBuffer>> = {
    'org/d1.pdf': new TextEncoder().encode('%PDF-1.7 one'),
    'org/d2.pdf': new TextEncoder().encode('%PDF-1.7 two'),
    'org/d3.pdf': new TextEncoder().encode('%PDF-1.7 three'),
  }
  const sessions = [session('s1', 'Sepsis'), session('s2', 'Airway')]

  beforeEach(() => {
    listDocumentsMock.mockReset()
    fetchObjectMock.mockReset()
    fetchObjectMock.mockImplementation(async (storagePath: string) => new Response(objects[storagePath]))
  })

  it('maps every document to a session-labelled lazy input without reading storage', async () => {
    listDocumentsMock.mockImplementation(async (sessionId: string) =>
      sessionId === 's1'
        ? [storedRow('d1', 'one.pdf', objects['org/d1.pdf']), storedRow('d2', 'two.pdf', objects['org/d2.pdf'])]
        : [storedRow('d3', 'three.pdf', objects['org/d3.pdf'])]
    )

    const bundle = await loadNewsletterSourceFiles(sessions)

    expect(fetchObjectMock).not.toHaveBeenCalled()
    expect(bundle.files.map((file) => file.filename)).toEqual([
      'session-1-document-1-one.pdf',
      'session-1-document-2-two.pdf',
      'session-2-document-3-three.pdf',
    ])
    expect(bundle.documents).toEqual([
      { sessionId: 's1', sessionTitle: 'Sepsis', id: 'd1', filename: 'one.pdf', mimeType: 'application/pdf', byteSize: 12, sha256: sha256(objects['org/d1.pdf']) },
      { sessionId: 's1', sessionTitle: 'Sepsis', id: 'd2', filename: 'two.pdf', mimeType: 'application/pdf', byteSize: 12, sha256: sha256(objects['org/d2.pdf']) },
      { sessionId: 's2', sessionTitle: 'Airway', id: 'd3', filename: 'three.pdf', mimeType: 'application/pdf', byteSize: 14, sha256: sha256(objects['org/d3.pdf']) },
    ])
    expect(bundle.files.map((file) => file.sha256)).toEqual(bundle.documents.map((document) => document.sha256))

    const signal = new AbortController().signal
    expect((await readAll(await bundle.files[2].open(signal))).equals(Buffer.from(objects['org/d3.pdf']))).toBe(true)
    expect(fetchObjectMock).toHaveBeenCalledTimes(1)
    expect(fetchObjectMock).toHaveBeenCalledWith('org/d3.pdf', { signal })
    expect(() => bundle.throwIfSourceFailed()).not.toThrow()
  })

  it('fails the stream and reports the original message when stored integrity does not match', async () => {
    listDocumentsMock.mockImplementation(async (sessionId: string) =>
      sessionId === 's1' ? [storedRow('d1', 'one.pdf', objects['org/d1.pdf'], { byte_size: 11 })] : []
    )

    const bundle = await loadNewsletterSourceFiles(sessions)
    const message = 'Teaching document "one.pdf" failed its integrity check. Re-upload it before generating the newsletter.'

    await expect(readAll(await bundle.files[0].open(new AbortController().signal))).rejects.toThrow(message)
    expect(() => bundle.throwIfSourceFailed()).toThrow(message)
  })

  it('keeps the file-count, byte and stored-hash guards ahead of any storage read', async () => {
    const one = objects['org/d1.pdf']
    listDocumentsMock.mockResolvedValue(
      Array.from({ length: NEWSLETTER_MAX_SOURCE_FILES }, (_, index) => storedRow(`d${index}`, `${index}.pdf`, one))
    )
    await expect(loadNewsletterSourceFiles(sessions)).rejects.toThrow(
      `supports at most ${NEWSLETTER_MAX_SOURCE_FILES}`
    )

    listDocumentsMock.mockImplementation(async (sessionId: string) =>
      sessionId === 's1' ? [storedRow('d1', 'big.pdf', one, { byte_size: NEWSLETTER_MAX_SOURCE_BYTES })] : [storedRow('d2', 'two.pdf', one)]
    )
    await expect(loadNewsletterSourceFiles(sessions)).rejects.toThrow('50 MiB combined AI input limit')

    listDocumentsMock.mockResolvedValue([storedRow('d1', 'legacy.pdf', one, { sha256: null })])
    await expect(loadNewsletterSourceFiles(sessions)).rejects.toThrow('no verified integrity hash')
    expect(fetchObjectMock).not.toHaveBeenCalled()
  })
})
