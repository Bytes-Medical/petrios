import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { SESSION_DOCUMENT_MAX_BYTES, type SessionDocumentExtension } from './session-documents'

// Validates a stored document in one pass with bounded memory (~1.1 MiB tail
// window), so a 25 MiB object never has to be held whole on a 128 MB isolate.

export const ZIP_CENTRAL_DIRECTORY_MAX_BYTES = 1024 * 1024
const EOCD_BYTES = 22
const EOCD_MAX_COMMENT_BYTES = 0xffff
const ZIP64_LOCATOR_BYTES = 20
const ZIP64_EOCD_BYTES = 56
const CENTRAL_HEADER_BYTES = 46
export const ZIP_TAIL_WINDOW_BYTES =
  ZIP_CENTRAL_DIRECTORY_MAX_BYTES + ZIP64_EOCD_BYTES + ZIP64_LOCATOR_BYTES + EOCD_BYTES + EOCD_MAX_COMMENT_BYTES

const EOCD_SIGNATURE = 0x06054b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]
const ZIP_LOCAL_MAGIC = [0x50, 0x4b, 0x03, 0x04]

const MACRO_MARKER = 'vbaProject.bin'
const MANIFEST_MARKER = '[Content_Types].xml'
const PART_PREFIX = { docx: 'word/', pptx: 'ppt/' } as const

export const DOCUMENT_INSPECTION_ERRORS = {
  pdf: 'The uploaded file is not a valid PDF',
  package: 'The uploaded Office document is not a valid Open XML package',
  macro: 'Macro-enabled Office documents are not allowed',
  manifest: 'The Office package is missing its content manifest',
  directoryTooLarge: 'The Office package has too many parts to validate',
  tooLarge: 'Documents are limited to 25 MiB',
  empty: 'The document is empty',
  sizeMismatch: 'The uploaded document does not match the selected file',
} as const

function partError(extension: 'docx' | 'pptx'): Error {
  return new Error(`The uploaded file is not a valid ${extension.toUpperCase()} document`)
}

export interface DocumentInspection {
  sha256: string
  byteSize: number
}

class MarkerScanner {
  readonly found: boolean[]
  private readonly needles: Buffer[]
  private readonly overlap: number
  private carry: Uint8Array = new Uint8Array(0)

  constructor(markers: readonly string[]) {
    this.needles = markers.map((marker) => Buffer.from(marker, 'latin1'))
    this.found = markers.map(() => false)
    this.overlap = Math.max(...this.needles.map((needle) => needle.length)) - 1
  }

  push(chunk: Uint8Array): void {
    const view = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    // A marker split across chunks lies wholly inside the previous tail plus
    // this chunk's head, each at most (longest marker - 1) bytes.
    const seam = Buffer.concat([this.carry, view.subarray(0, this.overlap)])
    this.needles.forEach((needle, index) => {
      if (!this.found[index] && (seam.includes(needle) || view.includes(needle))) this.found[index] = true
    })
    this.carry =
      view.length >= this.overlap
        ? Uint8Array.from(view.subarray(view.length - this.overlap))
        : Buffer.concat([this.carry, view]).subarray(-this.overlap)
  }
}

/** Keeps the last `capacity` bytes of a stream (used to read a ZIP's central directory). */
export class TailWindow {
  private readonly bytes: Uint8Array
  private written = 0

  constructor(capacity: number) {
    this.bytes = new Uint8Array(capacity)
  }

  push(chunk: Uint8Array): void {
    const capacity = this.bytes.length
    let data = chunk
    let position = this.written
    if (data.length > capacity) {
      position += data.length - capacity
      data = data.subarray(data.length - capacity)
    }
    this.written += chunk.length
    const start = position % capacity
    const first = Math.min(data.length, capacity - start)
    this.bytes.set(data.subarray(0, first), start)
    if (first < data.length) this.bytes.set(data.subarray(first), 0)
  }

  /** The retained suffix in stream order (rotated in place) and its stream offset. */
  finish(): { bytes: Uint8Array; offset: number } {
    const capacity = this.bytes.length
    if (this.written <= capacity) return { bytes: this.bytes.subarray(0, this.written), offset: 0 }
    const start = this.written % capacity
    this.bytes.subarray(0, start).reverse()
    this.bytes.subarray(start).reverse()
    this.bytes.reverse()
    return { bytes: this.bytes, offset: this.written - capacity }
  }
}

function readUint64(view: DataView, index: number): number {
  return view.getUint32(index + 4, true) * 0x1_0000_0000 + view.getUint32(index, true)
}

function findEndOfCentralDirectory(view: DataView): number {
  const last = view.byteLength - EOCD_BYTES
  const first = Math.max(0, last - EOCD_MAX_COMMENT_BYTES)
  for (let index = last; index >= first; index -= 1) {
    if (
      view.getUint32(index, true) === EOCD_SIGNATURE &&
      index + EOCD_BYTES + view.getUint16(index + 20, true) <= view.byteLength
    ) {
      return index
    }
  }
  return -1
}

