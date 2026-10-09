import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createDocumentInspector,
  DOCUMENT_INSPECTION_ERRORS,
  inspectDocumentStream,
  ZIP_CENTRAL_DIRECTORY_MAX_BYTES,
  ZIP_TAIL_WINDOW_BYTES,
} from './session-documents-inspection'
import { SESSION_DOCUMENT_MAX_BYTES, type SessionDocumentExtension } from './session-documents'

interface ZipEntry {
  name: string
  data?: string | Uint8Array
}

interface ZipOptions {
  zip64?: 'saturated' | 'plain'
  comment?: string
  diskNumber?: number
  declaredEntries?: number
  zip64RecordOffset?: number
}

function u16(value: number): Buffer {
  const out = Buffer.alloc(2)
  out.writeUInt16LE(value)
  return out
}

function u32(value: number): Buffer {
  const out = Buffer.alloc(4)
  out.writeUInt32LE(value)
  return out
}

function u64(value: number): Buffer {
  const out = Buffer.alloc(8)
  out.writeBigUInt64LE(BigInt(value))
  return out
}

/** Builds a stored (uncompressed) ZIP; CRCs are not checked by the inspector. */
function zip(entries: ZipEntry[], options: ZipOptions = {}): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'latin1')
    const data = typeof entry.data === 'string' ? Buffer.from(entry.data, 'latin1') : Buffer.from(entry.data ?? '')
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
    ])
    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset), name,
    ]))
    locals.push(local)
    offset += local.length
  }
  const directory = Buffer.concat(centrals)
  const directoryOffset = offset
  const count = options.declaredEntries ?? entries.length
  const zip64: Buffer[] = []
  if (options.zip64) {
    const recordOffset = directoryOffset + directory.length
    zip64.push(Buffer.concat([
      u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0),
      u64(count), u64(count), u64(directory.length), u64(directoryOffset),
    ]))
    zip64.push(Buffer.concat([u32(0x07064b50), u32(0), u64(options.zip64RecordOffset ?? recordOffset), u32(1)]))
  }
  const saturated = options.zip64 === 'saturated'
  const comment = Buffer.from(options.comment ?? '', 'latin1')
  const disk = options.diskNumber ?? 0
  const end = Buffer.concat([
    u32(0x06054b50), u16(disk), u16(disk),
    u16(saturated ? 0xffff : count), u16(saturated ? 0xffff : count),
    u32(saturated ? 0xffffffff : directory.length), u32(saturated ? 0xffffffff : directoryOffset),
    u16(comment.length), comment,
  ])
  return Buffer.concat([...locals, directory, ...zip64, end])
}

const DOCX_ENTRIES: ZipEntry[] = [
  { name: '[Content_Types].xml', data: '<Types/>' },
  { name: '_rels/.rels', data: '<Relationships/>' },
  { name: 'word/document.xml', data: '<w:document/>' },
]
const PPTX_ENTRIES: ZipEntry[] = [
  { name: '[Content_Types].xml', data: '<Types/>' },
  { name: '_rels/.rels', data: '<Relationships/>' },
  { name: 'ppt/presentation.xml', data: '<p:presentation/>' },
]

function inspect(bytes: Uint8Array, extension: SessionDocumentExtension, chunks: number[] = []) {
  const inspector = createDocumentInspector({ extension, expectedSize: bytes.length })
  let position = 0
  for (const size of chunks) {
    inspector.push(bytes.subarray(position, position + size))
    position += size
  }
  inspector.push(bytes.subarray(position))
  return inspector.finish()
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function inspectionError(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return (error as Error).message
  }
  return 'accepted'
}

describe('stored document inspection: PDF', () => {
  it('accepts a PDF header and reports the streamed hash and size', () => {
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n')
    expect(inspect(pdf, 'pdf')).toEqual({ sha256: sha256(pdf), byteSize: pdf.length })
  })

  it('rejects non-PDF and too-short headers', () => {
    expect(() => inspect(Buffer.from('hello'), 'pdf')).toThrow('not a valid PDF')
    expect(() => inspect(Buffer.from('%PDF'), 'pdf')).toThrow('not a valid PDF')
    expect(() => inspect(Buffer.from([0xa5, 0x50, 0x44, 0x46, 0x2d]), 'pdf')).toThrow('not a valid PDF')
  })

  it('finds the header however it is split', () => {
    const pdf = Buffer.from('%PDF-1.4 tiny')
    for (let split = 0; split <= pdf.length; split += 1) {
      expect(inspect(pdf, 'pdf', [split]).sha256).toBe(sha256(pdf))
    }
    const oneByteChunks = Array.from({ length: pdf.length - 1 }, () => 1)
    expect(inspect(pdf, 'pdf', oneByteChunks).byteSize).toBe(pdf.length)
  })
})

