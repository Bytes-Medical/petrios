import { SESSION_DOCUMENT_MIME } from '@/lib/session-documents'
import {
  forEachZipEntry,
  TailWindow,
  ZIP_TAIL_WINDOW_BYTES,
  type ZipEntry,
} from '@/lib/session-documents-inspection'
import type { LlmFileInput } from './streaming-body'

/**
 * Plain-text extraction for DOCX/PPTX learning documents. Anthropic document
 * blocks accept PDF and plain text only, so Office packages are converted
 * server-side before upload (lib/ai/llm.ts).
 *
 * Memory stays bounded on a 128 MB Workers isolate: the package is never held
 * whole. Pass 1 streams the object once to keep only its ~1.1 MiB tail (the
 * ZIP central directory); pass 2 streams it again, skipping to each wanted
 * part and inflating it chunk by chunk (DecompressionStream 'deflate-raw')
 * into a streaming XML scanner. Each pass reads through to the end, so the
 * stored size/SHA-256 check in the source stream (verifiedFileSources) must
 * pass before any text is accepted.
 *
 * What is retained is bounded independently of the package: the extracted
 * text (OFFICE_TEXT_MAX_CHARS) and, for PPTX, only the slide-order and
 * speaker-notes relationships (short ids and part names, at most
 * OFFICE_MAX_SLIDES of each), never the raw XML of structure parts. Once the
 * character budget is spent no further part is inflated; the rest of the
 * package is only read through for the integrity check. OFFICE_MAX_INFLATED_BYTES
 * bounds decompression work (CPU), not memory.
 *
 * Extracted: DOCX main body (word/document.xml) in document order; PPTX
 * slides in presentation order, each followed by its speaker notes.
 * Deliberately not extracted (identifiers and noise): DOCX headers, footers,
 * comments and document properties (author); PPTX masters, layouts and
 * document properties. Tracked deletions and field codes are skipped.
 *
 * Element matching uses the canonical w:/a:/p:/r: prefixes that Microsoft
 * Office writes. A generator that binds other prefixes yields no text, and the
 * caller then sends the empty-document marker instead.
 */

export type OfficeKind = 'docx' | 'pptx'

export const OFFICE_TEXT_MAX_CHARS = 1_000_000
/** Zip-bomb guard: total bytes inflated per document (decompression work; nothing this size is held). */
export const OFFICE_MAX_INFLATED_BYTES = 64 * 1024 * 1024
/** A deck with more slide (or notes) parts than this is refused as too large. */
export const OFFICE_MAX_SLIDES = 2000
export const OFFICE_TEXT_TRUNCATED_MARKER = '\n[Text truncated at the extraction limit]'
export const OFFICE_TEXT_EMPTY_MARKER = '[No extractable text in this document]'

/**
 * presentation.xml and relationship parts are small; a larger one is ignored
 * (its inflation stops there). They are scanned as they stream and only the
 * relationships needed for slide order and notes are kept.
 */
const STRUCTURE_PART_MAX_BYTES = 2 * 1024 * 1024
/** Relationship ids and targets longer than this are ignored (real ones are ~20 chars). */
const MAX_STRUCTURE_VALUE_CHARS = 256
const MAX_TAG_CHARS = 64 * 1024
const MAX_ENTITY_CHARS = 16
const LOCAL_HEADER_SIGNATURE = 0x04034b50
const LOCAL_HEADER_BYTES = 30
const METHOD_STORED = 0
const METHOD_DEFLATE = 8
const FLAG_ENCRYPTED = 0x0001

export interface OfficeTextLimits {
  maxChars?: number
  maxInflatedBytes?: number
}

export function officeKindForMime(mimeType: string): OfficeKind | null {
  if (mimeType === SESSION_DOCUMENT_MIME.docx) return 'docx'
  if (mimeType === SESSION_DOCUMENT_MIME.pptx) return 'pptx'
  return null
}

