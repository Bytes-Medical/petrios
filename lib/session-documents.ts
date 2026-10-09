export const SESSION_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024

export const SESSION_DOCUMENT_MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
} as const

export type SessionDocumentMime = (typeof SESSION_DOCUMENT_MIME)[keyof typeof SESSION_DOCUMENT_MIME]
export type SessionDocumentExtension = keyof typeof SESSION_DOCUMENT_MIME

const EXTENSION_TO_MIME: Record<SessionDocumentExtension, SessionDocumentMime> = {
  pdf: SESSION_DOCUMENT_MIME.pdf,
  docx: SESSION_DOCUMENT_MIME.docx,
  pptx: SESSION_DOCUMENT_MIME.pptx,
}

export function safeDocumentFilename(input: string): string {
  const basename = input.split(/[\\/]/).pop()?.trim() || 'document'
  return basename.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || 'document'
}

export function validateDocumentMetadata(input: {
  filename: string
  mimeType: string
  byteSize: number
}): { filename: string; extension: SessionDocumentExtension; mimeType: SessionDocumentMime } {
  const filename = safeDocumentFilename(input.filename)
  const extension = filename.split('.').pop()?.toLowerCase() as SessionDocumentExtension
  const expectedMime = EXTENSION_TO_MIME[extension]
  if (!expectedMime) throw new Error('Only PDF, DOCX, and PPTX documents are supported')
  if (input.mimeType !== expectedMime) throw new Error('The file extension and content type do not match')
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) throw new Error('The document is empty')
  if (input.byteSize > SESSION_DOCUMENT_MAX_BYTES) throw new Error('Documents are limited to 25 MiB')
  return { filename, extension, mimeType: expectedMime }
}

export function documentExtensionForMime(mimeType: SessionDocumentMime): SessionDocumentExtension {
  const extension = (Object.keys(EXTENSION_TO_MIME) as SessionDocumentExtension[]).find(
    (candidate) => EXTENSION_TO_MIME[candidate] === mimeType
  )
  if (!extension) throw new Error('Only PDF, DOCX, and PPTX documents are supported')
  return extension
}

export function canActorDeleteSessionDocument(input: {
  actorUserId: string
  uploadedBy: string
  isModerator: boolean
}): boolean {
  return input.isModerator || input.actorUserId === input.uploadedBy
}
