import { createHash } from 'node:crypto'
import type { LlmFileInput } from '@/lib/ai/llm'
import type { AudioRecapSourceDocument } from '@/lib/audio-recap-types'
import { documentSha256 } from '@/lib/session-documents'
import * as documentsDb from '@/lib/db/session-documents'
import type { SessionDocument } from '@/lib/db/session-documents'

/** OpenAI Responses accepts up to 50 MB combined file input per request. */
export const AUDIO_RECAP_MAX_SOURCE_BYTES = 50 * 1024 * 1024

export interface AudioRecapSourceSnapshot {
  documents: AudioRecapSourceDocument[]
  digest: string
  totalBytes: number
}

type SourceDocumentRow = Pick<
  SessionDocument,
  'id' | 'display_name' | 'mime_type' | 'byte_size' | 'sha256'
>

/** Stable provenance snapshot independent of database result ordering. */
export function buildRecapSourceSnapshot(
  rows: SourceDocumentRow[]
): AudioRecapSourceSnapshot {
  const documents = rows
    .map((row) => {
      if (!row.sha256) {
        throw new Error(`Document "${row.display_name}" has no verified integrity hash`)
      }
      return {
        id: row.id,
        filename: row.display_name,
        mimeType: row.mime_type,
        byteSize: Number(row.byte_size),
        sha256: row.sha256,
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
  const totalBytes = documents.reduce((total, document) => total + document.byteSize, 0)
  const digest = createHash('sha256').update(JSON.stringify(documents)).digest('hex')
  return { documents, digest, totalBytes }
}

export async function getCurrentRecapSourceSnapshot(
  sessionId: string
): Promise<AudioRecapSourceSnapshot> {
  const documents = await documentsDb.listSessionDocumentsAsSystem(sessionId)
  return buildRecapSourceSnapshot(documents)
}

export async function loadRecapSourceFiles(sessionId: string): Promise<{
  snapshot: AudioRecapSourceSnapshot
  files: LlmFileInput[]
}> {
  const documents = await documentsDb.listSessionDocumentsAsSystem(sessionId)
  if (documents.length === 0) {
    throw new Error('Upload at least one PDF, DOCX, or PPTX in the Documents tab first.')
  }

  const snapshot = buildRecapSourceSnapshot(documents)
  if (snapshot.totalBytes > AUDIO_RECAP_MAX_SOURCE_BYTES) {
    throw new Error(
      'The available learning documents exceed the 50 MiB combined AI input limit. Archive or delete some documents and try again.'
    )
  }

  const rowsById = new Map(documents.map((document) => [document.id, document]))
  const files = await Promise.all(
    snapshot.documents.map(async (source) => {
      const row = rowsById.get(source.id)!
      const blob = await documentsDb.downloadDocumentObject(row.storage_path)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const actualSha256 = documentSha256(bytes)
      if (bytes.byteLength !== source.byteSize || actualSha256 !== source.sha256) {
        throw new Error(
          `Document "${source.filename}" failed its integrity check. Re-upload it before generating the recap.`
        )
      }
      return {
        filename: source.filename,
        mimeType: source.mimeType,
        bytes,
        sha256: actualSha256,
      }
    })
  )

  return { snapshot, files }
}

export function recapSourcesAreCurrent(
  storedDigest: string | null,
  current: AudioRecapSourceSnapshot
): boolean {
  return Boolean(storedDigest) && storedDigest === current.digest && current.documents.length > 0
}
