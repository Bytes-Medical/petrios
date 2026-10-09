import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  DOCX_RULES,
  extractOfficeText,
  officeKindForMime,
  OFFICE_MAX_SLIDES,
  OFFICE_TEXT_EMPTY_MARKER,
  OFFICE_TEXT_TRUNCATED_MARKER,
  PPTX_RULES,
  XmlTextExtractor,
  type OfficeKind,
} from './office-text'
import { verifiedFileSources, type LlmFileInput } from './streaming-body'
import { zip, type ZipPart } from './testing/office-zip'

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

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

const MIME: Record<OfficeKind, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

function fileInput(
  bytes: Uint8Array,
  kind: OfficeKind = 'docx',
  chunkSize = 4096
): LlmFileInput & { opens: number } {
  const input = {
    filename: `notes.${kind}`,
    mimeType: MIME[kind],
    sha256: sha256(bytes),
    opens: 0,
    open: async () => {
      input.opens += 1
      return chunked(bytes, chunkSize)
    },
  }
  return input
}

const extract = (file: LlmFileInput, kind: OfficeKind, limits?: Parameters<typeof extractOfficeText>[3]) =>
  extractOfficeText(file, kind, new AbortController().signal, limits)

// ------------------------------------------------------------ fixtures

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"'

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Sepsis &amp; shock</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Give </w:t></w:r><w:del w:id="1"><w:r><w:delText>old advice</w:delText></w:r></w:del><w:r><w:t>oxygen</w:t><w:tab/><w:t>&#x2014;now &lt;15 min&gt;</w:t><w:br/><w:t>line &quot;two&quot;</w:t></w:r></w:p>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> AUTHOR </w:instrText></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:t>box</w:t></mc:Choice><mc:Fallback><w:t>box</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>
<!-- a comment with <w:t>hidden</w:t> inside -->
<w:p><w:r><w:t><![CDATA[a < b]]></w:t></w:r></w:p>
<w:p/>
<w:p><w:r><w:t>Caf&#233; – ward 7</w:t></w:r></w:p>
</w:body></w:document>`

const DOCX_TEXT = 'Sepsis & shock\nGive oxygen\t—now <15 min>\nline "two"\n\nA1\n\tB1\n\nbox\na < b\n\nCafé – ward 7'

async function docx(overrides: Partial<ZipPart> = {}, extra: ZipPart[] = []): Promise<Uint8Array> {
  return zip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: '_rels/.rels', data: '<Relationships/>' },
    { name: 'docProps/core.xml', data: '<cp:coreProperties><dc:creator>Dr Secret</dc:creator></cp:coreProperties>' },
    { name: 'word/header1.xml', data: `<w:hdr ${W}><w:p><w:r><w:t>HEADER TEXT</w:t></w:r></w:p></w:hdr>` },
    { name: 'word/document.xml', data: DOCUMENT_XML, ...overrides },
    ...extra,
  ])
}

const SLIDE = (body: string) =>
  `<p:sld xmlns:a="a" xmlns:p="p" xmlns:r="r"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`
const SHAPE = (paragraphs: string) => `<p:sp><p:txBody>${paragraphs}</p:txBody></p:sp>`
const REL = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`