/** A structural problem with the package or its XML (not a storage failure). */
class OfficeParseError extends Error {}
/** The zip-bomb guard tripped. */
class OfficeTooLargeError extends Error {}

/**
 * Extracts readable text in document order. Storage and integrity errors from
 * `file.open` streams propagate unchanged; package problems become
 * `Document "<name>" could not be read as DOCX/PPTX text`.
 */
export async function extractOfficeText(
  file: LlmFileInput,
  kind: OfficeKind,
  signal: AbortSignal,
  limits: OfficeTextLimits = {}
): Promise<string> {
  const maxChars = limits.maxChars ?? OFFICE_TEXT_MAX_CHARS
  const maxInflatedBytes = limits.maxInflatedBytes ?? OFFICE_MAX_INFLATED_BYTES
  try {
    const tail = await readTail(file, signal)
    const entries: ZipEntry[] = []
    try {
      forEachZipEntry(tail.bytes, tail.offset, (entry) => entries.push(entry))
    } catch (error) {
      throw new OfficeParseError('Invalid ZIP central directory', { cause: error })
    }
    const plan = kind === 'docx' ? planDocx(entries) : planPptx(entries)
    const parts = await readParts(file, signal, plan, tail.size, {
      budget: new TextBudget(maxChars),
      inflated: { remaining: maxInflatedBytes },
      kind,
    })
    return kind === 'docx' ? assembleDocx(parts) : assemblePptx(parts)
  } catch (error) {
    if (error instanceof OfficeTooLargeError) {
      throw new Error(`Document "${file.filename}" is too large to read`, { cause: error })
    }
    if (error instanceof OfficeParseError) {
      throw new Error(
        `Document "${file.filename}" could not be read as ${kind.toUpperCase()} text`,
        { cause: error }
      )
    }
    throw error
  }
}

// ---------------------------------------------------------------- pass 1

async function readTail(
  file: LlmFileInput,
  signal: AbortSignal
): Promise<{ bytes: Uint8Array; offset: number; size: number }> {
  const window = new TailWindow(ZIP_TAIL_WINDOW_BYTES)
  const reader = (await file.open(signal)).getReader()
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      window.push(value)
      size += value.byteLength
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {})
    throw error
  }
  return { ...window.finish(), size }
}

// ---------------------------------------------------------------- planning

type PartRole =
  | { type: 'text'; key: string; rules: XmlTextRules }
  | { type: 'structure'; key: string }

interface PlannedPart {
  entry: ZipEntry
  role: PartRole
}

const DOCX_BODY = 'word/document.xml'
const PPTX_PRESENTATION = 'ppt/presentation.xml'
const PPTX_PRESENTATION_RELS = 'ppt/_rels/presentation.xml.rels'
const PPTX_SLIDE = /^ppt\/slides\/slide\d+\.xml$/
const PPTX_SLIDE_RELS = /^ppt\/slides\/_rels\/(slide\d+\.xml)\.rels$/
const PPTX_NOTES = /^ppt\/notesslides\/notesslide\d+\.xml$/

function planDocx(entries: ZipEntry[]): PlannedPart[] {
  // OPC part names are case-insensitive.
  const body = entries.find((entry) => entry.name.toLowerCase() === DOCX_BODY)
  if (!body) throw new OfficeParseError('Missing word/document.xml')
  return validated([{ entry: body, role: { type: 'text', key: DOCX_BODY, rules: DOCX_RULES } }])
}

