import type { SessionDocumentMime } from '@/lib/session-documents'
import { getPublicRuntimeConfig } from '@/lib/runtime-config'
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

/**
 * One-shot, non-upsert upload URL for an already-authorized UPLOADING row, so
 * the browser sends bytes straight to Storage instead of through the app
 * server. Service role: the private bucket has no browser object policy. The
 * URL is rebuilt on the public origin because the service client may be
 * pointed at an internal gateway the browser cannot reach.
 */
export async function createDocumentUploadUrl(storagePath: string): Promise<string> {
  const db = await getServiceDb()
  const { data, error } = await db.storage.from('session-documents').createSignedUploadUrl(storagePath)
  if (error || !data) {
    throw toDbError('Failed to prepare session document upload', error ?? new Error('No upload token'))
  }
  const objectPath = storagePath.split('/').map(encodeURIComponent).join('/')
  const url = new URL(
    `${getPublicRuntimeConfig().supabaseUrl}/storage/v1/object/upload/sign/session-documents/${objectPath}`
  )
  url.searchParams.set('token', data.token)
  return url.toString()
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

/**
 * Rejects a row only while it is still UPLOADING, then removes its object.
 * Claiming the row first means a duplicate finalize or a late cancel cannot
 * delete the object of a document another call already made AVAILABLE.
 * Service role: session_documents and the bucket are deny-all.
 */
export async function rejectUploadingDocument(input: {
  id: string
  storagePath: string
  reason: string
}): Promise<void> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_documents')
    .update({
      status: 'REJECTED',
      validation_status: 'REJECTED',
      validation_error: input.reason.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.id)
    .eq('status', 'UPLOADING')
    .select('id')
  if (error) throw toDbError('Failed to reject session document', error)
  if (!data?.length) return
  const { error: cleanupError } = await db.storage.from('session-documents').remove([input.storagePath])
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

/** The caller's own in-flight upload; service role because the table is deny-all. */
export async function findUploadingDocumentAsSystem(input: {
  id: string
  orgId: string
  sessionId: string
  uploadedBy: string
}): Promise<SessionDocument | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_documents')
    .select('*')
    .eq('id', input.id)
    .eq('org_id', input.orgId)
    .eq('session_id', input.sessionId)
    .eq('uploaded_by', input.uploadedBy)
    .eq('status', 'UPLOADING')
    .maybeSingle()
  if (error) throw toDbError('Failed to find uploading session document', error)
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

/**
 * Streaming read of a stored object. storage-js download() always buffers a
 * whole Blob, which a 128 MB Worker isolate cannot afford for 25 MiB
 * documents. Caller must consume or cancel the body.
 */
export async function fetchDocumentObject(
  storagePath: string,
  options: { signal?: AbortSignal } = {}
): Promise<Response> {
  const base = process.env.SUPABASE_INTERNAL_URL || getPublicRuntimeConfig().supabaseUrl
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const objectPath = storagePath.split('/').map(encodeURIComponent).join('/')
  const headers: Record<string, string> = { apikey: key, Authorization: `Bearer ${key}` }
  const response = await fetch(
    `${base}/storage/v1/object/authenticated/session-documents/${objectPath}`,
    { headers, cache: 'no-store', signal: options.signal }
  )
  if (!response.ok) {
    await response.body?.cancel()
    throw toDbError('Failed to read session document', new Error(`Storage responded ${response.status}`))
  }
  return response
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