async function pptx(options: { presentation?: boolean; method?: 0 | 8 } = {}): Promise<Uint8Array> {
  const method = options.method ?? 8
  const parts: ZipPart[] = [
    { name: '[Content_Types].xml', data: '<Types/>', method },
    // slide1 is stored first but is the SECOND slide in presentation order.
    {
      name: 'ppt/slides/slide1.xml',
      method,
      data: SLIDE(
        SHAPE('<a:p><a:r><a:t>Later slide</a:t></a:r></a:p>') +
        SHAPE('<a:p><a:fld id="{1}" type="slidenum"><a:t>2</a:t></a:fld></a:p>')
      ),
    },
    {
      name: 'ppt/slides/slide2.xml',
      method,
      data: SLIDE(
        SHAPE('<a:p><a:r><a:t>Opening</a:t></a:r><a:br/><a:r><a:t>Agenda</a:t></a:r></a:p>') +
        SHAPE('<a:p><a:pPr><a:tabLst><a:tab pos="914400" algn="l"/></a:tabLst></a:pPr><a:r><a:t>Point&#9;one</a:t></a:r></a:p>')
      ),
    },
    {
      name: 'ppt/slides/_rels/slide2.xml.rels',
      method,
      data: `<Relationships>${REL('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml')}${REL('rId2', 'notesSlide', '../notesSlides/notesSlide7.xml')}</Relationships>`,
    },
    {
      name: 'ppt/notesSlides/notesSlide7.xml',
      method,
      data: `<p:notes xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>${SHAPE('<a:p><a:r><a:t>Say hello &amp; welcome</a:t></a:r></a:p>')}${SHAPE('<a:p><a:fld type="slidenum"><a:t>1</a:t></a:fld></a:p>')}</p:spTree></p:cSld></p:notes>`,
    },
    {
      name: 'ppt/slideMasters/slideMaster1.xml',
      method,
      data: SLIDE(SHAPE('<a:p><a:r><a:t>MASTER TEXT</a:t></a:r></a:p>')),
    },
    { name: 'docProps/core.xml', data: '<dc:creator>Dr Secret</dc:creator>', method },
  ]
  if (options.presentation !== false) {
    parts.push(
      {
        name: 'ppt/presentation.xml',
        method,
        data: '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>',
      },
      {
        name: 'ppt/_rels/presentation.xml.rels',
        method,
        data: `<Relationships>${REL('rId1', 'slideMaster', 'slideMasters/slideMaster1.xml')}${REL('rId2', 'slide', 'slides/slide1.xml')}${REL('rId3', 'slide', '/ppt/slides/slide2.xml')}</Relationships>`,
      }
    )
  }
  return zip(parts)
}

const PPTX_TEXT = 'Slide 1\nOpening\nAgenda\nPoint\tone\n[Speaker notes]\nSay hello & welcome\n\nSlide 2\nLater slide'

// ------------------------------------------------------------ tests

describe('officeKindForMime', () => {
  it('maps the two Office types and nothing else', () => {
    expect(officeKindForMime(MIME.docx)).toBe('docx')
    expect(officeKindForMime(MIME.pptx)).toBe('pptx')
    expect(officeKindForMime('application/pdf')).toBeNull()
  })
})

describe('XmlTextExtractor', () => {
  const run = (pieces: string[], rules = DOCX_RULES) => {
    const out: string[] = []
    const extractor = new XmlTextExtractor(rules, (text) => out.push(text))
    for (const piece of pieces) extractor.push(piece)
    extractor.end()
    return out.join('')
  }

  it('gives identical output for every two-way split (tags, attributes, entities, CDATA, comments)', () => {
    const whole = run([DOCUMENT_XML])
    for (let index = 0; index <= DOCUMENT_XML.length; index++) {
      expect(run([DOCUMENT_XML.slice(0, index), DOCUMENT_XML.slice(index)]), `split at ${index}`).toBe(whole)
    }
    expect(run([...DOCUMENT_XML])).toBe(whole)
  })

  it('treats ">" inside a quoted attribute as data', () => {
    expect(run(['<w:p><w:r w:x="a>b"><w:t>ok</w:t></w:r></w:p>'])).toBe('ok\n')
  })

  it('rejects a part that ends inside a tag, but keeps a stray ampersand as text', () => {
    expect(() => run(['<w:p><w:r><w:t>cut</w:t></w:r><w:p'])).toThrow('Truncated XML')
    expect(run(['<w:p><w:r><w:t>A &', 'B'])).toBe('A &B')
  })

  it('rejects a runaway tag', () => {
    const extractor = new XmlTextExtractor(DOCX_RULES, () => {})
    expect(() => extractor.push(`<w:p a="${'x'.repeat(70_000)}`)).toThrow()
  })

  it('maps DrawingML breaks and ignores tab-stop definitions', () => {
    expect(run(['<a:p><a:pPr><a:tabLst><a:tab pos="1"/></a:tabLst></a:pPr><a:r><a:t>x</a:t></a:r><a:br/><a:r><a:t>y</a:t></a:r></a:p>'], PPTX_RULES))
      .toBe('x\ny\n')
  })
})

