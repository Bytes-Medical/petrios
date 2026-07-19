'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  archiveSessionDocument,
  deleteSessionDocument,
  uploadSessionDocument,
} from '@/app/actions/session-documents'
import type { SessionDocument } from '@/lib/db/session-documents'
import { Button } from './Button'

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export function SessionDocumentsPanel({
  sessionId,
  documents,
  canUpload,
  canManage = false,
  currentUserId,
}: {
  sessionId: string
  documents: SessionDocument[]
  canUpload: boolean
  canManage?: boolean
  currentUserId: string
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUpload(formData: FormData) {
    setBusy(true)
    setError(null)
    try {
      await uploadSessionDocument(sessionId, formData)
      formRef.current?.reset()
      router.refresh()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleArchive(documentId: string) {
    if (!window.confirm('Archive this document? Existing links will stop working.')) return
    setBusy(true)
    setError(null)
    try {
      await archiveSessionDocument(sessionId, documentId)
      router.refresh()
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Archive failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(documentId: string, displayName: string) {
    if (
      !window.confirm(
        `Permanently delete "${displayName}"? The stored file will be removed and this cannot be undone.`
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await deleteSessionDocument(sessionId, documentId)
      router.refresh()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {canUpload && (
        <form ref={formRef} action={handleUpload} className="space-y-3 border border-gray-300 p-4">
          <div>
            <label htmlFor="session-document" className="font-mono text-sm font-bold">
              Upload a session document
            </label>
            <p className="mt-1 font-mono text-xs text-gray-600">
              PDF, DOCX, or PPTX only; maximum 25 MiB. Macro-enabled and legacy Office files are rejected.
            </p>
            <p className="mt-1 font-mono text-xs text-gray-600">
              Available documents become the learning sources for Audio Recap. They are sent to the
              configured AI provider only when a moderator deliberately generates or regenerates a recap.
              The provider may derive queries from them for restricted authoritative-source research;
              the documents remain the recap&apos;s primary focus.
            </p>
          </div>
          <input
            id="session-document"
            name="file"
            type="file"
            required
            accept=".pdf,.docx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="block w-full border border-black bg-white p-2 font-mono text-sm"
          />
          <Button type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Upload document'}</Button>
        </form>
      )}

      {error && (
        <p className="border border-red-700 bg-red-50 px-3 py-2 font-mono text-sm text-red-700">{error}</p>
      )}

      {documents.length === 0 ? (
        <p className="font-mono text-sm text-gray-600">No session documents have been uploaded.</p>
      ) : (
        <ul className="space-y-2">
          {documents.map((document) => {
            const isPdf = document.mime_type === 'application/pdf'
            const archived = document.status === 'ARCHIVED'
            const canDelete = canManage || document.uploaded_by === currentUserId
            const base = `/api/sessions/${sessionId}/documents/${document.id}`
            return (
              <li key={document.id} className="flex flex-col gap-3 border border-gray-300 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words font-mono text-sm font-bold">{document.display_name}</p>
                  <p className="font-mono text-xs text-gray-600">
                    {formatBytes(document.byte_size)} · uploaded {new Date(document.created_at).toLocaleString('en-GB')}
                    {archived ? ' · archived' : ''}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-gray-500">
                    {document.validation_status === 'BASIC_VALIDATED'
                      ? 'Type and package structure validated; treat downloaded Office content as untrusted.'
                      : document.validation_status}
                  </p>
                </div>
                {(!archived || canDelete) && (
                  <div className="flex flex-wrap gap-2">
                    {!archived && isPdf && (
                      <a href={`${base}?view=1`} target="_blank" rel="noopener noreferrer" className="border border-black px-3 py-1.5 font-mono text-xs hover:bg-gray-50">
                        View
                      </a>
                    )}
                    {!archived && (
                      <a href={base} className="border border-black px-3 py-1.5 font-mono text-xs hover:bg-gray-50">
                        Download
                      </a>
                    )}
                    {!archived && canManage && (
                      <button type="button" disabled={busy} onClick={() => handleArchive(document.id)} className="border border-red-700 px-3 py-1.5 font-mono text-xs text-red-700 disabled:opacity-50">
                        Archive
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDelete(document.id, document.display_name)}
                        className="border border-red-700 bg-red-700 px-3 py-1.5 font-mono text-xs text-white hover:bg-red-800 disabled:opacity-50"
                      >
                        Delete permanently
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