describe('stored document inspection: Office packages', () => {
  it('accepts well-formed DOCX and PPTX packages', () => {
    const docx = zip(DOCX_ENTRIES)
    const pptx = zip(PPTX_ENTRIES)
    expect(inspect(docx, 'docx')).toEqual({ sha256: sha256(docx), byteSize: docx.length })
    expect(inspect(pptx, 'pptx')).toEqual({ sha256: sha256(pptx), byteSize: pptx.length })
  })

  it('rejects a package of the other Office type', () => {
    expect(() => inspect(zip(DOCX_ENTRIES), 'pptx')).toThrow('not a valid PPTX document')
    expect(() => inspect(zip(PPTX_ENTRIES), 'docx')).toThrow('not a valid DOCX document')
  })

  it('rejects macro-enabled packages, including case variants of the part name', () => {
    const macro = zip([...DOCX_ENTRIES, { name: 'word/vbaProject.bin', data: 'x' }])
    expect(() => inspect(macro, 'docx')).toThrow('Macro-enabled')
    const shouted = zip([...PPTX_ENTRIES, { name: 'ppt/VBAPROJECT.BIN', data: 'x' }])
    expect(() => inspect(shouted, 'pptx')).toThrow('Macro-enabled')
  })

  it('keeps the original whole-file marker rule: any vbaProject.bin bytes reject', () => {
    const mentioned = zip([...DOCX_ENTRIES, { name: 'word/notes.xml', data: 'see vbaProject.bin' }])
    expect(() => inspect(mentioned, 'docx')).toThrow('Macro-enabled')
  })

  it('requires the content manifest and part prefix as entry names, not just bytes', () => {
    expect(() => inspect(zip(DOCX_ENTRIES.slice(1)), 'docx')).toThrow('missing its content manifest')
    const manifestInContent = zip([
      { name: 'manifest.xml', data: '[Content_Types].xml' },
      { name: 'word/document.xml', data: '' },
    ])
    expect(() => inspect(manifestInContent, 'docx')).toThrow('missing its content manifest')
    const prefixInContent = zip([
      { name: '[Content_Types].xml', data: '<Override PartName="/word/document.xml"/>' },
      { name: 'document.xml', data: '' },
    ])
    expect(() => inspect(prefixInContent, 'docx')).toThrow('not a valid DOCX document')
  })

  it('rejects non-ZIP and truncated packages', () => {
    expect(() => inspect(Buffer.from('not a zip at all'), 'docx')).toThrow(DOCUMENT_INSPECTION_ERRORS.package)
    const docx = zip(DOCX_ENTRIES)
    expect(() => inspect(docx.subarray(0, docx.length - 10), 'docx')).toThrow(DOCUMENT_INSPECTION_ERRORS.package)
    const noDirectory = Buffer.concat([
      Buffer.from('PK\u0003\u0004', 'latin1'),
      Buffer.from('[Content_Types].xml word/document.xml'),
    ])
    expect(() => inspect(noDirectory, 'docx')).toThrow(DOCUMENT_INSPECTION_ERRORS.package)
  })

  it('rejects multi-disk archives and entry-count mismatches', () => {
    expect(() => inspect(zip(DOCX_ENTRIES, { diskNumber: 1 }), 'docx')).toThrow(DOCUMENT_INSPECTION_ERRORS.package)
    expect(() => inspect(zip(DOCX_ENTRIES, { declaredEntries: 4 }), 'docx')).toThrow(
      DOCUMENT_INSPECTION_ERRORS.package
    )
  })

  it('accepts an archive comment', () => {
    const docx = zip(DOCX_ENTRIES, { comment: 'generated by a test' })
    expect(inspect(docx, 'docx').byteSize).toBe(docx.length)
  })

  it('accepts ZIP64 end records, saturated or not, and rejects a bad ZIP64 locator', () => {
    expect(inspect(zip(DOCX_ENTRIES, { zip64: 'saturated' }), 'docx').byteSize).toBeGreaterThan(0)
    expect(inspect(zip(PPTX_ENTRIES, { zip64: 'plain' }), 'pptx').byteSize).toBeGreaterThan(0)
    expect(() => inspect(zip(DOCX_ENTRIES, { zip64: 'saturated', zip64RecordOffset: 3 }), 'docx')).toThrow(
      DOCUMENT_INSPECTION_ERRORS.package
    )
  })

  it('rejects a central directory beyond the validation budget', () => {
    const entries: ZipEntry[] = [...DOCX_ENTRIES]
    let directoryBytes = 0
    while (directoryBytes <= ZIP_CENTRAL_DIRECTORY_MAX_BYTES) {
      const name = `word/media/${'p'.repeat(100)}${entries.length}.xml`
      entries.push({ name })
      directoryBytes += 46 + name.length
    }
    expect(() => inspect(zip(entries), 'docx')).toThrow('too many parts')
  })

  it('validates a package larger than the tail window across arbitrary chunk sizes', () => {
    const media = Buffer.alloc(3 * 1024 * 1024 + 17, 0x41)
    const docx = zip([...DOCX_ENTRIES.slice(0, 2), { name: 'word/media/large.bin', data: media }, DOCX_ENTRIES[2]])
    expect(docx.length).toBeGreaterThan(ZIP_TAIL_WINDOW_BYTES)
    const expected = { sha256: sha256(docx), byteSize: docx.length }
    expect(inspect(docx, 'docx')).toEqual(expected)
    expect(inspect(docx, 'docx', [65536, 65536, 7, 2 * 1024 * 1024 + 3])).toEqual(expected)
    expect(inspect(docx, 'docx', Array.from({ length: 200 }, (_, index) => 1 + ((index * 7919) % 30011)))).toEqual(
      expected
    )
  })

  it('gives the same verdict at every two-way chunk boundary of small fixtures', () => {
    const cases: [Buffer, SessionDocumentExtension, string][] = [
      [zip(DOCX_ENTRIES), 'docx', 'accepted'],
      [zip(PPTX_ENTRIES, { zip64: 'saturated', comment: 'c' }), 'pptx', 'accepted'],
      [zip([...DOCX_ENTRIES, { name: 'word/vbaProject.bin' }]), 'docx', DOCUMENT_INSPECTION_ERRORS.macro],
      [zip(DOCX_ENTRIES.slice(1)), 'docx', DOCUMENT_INSPECTION_ERRORS.manifest],
      [zip(DOCX_ENTRIES), 'pptx', 'The uploaded file is not a valid PPTX document'],
    ]
    for (const [bytes, extension, verdict] of cases) {
      for (let split = 0; split <= bytes.length; split += 1) {
        expect(inspectionError(() => inspect(bytes, extension, [split]))).toBe(verdict)
      }
      const oneByteChunks = Array.from({ length: bytes.length - 1 }, () => 1)
      expect(inspectionError(() => inspect(bytes, extension, oneByteChunks))).toBe(verdict)
    }
  })
})