describe('extractOfficeText (DOCX)', () => {
  it('extracts the body in document order and skips deletions, field codes, headers and properties', async () => {
    const file = fileInput(await docx())
    await expect(extract(file, 'docx')).resolves.toBe(DOCX_TEXT)
    expect(file.opens).toBe(2)
  })

  it('reads stored parts split at every byte boundary (tags, entities and UTF-8 sequences across chunks)', async () => {
    const bytes = await docx({ method: 0 })
    for (const chunkSize of [1, 2, 3, 7, 64]) {
      await expect(extract(fileInput(bytes, 'docx', chunkSize), 'docx'), `chunk ${chunkSize}`).resolves.toBe(DOCX_TEXT)
    }
  })

  it('reads a deflated part written with a data descriptor (sizes from the central directory)', async () => {
    const bytes = await docx({ descriptor: true }, [{ name: 'word/styles.xml', data: '<w:styles/>', descriptor: true }])
    await expect(extract(fileInput(bytes, 'docx', 5), 'docx')).resolves.toBe(DOCX_TEXT)
  })

  it('returns the empty marker when the body has no text', async () => {
    const bytes = await docx({ data: `<w:document ${W}><w:body><w:p/></w:body></w:document>` })
    await expect(extract(fileInput(bytes), 'docx')).resolves.toBe(OFFICE_TEXT_EMPTY_MARKER)
  })

  it('truncates at the character limit and says so', async () => {
    await expect(extract(fileInput(await docx()), 'docx', { maxChars: 10 }))
      .resolves.toBe(`Sepsis & s${OFFICE_TEXT_TRUNCATED_MARKER}`)
  })

  it('stops inflating once the character budget is spent', async () => {
    const big = `<w:document ${W}><w:body><w:p><w:r><w:t>${'a'.repeat(200_000)}</w:t></w:r></w:p></w:body></w:document>`
    // Inflating the whole part would trip the 50 KB guard; the early stop never gets there.
    for (const method of [0, 8] as const) {
      await expect(extract(fileInput(await docx({ data: big, method })), 'docx', { maxChars: 10, maxInflatedBytes: 50_000 }))
        .resolves.toBe(`aaaaaaaaaa${OFFICE_TEXT_TRUNCATED_MARKER}`)
    }
  })

  it('stops inflating at the zip-bomb limit', async () => {
    const big = `<w:document ${W}><w:body><w:p><w:r><w:t>${'a'.repeat(200_000)}</w:t></w:r></w:p></w:body></w:document>`
    const bytes = await docx({ data: big })
    await expect(extract(fileInput(bytes), 'docx', { maxInflatedBytes: 50_000 }))
      .rejects.toThrow('Document "notes.docx" is too large to read')
  })

  it('rejects an encrypted part', async () => {
    const bytes = await docx({ flags: 0x0001 })
    await expect(extract(fileInput(bytes), 'docx')).rejects.toThrow('Document "notes.docx" could not be read as DOCX text')
  })

  it('rejects a package without word/document.xml, and non-ZIP bytes', async () => {
    const noBody = await zip([{ name: '[Content_Types].xml', data: '<Types/>' }])
    await expect(extract(fileInput(noBody), 'docx')).rejects.toThrow('could not be read as DOCX text')
    await expect(extract(fileInput(new TextEncoder().encode('not a zip at all')), 'docx'))
      .rejects.toThrow('could not be read as DOCX text')
  })

  it('rejects corrupt compressed data', async () => {
    const bytes = await docx()
    const view = Buffer.from(bytes)
    // First deflate byte: BFINAL=1 with the reserved block type 11.
    view[view.indexOf(Buffer.from('word/document.xml')) + 'word/document.xml'.length] = 0x07
    await expect(extract(fileInput(new Uint8Array(view)), 'docx')).rejects.toThrow('could not be read as DOCX text')
  })

  it('accepts no text when the second read fails its integrity check', async () => {
    const good = await docx({ method: 0 })
    const tampered = Buffer.from(good)
    const at = tampered.indexOf(Buffer.from('oxygen'))
    tampered.write('OXYGEN', at)
    let reads = 0
    const sources = verifiedFileSources([{
      filename: 'notes.docx',
      mimeType: MIME.docx,
      byteSize: good.byteLength,
      sha256: sha256(good),
      read: async () => chunked(reads++ === 0 ? good : new Uint8Array(tampered), 3),
      integrityError: () => new Error('Document "notes.docx" failed its integrity check.'),
    }])

    await expect(extract(sources.files[0], 'docx')).rejects.toThrow('Document "notes.docx" failed its integrity check.')
    expect(reads).toBe(2)
    expect(() => sources.throwIfFailed()).toThrow('failed its integrity check')
  })

  it('propagates a storage failure unchanged (not as a parse error)', async () => {
    const good = await docx()
    let opens = 0
    const file: LlmFileInput = {
      filename: 'notes.docx',
      mimeType: MIME.docx,
      sha256: sha256(good),
      open: async () => {
        // Pass 1 succeeds; pass 2 fails part-way through.
        if (opens++ === 0) return chunked(good, 4096)
        let sent = false
        return new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!sent) {
              sent = true
              controller.enqueue(good.slice(0, 200))
            } else {
              controller.error(new Error('Storage responded 500'))
            }
          },
        })
      },
    }
    await expect(extract(file, 'docx')).rejects.toThrow(/^Storage responded 500$/)
  })

  it('cancels the storage read when a part is rejected mid-stream', async () => {
    const big = `<w:document ${W}><w:body><w:p><w:r><w:t>${'a'.repeat(200_000)}</w:t></w:r></w:p></w:body></w:document>`
    const bytes = await docx({ data: big, method: 0 })
    let cancelled: unknown = null
    let opens = 0
    const file: LlmFileInput = {
      filename: 'notes.docx',
      mimeType: MIME.docx,
      sha256: sha256(bytes),
      open: async () => {
        opens += 1
        const inner = chunked(bytes, 1024).getReader()
        return new ReadableStream<Uint8Array>({
          async pull(controller) {
            const read = await inner.read()
            if (read.done) controller.close()
            else controller.enqueue(read.value)
          },
          cancel(reason) {
            cancelled = reason
          },
        })
      },
    }
    await expect(extract(file, 'docx', { maxInflatedBytes: 10_000 })).rejects.toThrow('is too large to read')
    expect(opens).toBe(2)
    expect(cancelled).not.toBeNull()
  })
})

