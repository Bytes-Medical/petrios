'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import {
  isDepartmentModerator,
  requireAuth,
  requireDepartmentModerator,
  requireOrg,
} from '@/lib/auth'
import {
  canActorDeleteSessionDocument,
  documentExtensionForMime,
  safeDocumentFilename,
  validateDocumentMetadata,
} from '@/lib/session-documents'
import { inspectDocumentStream } from '@/lib/session-documents-inspection'
import * as sessionsDb from '@/lib/db/sessions'
import * as documentsDb from '@/lib/db/session-documents'
import { DbNotFoundError } from '@/lib/db'

async function requireDocumentUploadAccess(sessionId: string) {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) throw new DbNotFoundError('Session not found')

  const [moderator, assignment] = await Promise.all([
    isDepartmentModerator(session.department_id),
    sessionsDb.findSessionTeacher(sessionId, userId, orgId),
  ])
  if (!moderator && assignment?.status !== 'ACCEPTED') {
    throw new Error('Only session moderators and accepted teachers can upload documents')
  }
  return { userId, orgId, session }
}

export async function canUploadSessionDocuments(sessionId: string): Promise<boolean> {
  try {
    await requireDocumentUploadAccess(sessionId)
    return true
  } catch {
    return false
  }
}

export async function getSessionDocuments(sessionId: string, includeArchived = false) {
  const orgId = await requireOrg()
  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) throw new DbNotFoundError('Session not found')
  if (includeArchived) await requireDepartmentModerator(session.department_id)
  return documentsDb.listSessionDocumentsAsSystem(sessionId, includeArchived)
}

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : 'Document validation or storage failed'
}

// Upload bytes go browser -> Storage directly; the app server never buffers them (spec/04).
export async function prepareSessionDocumentUpload(
  sessionId: string,
  file: { filename: string; mimeType: string; byteSize: number }
): Promise<{ documentId: string; uploadUrl: string }> {
  const { userId, orgId, session } = await requireDocumentUploadAccess(sessionId)
  if (typeof file?.filename !== 'string' || typeof file.mimeType !== 'string') {
    throw new Error('Choose a document to upload')
  }
  const metadata = validateDocumentMetadata({
    filename: file.filename,
    mimeType: file.mimeType,
    byteSize: file.byteSize,
  })

  const id = randomUUID()
  const storagePath = `${orgId}/${sessionId}/${id}.${metadata.extension}`
  await documentsDb.insertUploadingDocument({
    id,
    orgId,
    departmentId: session.department_id,
    sessionId,
    storagePath,
    filename: metadata.filename,
    displayName: safeDocumentFilename(metadata.filename),
    mimeType: metadata.mimeType,
    byteSize: file.byteSize,
    uploadedBy: userId,
  })

  try {
    return { documentId: id, uploadUrl: await documentsDb.createDocumentUploadUrl(storagePath) }
  } catch (error) {
    await documentsDb
      .rejectUploadingDocument({ id, storagePath, reason: failureReason(error) })
      .catch(() => {})
    throw error
  }
}

export async function finalizeSessionDocumentUpload(sessionId: string, documentId: string): Promise<void> {
  const { userId, orgId, session } = await requireDocumentUploadAccess(sessionId)
  const document = await documentsDb.findUploadingDocumentAsSystem({
    id: documentId,
    orgId,
    sessionId,
    uploadedBy: userId,
  })
  if (!document) throw new DbNotFoundError('Document not found')

  let available = false
  try {
    const object = await documentsDb.fetchDocumentObject(document.storage_path)
    const { sha256 } = await inspectDocumentStream(object.body, {
      extension: documentExtensionForMime(document.mime_type),
      expectedSize: document.byte_size,
    })
    await documentsDb.markDocumentAvailable({ id: document.id, sha256 })
    available = true
    await documentsDb.recordDocumentActivityAsSystem({
      orgId,
      departmentId: session.department_id,
      sessionId,
      actorUserId: userId,
      eventType: 'SESSION_DOCUMENT_UPLOADED',
      documentId: document.id,
      filename: document.original_filename,
    })
  } catch (error) {
    const reject = available ? documentsDb.rejectDocument : documentsDb.rejectUploadingDocument
    await reject({ id: document.id, storagePath: document.storage_path, reason: failureReason(error) }).catch(
      () => {}
    )
    throw error
  }

  revalidatePath(`/sessions/${sessionId}`)
  revalidatePath(`/sessions/${sessionId}/manage`)
}

export async function cancelSessionDocumentUpload(sessionId: string, documentId: string): Promise<void> {
  const { userId, orgId } = await requireDocumentUploadAccess(sessionId)
  const document = await documentsDb.findUploadingDocumentAsSystem({
    id: documentId,
    orgId,
    sessionId,
    uploadedBy: userId,
  })
  if (!document) return
  await documentsDb.rejectUploadingDocument({
    id: document.id,
    storagePath: document.storage_path,
    reason: 'The browser upload did not complete',
  })
}

export async function archiveSessionDocument(sessionId: string, documentId: string) {
  const actorUserId = await requireAuth()
  const orgId = await requireOrg()
  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) throw new DbNotFoundError('Session not found')
  await requireDepartmentModerator(session.department_id)
  const document = await documentsDb.findSessionDocumentAsSystem({ id: documentId, orgId, sessionId })
  if (!document) throw new DbNotFoundError('Document not found')
  await documentsDb.archiveSessionDocument({ id: documentId, orgId, sessionId, actorUserId })
  await documentsDb.recordDocumentActivityAsSystem({
    orgId,
    departmentId: session.department_id,
    sessionId,
    actorUserId,
    eventType: 'SESSION_DOCUMENT_ARCHIVED',
    documentId,
    filename: document.display_name,
  })
  revalidatePath(`/sessions/${sessionId}`)
  revalidatePath(`/sessions/${sessionId}/manage`)
}

export async function deleteSessionDocument(sessionId: string, documentId: string) {
  const actorUserId = await requireAuth()
  const orgId = await requireOrg()
  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) throw new DbNotFoundError('Session not found')

  const [moderator, document] = await Promise.all([
    isDepartmentModerator(session.department_id),
    documentsDb.findManagedSessionDocumentAsSystem({ id: documentId, orgId, sessionId }),
  ])
  if (!document) throw new DbNotFoundError('Document not found')
  if (
    !canActorDeleteSessionDocument({
      actorUserId,
      uploadedBy: document.uploaded_by,
      isModerator: moderator,
    })
  ) {
    throw new Error('Only a moderator or the document uploader can delete this document')
  }

  // Remove bytes first. If metadata deletion then fails, the retained row makes
  // the failure visible and a retry can complete the operation without leaving
  // an inaccessible storage orphan.
  await documentsDb.deleteDocumentObject(document.storage_path)
  await documentsDb.deleteSessionDocumentRecord({ id: documentId, orgId, sessionId })

  // Session activity is an operational projection, not the deletion
  // transaction. A log failure must not misreport a completed deletion as
  // though the private object still exists.
  await documentsDb
    .recordDocumentActivityAsSystem({
      orgId,
      departmentId: session.department_id,
      sessionId,
      actorUserId,
      eventType: 'SESSION_DOCUMENT_DELETED',
      documentId,
      filename: document.display_name,
    })
    .catch((activityError) => {
      console.error('Document deleted but activity recording failed:', activityError)
    })

  revalidatePath(`/sessions/${sessionId}`)
  revalidatePath(`/sessions/${sessionId}/manage`)
  return { deleted: true }
}