function planPptx(entries: ZipEntry[]): PlannedPart[] {
  const slides = new Set<string>()
  let notes = 0
  for (const entry of entries) {
    const name = entry.name.toLowerCase()
    if (PPTX_SLIDE.test(name)) slides.add(name)
    else if (PPTX_NOTES.test(name)) notes += 1
  }
  if (slides.size > OFFICE_MAX_SLIDES || notes > OFFICE_MAX_SLIDES) {
    throw new OfficeTooLargeError('Too many slides')
  }

  const planned: PlannedPart[] = []
  for (const entry of entries) {
    const name = entry.name.toLowerCase()
    if (name === PPTX_PRESENTATION || name === PPTX_PRESENTATION_RELS) {
      planned.push({ entry, role: { type: 'structure', key: name } })
    } else if (PPTX_SLIDE.test(name) || PPTX_NOTES.test(name)) {
      planned.push({ entry, role: { type: 'text', key: name, rules: PPTX_RULES } })
    } else {
      // Only the relationships of slides that exist (they map speaker notes).
      const rels = PPTX_SLIDE_RELS.exec(name)
      if (rels && slides.has(`ppt/slides/${rels[1]}`)) {
        planned.push({ entry, role: { type: 'structure', key: name } })
      }
    }
  }
  // A package without slides is valid; it yields the empty-document marker.
  return validated(planned)
}

function validated(parts: PlannedPart[]): PlannedPart[] {
  for (const { entry } of parts) {
    if (entry.flags & FLAG_ENCRYPTED) throw new OfficeParseError('Encrypted package part')
    if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
      throw new OfficeParseError(`Unsupported compression method ${entry.method}`)
    }
  }
  return [...parts].sort((left, right) => left.entry.localHeaderOffset - right.entry.localHeaderOffset)
}

// ---------------------------------------------------------------- pass 2

interface ReadContext {
  budget: TextBudget
  inflated: { remaining: number }
  kind: OfficeKind
}

interface ExtractedParts {
  text: Map<string, string>
  structure: PptxStructure
  truncated: boolean
}

async function readParts(
  file: LlmFileInput,
  signal: AbortSignal,
  plan: PlannedPart[],
  size: number,
  context: ReadContext
): Promise<ExtractedParts> {
  const text = new Map<string, string>()
  const structure = emptyStructure()
  const source = new ByteSource((await file.open(signal)).getReader())
  try {
    for (const { entry, role } of plan) {
      if (entry.localHeaderOffset + LOCAL_HEADER_BYTES + entry.compressedSize > size) {
        throw new OfficeParseError('Part extends past the end of the package')
      }
      if (entry.localHeaderOffset < source.position) {
        throw new OfficeParseError('Overlapping package parts')
      }
      if (role.type === 'text' && context.budget.truncated) {
        // The character budget is spent, so this part cannot add text: it is
        // not inflated (the drain below still reads it for the integrity check).
        text.set(role.key, '')
        continue
      }
      await source.skip(entry.localHeaderOffset - source.position)
      const header = await source.readExact(LOCAL_HEADER_BYTES)
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
      if (view.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE) {
        throw new OfficeParseError('Bad local header')
      }
      // Sizes come from the central directory: with a data descriptor (flag
      // bit 3) the local header's size fields are zero.
      await source.skip(view.getUint16(26, true) + view.getUint16(28, true))

      if (role.type === 'text') {
        const parts = new TextAccumulator()
        const extractor = new XmlTextExtractor(role.rules, (piece) => {
          const kept = context.budget.take(piece)
          if (kept) parts.add(kept)
        })
        const decoder = new TextDecoder('utf-8')
        const complete = await inflateEntry(
          source,
          entry,
          context,
          (bytes) => extractor.push(decoder.decode(bytes, { stream: true })),
          () => context.budget.truncated
        )
        // A part cut short at the character limit ends mid-XML by design.
        if (complete) {
          extractor.push(decoder.decode())
          extractor.end()
        }
        text.set(role.key, parts.toString())
      } else {
        const scanner = new StructureScanner(role.key, structure)
        const decoder = new TextDecoder('utf-8')
        let length = 0
        const complete = await inflateEntry(
          source,
          entry,
          context,
          (bytes) => {
            length += bytes.byteLength
            if (length > STRUCTURE_PART_MAX_BYTES) scanner.abandon()
            else scanner.push(decoder.decode(bytes, { stream: true }))
          },
          () => scanner.abandoned
        )
        if (complete) scanner.push(decoder.decode())
        scanner.end()
      }
    }
    // Read to the end so the source's size/SHA-256 check runs before any
    // extracted text is used.
    await source.drain()
  } catch (error) {
    await source.cancel(error)
    throw source.failure ? source.failure.error : error
  }
  return { text, structure, truncated: context.budget.truncated }
}