describe('extractOfficeText (PPTX)', () => {
  it('orders slides by sldIdLst (not filename), maps speaker notes, and skips masters, fields and properties', async () => {
    const file = fileInput(await pptx(), 'pptx', 11)
    await expect(extract(file, 'pptx')).resolves.toBe(PPTX_TEXT)
  })

  it('reads stored PPTX parts', async () => {
    await expect(extract(fileInput(await pptx({ method: 0 }), 'pptx', 1), 'pptx')).resolves.toBe(PPTX_TEXT)
  })

  it('falls back to numeric slide order when presentation.xml is missing', async () => {
    await expect(extract(fileInput(await pptx({ presentation: false }), 'pptx'), 'pptx')).resolves.toBe(
      'Slide 1\nLater slide\n\nSlide 2\nOpening\nAgenda\nPoint\tone\n[Speaker notes]\nSay hello & welcome'
    )
  })

  it('returns the empty marker for a deck without text', async () => {
    const bytes = await zip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'ppt/slides/slide1.xml', data: SLIDE(SHAPE('<a:p/>')) },
    ])
    await expect(extract(fileInput(bytes, 'pptx'), 'pptx')).resolves.toBe(OFFICE_TEXT_EMPTY_MARKER)
  })
  it('does not inflate later slides once the character budget is spent', async () => {
    const slide = (n: number): ZipPart => ({
      name: `ppt/slides/slide${n}.xml`,
      data: SLIDE(SHAPE(`<a:p><a:r><a:t>${String(n).repeat(30_000)}</a:t></a:r></a:p>`)),
    })
    const bytes = await zip([{ name: '[Content_Types].xml', data: '<Types/>' }, slide(1), slide(2), slide(3)])
    await expect(extract(fileInput(bytes, 'pptx'), 'pptx', { maxChars: 5, maxInflatedBytes: 40_000 }))
      .resolves.toBe(`Slide 1\n11111\n\nSlide 2\n\nSlide 3${OFFICE_TEXT_TRUNCATED_MARKER}`)
  })

  it('reads relationship parts only for slides that exist', async () => {
    const orphan = `<Relationships>${' '.repeat(100_000)}</Relationships>`
    const bytes = await zip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'ppt/slides/slide1.xml', data: SLIDE(SHAPE('<a:p><a:r><a:t>Only slide</a:t></a:r></a:p>')) },
      ...Array.from({ length: 20 }, (_, index): ZipPart => ({
        name: `ppt/slides/_rels/slide${index + 2}.xml.rels`,
        data: orphan,
      })),
    ])
    // Reading the 20 orphan parts would inflate ~2 MB and trip the guard.
    await expect(extract(fileInput(bytes, 'pptx'), 'pptx', { maxInflatedBytes: 50_000 }))
      .resolves.toBe('Slide 1\nOnly slide')
  })

  it('refuses a deck with more slides than the limit', async () => {
    const bytes = await zip([
      { name: '[Content_Types].xml', data: '<Types/>', method: 0 },
      ...Array.from({ length: OFFICE_MAX_SLIDES + 1 }, (_, index): ZipPart => ({
        name: `ppt/slides/slide${index + 1}.xml`,
        data: '<p:sld/>',
        method: 0,
      })),
    ])
    await expect(extract(fileInput(bytes, 'pptx'), 'pptx')).rejects.toThrow('Document "notes.pptx" is too large to read')
  })

  it('ignores a malformed or oversized structure part instead of failing the deck', async () => {
    const bytes = await zip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'ppt/slides/slide1.xml', data: SLIDE(SHAPE('<a:p><a:r><a:t>First</a:t></a:r></a:p>')) },
      { name: 'ppt/slides/slide2.xml', data: SLIDE(SHAPE('<a:p><a:r><a:t>Second</a:t></a:r></a:p>')) },
      // Ends inside a tag: order falls back to slide numbers.
      { name: 'ppt/presentation.xml', data: '<p:presentation><p:sldIdLst><p:sldId r:id="rId2"/><p:sldId r:id="rId1"' },
      { name: 'ppt/_rels/presentation.xml.rels', data: `<Relationships>${REL('rId1', 'slide', 'slides/slide1.xml')}${REL('rId2', 'slide', 'slides/slide2.xml')}</Relationships>` },
      // Larger than the 2 MiB structure limit: no notes for slide 1.
      { name: 'ppt/slides/_rels/slide1.xml.rels', data: `<Relationships>${' '.repeat(2 * 1024 * 1024)}${REL('rId9', 'notesSlide', '../notesSlides/notesSlide1.xml')}</Relationships>` },
      { name: 'ppt/notesSlides/notesSlide1.xml', data: `<p:notes>${SHAPE('<a:p><a:r><a:t>Hidden notes</a:t></a:r></a:p>')}</p:notes>` },
    ])
    await expect(extract(fileInput(bytes, 'pptx'), 'pptx')).resolves.toBe('Slide 1\nFirst\n\nSlide 2\nSecond')
  })

  it('keeps only the relationships of large structure parts, not their XML', async () => {
    // Each slide's relationship part is ~1.9 MB of padding before its notes
    // relationship. Retaining the parts would hold ~114 MB; streaming them
    // keeps a few hundred bytes. One shared string keeps the fixture cheap.
    const count = 60
    const rels = `<Relationships>${' '.repeat(1_900_000)}${REL('rId1', 'notesSlide', '../notesSlides/notesSlide1.xml')}</Relationships>`
    const parts: ZipPart[] = [{ name: '[Content_Types].xml', data: '<Types/>' }]
    for (let n = 1; n <= count; n++) {
      parts.push(
        { name: `ppt/slides/slide${n}.xml`, data: SLIDE(SHAPE(`<a:p><a:r><a:t>Point ${n}</a:t></a:r></a:p>`)) },
        { name: `ppt/slides/_rels/slide${n}.xml.rels`, data: rels }
      )
    }
    parts.push({ name: 'ppt/notesSlides/notesSlide1.xml', data: `<p:notes>${SHAPE('<a:p><a:r><a:t>Shared notes</a:t></a:r></a:p>')}</p:notes>` })
    const bytes = await zip(parts)

    // Large decoded strings live outside the JS heap, so count external memory too.
    const used = () => {
      const memory = process.memoryUsage()
      return memory.heapUsed + memory.external
    }
    const base = used()
    let peak = base
    const file: LlmFileInput = {
      ...fileInput(bytes, 'pptx'),
      open: async () => {
        let offset = 0
        return new ReadableStream<Uint8Array>({
          pull(controller) {
            peak = Math.max(peak, used())
            if (offset >= bytes.byteLength) {
              controller.close()
              return
            }
            controller.enqueue(bytes.slice(offset, offset + 512))
            offset += 512
          },
        })
      },
    }
    const text = await extract(file, 'pptx', { maxInflatedBytes: 160 * 1024 * 1024 })
    expect(text).toContain(`Slide ${count}\nPoint ${count}\n[Speaker notes]\nShared notes`)
    expect(peak - base).toBeLessThan(48 * 1024 * 1024)
  }, 30_000)
})
