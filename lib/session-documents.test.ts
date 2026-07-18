import { describe, expect, it } from 'vitest'
import {
  canActorDeleteSessionDocument,
  SESSION_DOCUMENT_MAX_BYTES,
  safeDocumentFilename,
  validateDocumentBytes,
  validateDocumentMetadata,
} from './session-documents'

describe('session document validation', () => {
  it('normalizes path-like filenames and accepts matching supported metadata', () => {
    expect(safeDocumentFilename('../../teaching-pack.pdf')).toBe('teaching-pack.pdf')
    expect(
      validateDocumentMetadata({
        filename: 'teaching-pack.pdf',
        mimeType: 'application/pdf',
        byteSize: 128,
      })
    ).toEqual({
      filename: 'teaching-pack.pdf',
      extension: 'pdf',
      mimeType: 'application/pdf',
    })
  })

  it('rejects unsupported, mismatched, empty, and oversized files', () => {
    expect(() =>
      validateDocumentMetadata({ filename: 'notes.txt', mimeType: 'text/plain', byteSize: 10 })
    ).toThrow('Only PDF, DOCX, and PPTX')
    expect(() =>
      validateDocumentMetadata({ filename: 'slides.pptx', mimeType: 'application/pdf', byteSize: 10 })
    ).toThrow('extension and content type')
    expect(() =>
      validateDocumentMetadata({ filename: 'notes.pdf', mimeType: 'application/pdf', byteSize: 0 })
    ).toThrow('empty')
    expect(() =>
      validateDocumentMetadata({
        filename: 'notes.pdf',
        mimeType: 'application/pdf',
        byteSize: SESSION_DOCUMENT_MAX_BYTES + 1,
      })
    ).toThrow('25 MiB')
  })

  it('checks PDF magic bytes', () => {
    expect(() => validateDocumentBytes(Buffer.from('%PDF-1.7'), 'pdf')).not.toThrow()
    expect(() => validateDocumentBytes(Buffer.from('hello'), 'pdf')).toThrow('not a valid PDF')
  })

  it('checks Office package markers and rejects macros', () => {
    const docx = Buffer.from('PK\u0003\u0004...[Content_Types].xml...word/document.xml')
    expect(() => validateDocumentBytes(docx, 'docx')).not.toThrow()
    expect(() => validateDocumentBytes(docx, 'pptx')).toThrow('not a valid PPTX')

    const macroDocx = Buffer.from(
      'PK\u0003\u0004...[Content_Types].xml...word/document.xml...vbaProject.bin'
    )
    expect(() => validateDocumentBytes(macroDocx, 'docx')).toThrow('Macro-enabled')
  })
})

describe('session document deletion authority', () => {
  it('allows moderators to delete any document', () => {
    expect(
      canActorDeleteSessionDocument({
        actorUserId: 'moderator',
        uploadedBy: 'teacher',
        isModerator: true,
      })
    ).toBe(true)
  })

  it('allows an uploader to delete their own document', () => {
    expect(
      canActorDeleteSessionDocument({
        actorUserId: 'teacher',
        uploadedBy: 'teacher',
        isModerator: false,
      })
    ).toBe(true)
  })

  it('rejects a non-moderator deleting another uploader document', () => {
    expect(
      canActorDeleteSessionDocument({
        actorUserId: 'teacher-a',
        uploadedBy: 'teacher-b',
        isModerator: false,
      })
    ).toBe(false)
  })
})
