import type { LlmFileInput } from '@/lib/ai/llm'
import { verifiedFileSources } from '@/lib/ai/streaming-body'
import type { OpsNewsletterSourceDocument } from '@/lib/types'
import type { OpsSessionRow } from '@/lib/db/ops-reads'
import * as documentsDb from '@/lib/db/session-documents'

/**
 * Product limits that keep a manual job predictable. Anthropic uploads each
 * document separately through the Files API (one request is still bounded by
 * the model's 600-page PDF and context limits); the OpenAI Responses adapter
 * accepts up to 50 MB of file input per request.
 */
export const NEWSLETTER_MAX_SOURCE_BYTES = 50 * 1024 * 1024
export const NEWSLETTER_MAX_SOURCE_FILES = 50

export interface NewsletterSourceBundle {
  documents: OpsNewsletterSourceDocument[]
  /** Lazy inputs: each request attempt streams the objects from storage. */
  files: LlmFileInput[]
  /** Rethrows a storage or integrity failure raised while the files streamed. */
  throwIfSourceFailed(): void
}

/**
 * Select every currently available teaching document for the selected sessions.
 * The job fails rather than silently dropping a document when the provider
 * input boundary is exceeded or stored integrity no longer matches (checked
 * while each object streams into the provider request).
 */
export async function loadNewsletterSourceFiles(
  sessions: OpsSessionRow[]
): Promise<NewsletterSourceBundle> {
  const rowsBySession = await Promise.all(
    sessions.map(async (session) => ({
      session,
      rows: await documentsDb.listSessionDocumentsAsSystem(session.id),
    }))
  )

  const flattened = rowsBySession.flatMap(({ session, rows }, sessionIndex) =>
    rows.map((row) => {
      if (!row.sha256) {
        throw new Error(`Teaching document "${row.display_name}" has no verified integrity hash`)
      }
      return { session, sessionIndex, row, sha256: row.sha256 }
    })
  )
  const totalBytes = flattened.reduce((total, item) => total + Number(item.row.byte_size), 0)
  if (flattened.length > NEWSLETTER_MAX_SOURCE_FILES) {
    throw new Error(
      `This week has ${flattened.length} teaching documents; the newsletter job supports at most ${NEWSLETTER_MAX_SOURCE_FILES}. Archive duplicates and try again.`
    )
  }
  if (totalBytes > NEWSLETTER_MAX_SOURCE_BYTES) {
    throw new Error(
      'The week’s teaching documents exceed the 50 MiB combined AI input limit. Archive duplicate or unnecessary files and try again.'
    )
  }

  const sources = verifiedFileSources(
    flattened.map(({ sessionIndex, row, sha256 }, documentIndex) => ({
      filename: `session-${sessionIndex + 1}-document-${documentIndex + 1}-${row.display_name}`,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      sha256,
      read: async (signal: AbortSignal) =>
        (await documentsDb.fetchDocumentObject(row.storage_path, { signal })).body,
      integrityError: () =>
        new Error(
          `Teaching document "${row.display_name}" failed its integrity check. Re-upload it before generating the newsletter.`
        ),
    }))
  )

  return {
    documents: flattened.map(({ session, row, sha256 }) => ({
      sessionId: session.id,
      sessionTitle: session.title,
      id: row.id,
      filename: row.display_name,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      sha256,
    })),
    files: sources.files,
    throwIfSourceFailed: sources.throwIfFailed,
  }
}
