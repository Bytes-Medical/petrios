import { documentSha256 } from '@/lib/session-documents'
import type { LlmFileInput } from '@/lib/ai/llm'
import type { OpsNewsletterSourceDocument } from '@/lib/types'
import type { OpsSessionRow } from '@/lib/db/ops-reads'
import * as documentsDb from '@/lib/db/session-documents'

/** Responses file input is bounded to keep a manual job predictable. */
export const NEWSLETTER_MAX_SOURCE_BYTES = 50 * 1024 * 1024
export const NEWSLETTER_MAX_SOURCE_FILES = 50

export interface NewsletterSourceBundle {
  documents: OpsNewsletterSourceDocument[]
  files: LlmFileInput[]
}

/**
 * Load every currently available teaching document for the selected sessions.
 * The job fails rather than silently dropping a document when the provider
 * input boundary is exceeded or stored integrity no longer matches.
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
      return { session, sessionIndex, row }
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

  const loaded = await Promise.all(
    flattened.map(async ({ session, sessionIndex, row }, documentIndex) => {
      const blob = await documentsDb.downloadDocumentObject(row.storage_path)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const sha256 = documentSha256(bytes)
      if (bytes.byteLength !== Number(row.byte_size) || sha256 !== row.sha256) {
        throw new Error(
          `Teaching document "${row.display_name}" failed its integrity check. Re-upload it before generating the newsletter.`
        )
      }
      const providerFilename = `session-${sessionIndex + 1}-document-${documentIndex + 1}-${row.display_name}`
      return {
        document: {
          sessionId: session.id,
          sessionTitle: session.title,
          id: row.id,
          filename: row.display_name,
          mimeType: row.mime_type,
          byteSize: Number(row.byte_size),
          sha256,
        } satisfies OpsNewsletterSourceDocument,
        file: {
          filename: providerFilename,
          mimeType: row.mime_type,
          bytes,
          sha256,
        } satisfies LlmFileInput,
      }
    })
  )

  return {
    documents: loaded.map((item) => item.document),
    files: loaded.map((item) => item.file),
  }
}