/**
 * Inflates one part into `onBytes`. When `stop()` turns true after a chunk,
 * inflation ends there and the rest of the part's compressed bytes are read
 * past without being inflated; returns false in that case.
 */
async function inflateEntry(
  source: ByteSource,
  entry: ZipEntry,
  context: ReadContext,
  onBytes: (bytes: Uint8Array) => void,
  stop: () => boolean
): Promise<boolean> {
  const account = (byteLength: number) => {
    context.inflated.remaining -= byteLength
    if (context.inflated.remaining < 0) throw new OfficeTooLargeError('Inflated size limit exceeded')
  }

  if (entry.method === METHOD_STORED) {
    let stopped = false
    for await (const part of source.take(entry.compressedSize)) {
      if (stopped) continue
      account(part.byteLength)
      onBytes(part)
      stopped = stop()
    }
    return !stopped
  }

  let inflater: DecompressionStream
  try {
    inflater = new DecompressionStream('deflate-raw')
  } catch (error) {
    // A runtime problem, not a document problem (Node < 20.12 lacks deflate-raw).
    throw new Error('This server cannot decompress Office documents (Node.js 20.12 or later is required)', {
      cause: error,
    })
  }
  const writer = inflater.writable.getWriter()
  const reader = inflater.readable.getReader()
  let stopped = false
  // Writer and reader run concurrently so backpressure holds on both sides.
  const pump = (async () => {
    try {
      for await (const part of source.take(entry.compressedSize)) {
        // After an early stop the rest of the part is read past, not inflated.
        if (stopped) continue
        try {
          // Stream chunks are ArrayBuffer-backed (never shared memory).
          await writer.write(part as Uint8Array<ArrayBuffer>)
        } catch (error) {
          // Cancelling the inflater on a stop rejects a write in flight.
          if (!stopped) throw error
        }
      }
      if (!stopped) {
        try {
          await writer.close()
        } catch (error) {
          // ...or the final flush, if the stop came while it was pending.
          if (!stopped) throw error
        }
      }
    } catch (error) {
      await writer.abort(error).catch(() => {})
      throw error
    }
  })()
  let consumerError: { error: unknown } | null = null
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      account(value.byteLength)
      onBytes(value)
      if (stop()) {
        stopped = true
        await reader.cancel().catch(() => {})
        break
      }
    }
  } catch (error) {
    consumerError = { error }
    await reader.cancel(error).catch(() => {})
  }
  const pumpError = await pump.then(
    () => null,
    (error: unknown) => ({ error })
  )
  if (source.failure) throw source.failure.error
  if (consumerError) {
    const { error } = consumerError
    throw error instanceof OfficeTooLargeError || error instanceof OfficeParseError
      ? error
      : new OfficeParseError('Corrupt compressed part', { cause: error })
  }
  if (pumpError) throw new OfficeParseError('Corrupt compressed part', { cause: pumpError.error })
  return !stopped
}

/** Sequential cursor over a byte stream (one chunk buffered at a time). */
class ByteSource {
  position = 0
  /** Set when the underlying read failed (storage, integrity or abort). */
  failure: { error: unknown } | null = null
  private chunk: Uint8Array = new Uint8Array(0)

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  private async fill(): Promise<void> {
    while (this.chunk.byteLength === 0) {
      let read: ReadableStreamReadResult<Uint8Array>
      try {
        read = await this.reader.read()
      } catch (error) {
        this.failure ??= { error }
        throw error
      }
      if (read.done) throw new OfficeParseError('Unexpected end of package')
      this.chunk = read.value
    }
  }

  async skip(count: number): Promise<void> {
    for await (const part of this.take(count)) void part
  }

