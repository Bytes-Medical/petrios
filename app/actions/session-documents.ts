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
  documentSha256,
  safeDocumentFilename,
  validateDocumentBytes,
  validateDocumentMetadata,
} from '@/lib/session-documents'
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

export async function uploadSessionDocument(sessionId: string, formData: FormData) {
  const { userId, orgId, session } = await requireDocumentUploadAccess(sessionId)
  const candidate = formData.get('file')
  if (!(candidate instanceof File)) throw new Error('Choose a document to upload')

  const metadata = validateDocumentMetadata({
    filename: candidate.name,
    mimeType: candidate.type,
    byteSize: candidate.size,
  })
  const bytes = new Uint8Array(await candidate.arrayBuffer())
  validateDocumentBytes(bytes, metadata.extension)

  const id = randomUUID()
  const storagePath = `${orgId}/${sessionId}/${id}.${metadata.extension}`
  const row = await documentsDb.insertUploadingDocument({
    id,
    orgId,
    departmentId: session.department_id,
    sessionId,
    storagePath,
    filename: metadata.filename,
    displayName: safeDocumentFilename(metadata.filename),
    mimeType: metadata.mimeType,
    byteSize: bytes.byteLength,
    uploadedBy: userId,
  })

  try {
    await documentsDb.uploadDocumentObject({ storagePath, bytes, mimeType: metadata.mimeType })
    await documentsDb.markDocumentAvailable({ id, sha256: documentSha256(bytes) })
    await documentsDb.recordDocumentActivityAsSystem({
      orgId,
      departmentId: session.department_id,
      sessionId,
      actorUserId: userId,
      eventType: 'SESSION_DOCUMENT_UPLOADED',
      documentId: id,
      filename: metadata.filename,
    })
  } catch (error) {
    await documentsDb.rejectDocument({
      id,
      storagePath,
      reason: error instanceof Error ? error.message : 'Document validation or storage failed',
    }).catch(() => {})
    throw error
  }

  revalidatePath(`/sessions/${sessionId}`)
  revalidatePath(`/sessions/${sessionId}/manage`)
  return { ...row, status: 'AVAILABLE' as const }
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