/** One central-directory record (sizes and offsets resolved through ZIP64 when needed). */
export interface ZipEntry {
  name: string
  /** General-purpose bit flags (bit 0 = encrypted, bit 3 = data descriptor). */
  flags: number
  /** 0 = stored, 8 = deflate. */
  method: number
  compressedSize: number
  uncompressedSize: number
  /** File offset of the entry's local header. */
  localHeaderOffset: number
}

const ZIP64_EXTRA_ID = 0x0001
const ZIP32_SATURATED = 0xffffffff

/**
 * Visits every central-directory entry name. `tail` holds the last bytes of
 * the file and `tailOffset` is the file offset of tail[0].
 */
export function forEachZipEntryName(
  tail: Uint8Array,
  tailOffset: number,
  visit: (name: string) => void
): void {
  walkCentralDirectory(tail, tailOffset, (_view, _position, name) => visit(name))
}

/**
 * Visits every central-directory entry with the fields needed to read its
 * data (same bounds and validation as forEachZipEntryName). A saturated
 * 32-bit size/offset is resolved from the entry's ZIP64 extra field; a
 * saturated value without one rejects the package.
 */
export function forEachZipEntry(
  tail: Uint8Array,
  tailOffset: number,
  visit: (entry: ZipEntry) => void
): void {
  const invalid = () => new Error(DOCUMENT_INSPECTION_ERRORS.package)
  walkCentralDirectory(tail, tailOffset, (view, position, name, extraStart, extraLength) => {
    let uncompressedSize = view.getUint32(position + 24, true)
    let compressedSize = view.getUint32(position + 20, true)
    let localHeaderOffset = view.getUint32(position + 42, true)
    if (
      uncompressedSize === ZIP32_SATURATED ||
      compressedSize === ZIP32_SATURATED ||
      localHeaderOffset === ZIP32_SATURATED
    ) {
      // ZIP64 extra field: only the saturated values are present, in this order.
      let cursor = extraStart
      const extraEnd = extraStart + extraLength
      let found = false
      while (cursor + 4 <= extraEnd) {
        const id = view.getUint16(cursor, true)
        const size = view.getUint16(cursor + 2, true)
        const dataStart = cursor + 4
        if (dataStart + size > extraEnd) throw invalid()
        if (id === ZIP64_EXTRA_ID) {
          let field = dataStart
          const take = (): number => {
            if (field + 8 > dataStart + size) throw invalid()
            const value = readUint64(view, field)
            field += 8
            return value
          }
          if (uncompressedSize === ZIP32_SATURATED) uncompressedSize = take()
          if (compressedSize === ZIP32_SATURATED) compressedSize = take()
          if (localHeaderOffset === ZIP32_SATURATED) localHeaderOffset = take()
          found = true
          break
        }
        cursor = dataStart + size
      }
      if (!found) throw invalid()
    }
    visit({
      name,
      flags: view.getUint16(position + 8, true),
      method: view.getUint16(position + 10, true),
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    })
  })
}

function walkCentralDirectory(
  tail: Uint8Array,
  tailOffset: number,
  visit: (view: DataView, position: number, name: string, extraStart: number, extraLength: number) => void
): void {
  const invalid = () => new Error(DOCUMENT_INSPECTION_ERRORS.package)
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  const eocd = findEndOfCentralDirectory(view)
  if (eocd < 0) throw invalid()

  let diskNumber = view.getUint16(eocd + 4, true)
  let directoryDisk = view.getUint16(eocd + 6, true)
  let entries = view.getUint16(eocd + 10, true)
  let directorySize = view.getUint32(eocd + 12, true)
  let directoryOffset = view.getUint32(eocd + 16, true)
  let directoryLimit = tailOffset + eocd

  const locator = eocd - ZIP64_LOCATOR_BYTES
  if (locator >= 0 && view.getUint32(locator, true) === ZIP64_LOCATOR_SIGNATURE) {
    const recordOffset = readUint64(view, locator + 8)
    const record = recordOffset - tailOffset
    if (record < 0 || record + ZIP64_EOCD_BYTES > locator || view.getUint32(record, true) !== ZIP64_EOCD_SIGNATURE) {
      throw invalid()
    }
    if (diskNumber === 0xffff) diskNumber = view.getUint32(record + 16, true)
    if (directoryDisk === 0xffff) directoryDisk = view.getUint32(record + 20, true)
    if (entries === 0xffff) entries = readUint64(view, record + 32)
    if (directorySize === 0xffffffff) directorySize = readUint64(view, record + 40)
    if (directoryOffset === 0xffffffff) directoryOffset = readUint64(view, record + 48)
    directoryLimit = recordOffset
  }

  if (diskNumber !== 0 || directoryDisk !== 0) throw invalid()
  if (directorySize > ZIP_CENTRAL_DIRECTORY_MAX_BYTES) {
    throw new Error(DOCUMENT_INSPECTION_ERRORS.directoryTooLarge)
  }
  const start = directoryOffset - tailOffset
  const end = start + directorySize
  if (start < 0 || directoryOffset + directorySize > directoryLimit) throw invalid()

  let position = start
  let count = 0
  while (position < end) {
    if (position + CENTRAL_HEADER_BYTES > end || view.getUint32(position, true) !== CENTRAL_HEADER_SIGNATURE) {
      throw invalid()
    }
    const nameLength = view.getUint16(position + 28, true)
    const extraLength = view.getUint16(position + 30, true)
    const next =
      position +
      CENTRAL_HEADER_BYTES +
      nameLength +
      extraLength +
      view.getUint16(position + 32, true)
    if (next > end) throw invalid()
    const nameStart = tail.byteOffset + position + CENTRAL_HEADER_BYTES
    visit(
      view,
      position,
      Buffer.from(tail.buffer, nameStart, nameLength).toString('latin1'),
      position + CENTRAL_HEADER_BYTES + nameLength,
      extraLength
    )
    position = next
    count += 1
  }
  if (count !== entries) throw invalid()
}