  async readExact(count: number): Promise<Uint8Array> {
    const out = new Uint8Array(count)
    let filled = 0
    for await (const part of this.take(count)) {
      out.set(part, filled)
      filled += part.byteLength
    }
    return out
  }

  async *take(count: number): AsyncGenerator<Uint8Array, void, undefined> {
    let remaining = count
    while (remaining > 0) {
      await this.fill()
      const size = Math.min(remaining, this.chunk.byteLength)
      const part = this.chunk.subarray(0, size)
      this.chunk = this.chunk.subarray(size)
      this.position += size
      remaining -= size
      yield part
    }
  }

  async drain(): Promise<void> {
    this.position += this.chunk.byteLength
    this.chunk = new Uint8Array(0)
    for (;;) {
      let read: ReadableStreamReadResult<Uint8Array>
      try {
        read = await this.reader.read()
      } catch (error) {
        this.failure ??= { error }
        throw error
      }
      if (read.done) return
      this.position += read.value.byteLength
    }
  }

  async cancel(reason: unknown): Promise<void> {
    await this.reader.cancel(reason).catch(() => {})
  }
}

/**
 * Collects extracted text. A part can emit about a million tiny pieces (a
 * character and a line break per paragraph); grouping them keeps that from
 * costing a separate string object each.
 */
class TextAccumulator {
  private pieces: string[] = []
  private readonly groups: string[] = []

  add(piece: string): void {
    this.pieces.push(piece)
    if (this.pieces.length >= 1024) {
      this.groups.push(this.pieces.join(''))
      this.pieces = []
    }
  }

  toString(): string {
    return this.groups.join('') + this.pieces.join('')
  }
}

/** Shared character budget across every part of one document. */
class TextBudget {
  truncated = false
  private remaining: number

  constructor(maxChars: number) {
    this.remaining = maxChars
  }

  take(text: string): string {
    if (this.truncated || !text) return ''
    if (text.length <= this.remaining) {
      this.remaining -= text.length
      return text
    }
    const kept = text.slice(0, this.remaining)
    this.remaining = 0
    this.truncated = true
    return kept
  }
}

// ---------------------------------------------------------------- XML text

export interface XmlTextRules {
  /** Elements whose character data is captured. */
  text: ReadonlySet<string>
  /** Elements whose whole subtree is ignored. */
  skip: ReadonlySet<string>
  /** Emitted for an opening or empty-element tag. */
  onOpen: ReadonlyMap<string, string>
  /** Emitted for a closing tag (and after an empty-element tag). */
  onClose: ReadonlyMap<string, string>
}

export const DOCX_RULES: XmlTextRules = {
  text: new Set(['w:t']),
  // Tracked deletions, field codes, tab-stop definitions (their <w:tab> is not
  // a tab character) and the VML fallback copy of text boxes.
  skip: new Set(['w:delText', 'w:instrText', 'w:tabs', 'mc:Fallback']),
  onOpen: new Map([
    ['w:tab', '\t'],
    ['w:br', '\n'],
    ['w:cr', '\n'],
    ['w:noBreakHyphen', '-'],
  ]),
  onClose: new Map([
    ['w:p', '\n'],
    ['w:tc', '\t'],
    ['w:tr', '\n'],
  ]),
}

export const PPTX_RULES: XmlTextRules = {
  text: new Set(['a:t']),
  // Fields are generated values (slide numbers, dates). In DrawingML a tab
  // in text is a literal character; <a:tab> only defines tab stops.
  skip: new Set(['a:fld', 'mc:Fallback']),
  onOpen: new Map([['a:br', '\n']]),
  onClose: new Map([['a:p', '\n']]),
}

const COMMENT_OPEN = '<!--'
const CDATA_OPEN = '<![CDATA['

/**
 * Streaming XML-to-text scanner. A tag (max 64 KiB) or entity (max 16 chars)
 * split across chunks is carried to the next push.
 */
export class XmlTextExtractor {
  private carry = ''
  private capture = 0
  private skip = 0