describe('stored document inspection: size', () => {
  it('rejects an empty object', () => {
    const inspector = createDocumentInspector({ extension: 'pdf', expectedSize: 10 })
    expect(() => inspector.finish()).toThrow('The document is empty')
  })

  it('rejects objects shorter or longer than the declared size', () => {
    const pdf = Buffer.from('%PDF-1.7 body')
    const short = createDocumentInspector({ extension: 'pdf', expectedSize: pdf.length + 1 })
    short.push(pdf)
    expect(() => short.finish()).toThrow(DOCUMENT_INSPECTION_ERRORS.sizeMismatch)

    const long = createDocumentInspector({ extension: 'pdf', expectedSize: pdf.length - 1 })
    expect(() => long.push(pdf)).toThrow(DOCUMENT_INSPECTION_ERRORS.sizeMismatch)
  })

  it('stops reading as soon as an object passes the 25 MiB limit', () => {
    const inspector = createDocumentInspector({ extension: 'docx', expectedSize: SESSION_DOCUMENT_MAX_BYTES })
    expect(() => inspector.push(new Uint8Array(SESSION_DOCUMENT_MAX_BYTES + 1))).toThrow('25 MiB')
  })
})

describe('inspectDocumentStream', () => {
  function streamOf(chunks: Uint8Array[], options: { open?: boolean; onCancel?: () => void } = {}) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        if (!options.open) controller.close()
      },
      cancel: options.onCancel,
    })
  }

  it('consumes a stream chunk by chunk', async () => {
    const docx = zip(DOCX_ENTRIES)
    const result = await inspectDocumentStream(streamOf([docx.subarray(0, 11), docx.subarray(11)]), {
      extension: 'docx',
      expectedSize: docx.length,
    })
    expect(result).toEqual({ sha256: sha256(docx), byteSize: docx.length })
  })

  it('cancels the stream when the object is oversized', async () => {
    const cancel = vi.fn()
    const pdf = Buffer.from('%PDF-1.7 body')
    await expect(
      inspectDocumentStream(streamOf([pdf, pdf], { open: true, onCancel: cancel }), {
        extension: 'pdf',
        expectedSize: pdf.length,
      })
    ).rejects.toThrow(DOCUMENT_INSPECTION_ERRORS.sizeMismatch)
    expect(cancel).toHaveBeenCalled()
  })

  it('treats a missing body as empty', async () => {
    await expect(inspectDocumentStream(null, { extension: 'pdf', expectedSize: 5 })).rejects.toThrow('empty')
  })
})
