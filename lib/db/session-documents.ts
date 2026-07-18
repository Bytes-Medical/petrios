import type { SessionDocumentMime } from '@/lib/session-documents'
import { getServiceDb } from './client'
import { toDbError } from './errors'

export interface SessionDocument {
  id: string
  org_id: string
  department_id: string
  session_id: string
  storage_path: string
  original_filename: string
  display_name: string
  mime_type: SessionDocumentMime
  byte_size: number
  sha256: string | null
  status: 'UPLOADING' | 'AVAILABLE' | 'REJECTED' | 'ARCHIVED'
  validation_status: 'PENDING' | 'BASIC_VALIDATED' | 'REJECTED'
  validation_error: string | null
  uploaded_by: string
  created_at: string
  archived_at: string | null
}

export async function insertUploadingDocument(input: {
  id: string
  orgId: string
  departmentId: string
  sessionId: string
  storagePath: string
  filename: string
  displayName: string
  mimeType: SessionDocumentMime
  byteSize: number
  uploadedBy: string
}): Promise<SessionDocument> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_documents')
    .insert({
      id: input.id,
      org_id: input.orgId,
      department_id: input.departmentId,
      session_id: input.sessionId,
      storage_path: input.storagePath,
      original_filename: input.filename,
      display_name: input.displayName,
      mime_type: input.mimeType,
      byte_size: input.byteSize,
      uploaded_by: input.uploadedBy,
    })
    .select('*')
    .single()
  if (error) throw toDbError('Failed to create session document', error)
  return data as SessionDocument
}

export async function uploadDocumentObject(input: {
  storagePath: string
  bytes: Uint8Array
  mimeType: SessionDocumentMime
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.storage
    .from('session-documents')
    .upload(input.storagePath, input.bytes, { contentType: input.mimeType, upsert: false })
  if (error) throw toDbError('Failed to store session document', error)
}

export async function markDocumentAvailable(input: {
  id: string
  sha256: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('session_documents')
    .update({
      sha256: input.sha256,
      status: 'AVAILABLE',
      validation_status: 'BASIC_VALIDATED',
      validation_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.id)
    .eq('status', 'UPLOADING')
    .select('id')
    .single()
  if (error) throw toDbError('Failed to finalize session document', error)
}

export async function rejectDocument(input: { id: string; storagePath: string; reason: string }): Promise<void> {
  const db = await getServiceDb()
  const { error: cleanupError } = await db.storage.from('session-documents').remove([input.storagePath])
  const { error } = await db
    .from('session_documents')
    .update({ status: 'REJECTED', validation_status: 'REJECTED', validation_error: input.reason.slice(0, 500) })
    .eq('id', input.id)
  if (error) throw toDbError('Failed to reject session document', error)
  if (cleanupError && !cleanupError.message.toLowerCase().includes('not found')) {
    throw toDbError('Document was rejected but object cleanup failed', cleanupError)
  }
}

export async function listSessionDocumentsAsSystem(
  sessionId: string,
  includeArchived = false
): Promise<SessionDocument[]> {
  const db = await getServiceDb()
  let query = db.from('session_documents').select('*').eq('session_id', sessionId)
  query = includeArchived ? query.in('status', ['AVAILABLE', 'ARCHIVED']) : query.eq('status', 'AVAILABLE')
  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) throw toDbError('Failed to list session documents', error)
  return (data as SessionDocument[] | null) ?? []
}

export async function findSessionDocumentAsSystem(input: {
  id: string
  orgId: string
  sessionId: string
}): Promise<SessionDocument | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_documents')
    .select('*')
    .eq('id', input.id)
    .eq('org_id', input.orgId)
    .eq('session_id', input.sessionId)
    .eq('status', 'AVAILABLE')
    .maybeSingle()
  if (error) throw toDbError('Failed to find session document', error)
  return data as SessionDocument | null
}

export async function findManagedSessionDocumentAsSystem(input: {
  id: string
  orgId: string
  sessionId: string
}): Promise<SessionDocument | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_documents')
    .select('*')
    .eq('id', input.id)
    .eq('org_id', input.orgId)
    .eq('session_id', input.sessionId)
    .in('status', ['AVAILABLE', 'ARCHIVED'])
    .maybeSingle()
  if (error) throw toDbError('Failed to find managed session document', error)
  return data as SessionDocument | null
}

export async function downloadDocumentObject(storagePath: string): Promise<Blob> {
  const db = await getServiceDb()
  const { data, error } = await db.storage.from('session-documents').download(storagePath)
  if (error || !data) throw toDbError('Failed to download session document', error ?? new Error('Object missing'))
  return data
}

export async function archiveSessionDocument(input: {
  id: string
  orgId: string
  sessionId: string
  actorUserId: string
}): Promise<void> {
  const db = await getServiceDb()
  const now = new Date().toISOString()
  const { error } = await db
    .from('session_documents')
    .update({ status: 'ARCHIVED', archived_at: now, archived_by: input.actorUserId, updated_at: now })
    .eq('id', input.id)
    .eq('org_id', input.orgId)
    .eq('session_id', input.sessionId)
    .eq('status', 'AVAILABLE')
    .select('id')
    .single()
  if (error) throw toDbError('Failed to archive session document', error)
}

export async function deleteDocumentObject(storagePath: string): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.storage.from('session-documents').remove([storagePath])
  if (error && !error.message.toLowerCase().includes('not found')) {
    throw toDbError('Failed to delete stored session document', error)
  }
}

export async function deleteSessionDocumentRecord(input: {
  id: string
  orgId: string
  sessionId: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('session_documents')
    .delete()
    .eq('id', input.id)
    .eq('org_id', input.orgId)
    .eq('session_id', input.sessionId)
    .in('status', ['AVAILABLE', 'ARCHIVED'])
    .select('id')
    .single()
  if (error) throw toDbError('Failed to delete session document record', error)
}

export async function recordDocumentActivityAsSystem(input: {
  orgId: string
  departmentId: string
  sessionId: string
  actorUserId: string
  eventType:
    | 'SESSION_DOCUMENT_UPLOADED'
    | 'SESSION_DOCUMENT_ARCHIVED'
    | 'SESSION_DOCUMENT_DELETED'
  documentId: string
  filename: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('session_activity_events').insert({
    org_id: input.orgId,
    department_id: input.departmentId,
    session_id: input.sessionId,
    actor_user_id: input.actorUserId,
    event_type: input.eventType,
    details: { document_id: input.documentId, filename: input.filename },
  })
  if (error) throw toDbError('Failed to record document activity', error)
}