  constructor(
    private readonly rules: XmlTextRules,
    private readonly emit: (text: string) => void
  ) {}

  push(chunk: string): void {
    const s = this.carry + chunk
    this.carry = ''
    const length = s.length
    let i = 0
    while (i < length) {
      if (s.charCodeAt(i) !== 60 /* < */) {
        const lt = s.indexOf('<', i)
        const end = lt < 0 ? length : lt
        if (this.capturing()) {
          let segment = s.slice(i, end)
          if (lt < 0) {
            const amp = segment.lastIndexOf('&')
            if (amp >= 0 && segment.indexOf(';', amp) < 0 && segment.length - amp <= MAX_ENTITY_CHARS) {
              this.carry = segment.slice(amp)
              segment = segment.slice(0, amp)
            }
          }
          if (segment) this.emit(decodeEntities(segment))
        }
        i = end
        continue
      }

      const next = scanMarkup(
        s,
        i,
        (inner) => this.tag(inner),
        (cdata) => {
          if (this.capturing()) this.emit(cdata)
        }
      )
      if (next < 0) {
        if (length - i > MAX_TAG_CHARS) throw new OfficeParseError('XML tag too long')
        this.carry = s.slice(i)
        return
      }
      i = next
    }
  }

  end(): void {
    const carry = this.carry
    this.carry = ''
    // Leftover markup means the part ended inside a tag; a leftover "&..."
    // inside text was not an entity after all and is kept literally.
    if (carry.startsWith('<')) throw new OfficeParseError('Truncated XML')
    if (carry && this.capturing()) this.emit(carry)
  }

  private capturing(): boolean {
    return this.capture > 0 && this.skip === 0
  }

  private tag(inner: string): void {
    const first = inner.charCodeAt(0)
    if (first === 63 /* ? */ || first === 33 /* ! */) return
    const closing = first === 47 /* / */
    const empty = !closing && inner.endsWith('/')
    const match = /^\/?([^\s/>]+)/.exec(inner)
    if (!match) return
    const name = match[1]

    if (this.rules.skip.has(name)) {
      if (closing) this.skip = Math.max(0, this.skip - 1)
      else if (!empty) this.skip += 1
      return
    }
    if (this.skip > 0) return

    if (this.rules.text.has(name)) {
      if (closing) this.capture = Math.max(0, this.capture - 1)
      else if (!empty) this.capture += 1
      return
    }
    if (closing) {
      const out = this.rules.onClose.get(name)
      if (out) this.emit(out)
      return
    }
    const open = this.rules.onOpen.get(name)
    if (open) this.emit(open)
    if (empty) {
      const close = this.rules.onClose.get(name)
      if (close) this.emit(close)
    }
  }
}

/**
 * Handles the markup starting at s[i] === '<': a comment (skipped), CDATA
 * (passed to `onCData`) or a tag (its inner text passed to `onTag`). Returns
 * the index after the markup, or -1 when it is incomplete in `s`.
 */
function scanMarkup(
  s: string,
  i: number,
  onTag: (inner: string) => void,
  onCData: (text: string) => void
): number {
  if (s.startsWith(COMMENT_OPEN, i)) {
    const close = s.indexOf('-->', i + COMMENT_OPEN.length)
    return close < 0 ? -1 : close + 3
  }
  if (s.startsWith(CDATA_OPEN, i)) {
    const close = s.indexOf(']]>', i + CDATA_OPEN.length)
    if (close < 0) return -1
    onCData(s.slice(i + CDATA_OPEN.length, close))
    return close + 3
  }
  const rest = s.length - i
  if (rest < CDATA_OPEN.length) {
    const head = s.slice(i)
    if (CDATA_OPEN.startsWith(head) || COMMENT_OPEN.startsWith(head)) return -1
  }
  let quote = 0
  for (let j = i + 1; j < s.length; j++) {
    const code = s.charCodeAt(j)
    if (quote) {
      if (code === quote) quote = 0
    } else if (code === 34 || code === 39) {
      quote = code
    } else if (code === 62 /* > */) {
      onTag(s.slice(i + 1, j))
      return j + 1
    }
  }
  return -1
}