function startsWith(head: Uint8Array, length: number, magic: number[]): boolean {
  return length >= magic.length && magic.every((byte, index) => head[index] === byte)
}

export function createDocumentInspector(input: {
  extension: SessionDocumentExtension
  expectedSize: number
}) {
  const { extension, expectedSize } = input
  const hash = createHash('sha256')
  const head = new Uint8Array(PDF_MAGIC.length)
  let headLength = 0
  let total = 0
  const office = extension === 'pdf' ? null : {
    extension,
    markers: new MarkerScanner([MACRO_MARKER, MANIFEST_MARKER, PART_PREFIX[extension]]),
    tail: new TailWindow(Math.min(expectedSize, ZIP_TAIL_WINDOW_BYTES)),
  }

  return {
    push(chunk: Uint8Array): void {
      if (chunk.byteLength === 0) return
      total += chunk.byteLength
      if (total > expectedSize) {
        throw new Error(
          total > SESSION_DOCUMENT_MAX_BYTES
            ? DOCUMENT_INSPECTION_ERRORS.tooLarge
            : DOCUMENT_INSPECTION_ERRORS.sizeMismatch
        )
      }
      hash.update(chunk)
      if (headLength < head.length) {
        const take = Math.min(head.length - headLength, chunk.byteLength)
        head.set(chunk.subarray(0, take), headLength)
        headLength += take
      }
      office?.markers.push(chunk)
      office?.tail.push(chunk)
    },

    finish(): DocumentInspection {
      if (total === 0) throw new Error(DOCUMENT_INSPECTION_ERRORS.empty)
      if (total !== expectedSize) throw new Error(DOCUMENT_INSPECTION_ERRORS.sizeMismatch)

      if (!office) {
        if (!startsWith(head, headLength, PDF_MAGIC)) throw new Error(DOCUMENT_INSPECTION_ERRORS.pdf)
        return { sha256: hash.digest('hex'), byteSize: total }
      }

      if (!startsWith(head, headLength, ZIP_LOCAL_MAGIC)) throw new Error(DOCUMENT_INSPECTION_ERRORS.package)
      const [macroMarker, manifestMarker, partMarker] = office.markers.found
      if (macroMarker) throw new Error(DOCUMENT_INSPECTION_ERRORS.macro)
      if (!manifestMarker) throw new Error(DOCUMENT_INSPECTION_ERRORS.manifest)
      if (!partMarker) throw partError(office.extension)

      // OPC part names are case-insensitive, so the directory checks are too.
      const prefix = PART_PREFIX[office.extension]
      let macroEntry = false
      let manifestEntry = false
      let partEntry = false
      const tail = office.tail.finish()
      forEachZipEntryName(tail.bytes, tail.offset, (name) => {
        const lower = name.toLowerCase()
        if (lower.includes(MACRO_MARKER.toLowerCase())) macroEntry = true
        if (lower === MANIFEST_MARKER.toLowerCase()) manifestEntry = true
        if (lower.startsWith(prefix)) partEntry = true
      })
      if (macroEntry) throw new Error(DOCUMENT_INSPECTION_ERRORS.macro)
      if (!manifestEntry) throw new Error(DOCUMENT_INSPECTION_ERRORS.manifest)
      if (!partEntry) throw partError(office.extension)

      return { sha256: hash.digest('hex'), byteSize: total }
    },
  }
}

export async function inspectDocumentStream(
  stream: ReadableStream<Uint8Array> | null,
  options: { extension: SessionDocumentExtension; expectedSize: number }
): Promise<DocumentInspection> {
  const inspector = createDocumentInspector(options)
  if (stream) {
    const reader = stream.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        inspector.push(value)
      }
    } catch (error) {
      await reader.cancel().catch(() => {})
      throw error
    }
  }
  return inspector.finish()
}