// ---------------------------------------------------------------- PPTX structure

/**
 * The only facts kept from PPTX structure parts: slide order and the notes
 * part of each slide. Values are short part names and ids, at most
 * OFFICE_MAX_SLIDES of each, so this stays small whatever the package holds.
 */
interface PptxStructure {
  /** r:id of each <p:sldId> in <p:sldIdLst>, in order; null if presentation.xml was missing or unreadable. */
  slideIds: string[] | null
  /** presentation.xml.rels: relationship id -> slide part name. */
  slideTargets: Map<string, string>
  /** Slide part name -> its speaker-notes part name. */
  notes: Map<string, string>
}

function emptyStructure(): PptxStructure {
  return { slideIds: null, slideTargets: new Map(), notes: new Map() }
}

/**
 * Streaming scanner for one PPTX structure part (presentation.xml, its rels,
 * or a slide's rels). It reads tags as they arrive and records only what
 * PptxStructure needs. A part that is malformed or too large is abandoned:
 * what it contributed is dropped and slide order falls back to slide numbers
 * (or that slide simply has no notes), as if the part were absent.
 */
class StructureScanner {
  abandoned = false
  private carry = ''
  private inSlideList = false
  private sawSlideList = false
  private readonly slideIds: string[] = []
  private readonly slideTargets = new Map<string, string>()
  private notesTarget: string | null = null

  constructor(
    private readonly key: string,
    private readonly structure: PptxStructure
  ) {}

  push(chunk: string): void {
    if (this.abandoned) return
    const s = this.carry + chunk
    this.carry = ''
    let i = 0
    while (i < s.length) {
      const lt = s.indexOf('<', i)
      if (lt < 0) return
      const next = scanMarkup(s, lt, (inner) => this.tag(inner), () => {})
      if (next < 0) {
        if (s.length - lt > MAX_TAG_CHARS) {
          this.abandon()
          return
        }
        this.carry = s.slice(lt)
        return
      }
      i = next
    }
  }

  abandon(): void {
    this.abandoned = true
    this.carry = ''
    this.slideIds.length = 0
    this.slideTargets.clear()
    this.notesTarget = null
  }

  /** Commits what the part contributed, unless it was abandoned or ended inside a tag. */
  end(): void {
    if (this.carry) this.abandon()
    if (this.abandoned) return
    if (this.key === PPTX_PRESENTATION) {
      if (this.sawSlideList) this.structure.slideIds = [...this.slideIds]
      return
    }
    if (this.key === PPTX_PRESENTATION_RELS) {
      for (const [id, part] of this.slideTargets) {
        if (this.structure.slideTargets.size >= OFFICE_MAX_SLIDES) break
        if (!this.structure.slideTargets.has(id)) this.structure.slideTargets.set(id, part)
      }
      return
    }
    const slide = PPTX_SLIDE_RELS.exec(this.key)
    if (slide && this.notesTarget) {
      const part = `ppt/slides/${slide[1]}`
      if (!this.structure.notes.has(part)) this.structure.notes.set(part, this.notesTarget)
    }
  }

  private tag(inner: string): void {
    const first = inner.charCodeAt(0)
    if (first === 63 /* ? */ || first === 33 /* ! */) return
    const closing = first === 47 /* / */
    const name = /^\/?([^\s/>]+)/.exec(inner)?.[1]
    if (!name) return

    if (this.key === PPTX_PRESENTATION) {
      if (name === 'p:sldIdLst') {
        if (closing) {
          this.inSlideList = false
        } else {
          this.sawSlideList = true
          this.inSlideList = !inner.endsWith('/')
        }
      } else if (name === 'p:sldId' && !closing && this.inSlideList && this.slideIds.length < OFFICE_MAX_SLIDES) {
        const id = attributes(inner).get('r:id')
        if (id && id.length <= MAX_STRUCTURE_VALUE_CHARS) this.slideIds.push(id)
      }
      return
    }
    if (name !== 'Relationship' || closing) return
    const attrs = attributes(inner)
    const id = attrs.get('Id')
    const target = attrs.get('Target')
    if (!id || !target || attrs.get('TargetMode') === 'External') return
    if (id.length > MAX_STRUCTURE_VALUE_CHARS || target.length > MAX_STRUCTURE_VALUE_CHARS) return
    const type = attrs.get('Type') ?? ''

    if (this.key === PPTX_PRESENTATION_RELS) {
      // Keyed by id; only targets that name a slide part are useful.
      const part = resolvePart('ppt/', target)
      if (PPTX_SLIDE.test(part) && !this.slideTargets.has(id) && this.slideTargets.size < OFFICE_MAX_SLIDES) {
        this.slideTargets.set(id, part)
      }
    } else if (this.notesTarget === null && type.endsWith('/notesSlide')) {
      this.notesTarget = resolvePart('ppt/slides/', target)
    }
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function decodeEntities(text: string): string {
  if (text.indexOf('&') < 0) return text
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (match, body: string) => {
    const named = NAMED_ENTITIES[body]
    if (named) return named
    const code = body[1] === 'x' || body[1] === 'X'
      ? Number.parseInt(body.slice(2), 16)
      : Number.parseInt(body.slice(1), 10)
    const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
    return valid ? String.fromCodePoint(code) : match
  })
}

// ---------------------------------------------------------------- assembly

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function finish(text: string, truncated: boolean): string {
  if (!text) return OFFICE_TEXT_EMPTY_MARKER
  return truncated ? `${text}${OFFICE_TEXT_TRUNCATED_MARKER}` : text
}

function assembleDocx(parts: ExtractedParts): string {
  return finish(tidy(parts.text.get(DOCX_BODY) ?? ''), parts.truncated)
}

function assemblePptx(parts: ExtractedParts): string {
  const slides = slideOrder(parts)
  const blocks: string[] = []
  let anyText = false
  slides.forEach((slide, index) => {
    const body = tidy(parts.text.get(slide) ?? '')
    const notesPart = notesFor(slide, parts)
    const notes = notesPart ? tidy(parts.text.get(notesPart) ?? '') : ''
    if (body || notes) anyText = true
    blocks.push(
      `Slide ${index + 1}\n${body}${notes ? `\n[Speaker notes]\n${notes}` : ''}`.trim()
    )
  })
  return finish(anyText ? blocks.join('\n\n') : '', parts.truncated)
}

function attributes(source: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out.set(match[1], decodeEntities(match[2] ?? match[3] ?? ''))
  }
  return out
}

/** Resolves a relationship target to a lower-case part name. */
function resolvePart(baseDir: string, target: string): string {
  const path = target.startsWith('/') ? target.slice(1) : `${baseDir}${target}`
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.join('/').toLowerCase()
}

function slideNumber(part: string): number {
  return Number(/(\d+)\.xml$/.exec(part)?.[1] ?? 0)
}

/** Slides in <p:sldIdLst> order; numeric slideN order if that cannot be read. */
function slideOrder(parts: ExtractedParts): string[] {
  const available = [...parts.text.keys()].filter((key) => PPTX_SLIDE.test(key))
  const numeric = [...available].sort((left, right) => slideNumber(left) - slideNumber(right))

  const { slideIds, slideTargets } = parts.structure
  if (!slideIds) return numeric
  const present = new Set(available)
  const ordered = new Set<string>()
  for (const id of slideIds) {
    const part = slideTargets.get(id)
    if (part && present.has(part)) ordered.add(part)
  }
  return ordered.size > 0 ? [...ordered] : numeric
}

function notesFor(slide: string, parts: ExtractedParts): string | null {
  return parts.structure.notes.get(slide) ?? null
}
