import { describe, expect, it, vi } from 'vitest'
import { signedDocumentUploadRequest, uploadToSignedDocumentUrl } from './session-documents-upload'

const uploadUrl =
  'https://project.supabase.co/storage/v1/object/upload/sign/session-documents/org/session/doc.pdf?token=t'

describe('signed session document upload', () => {
  it('builds the same request as storage-js uploadToSignedUrl for a File', () => {
    const file = new File(['%PDF-1.7'], 'notes.pdf', { type: 'application/pdf' })
    const { url, init } = signedDocumentUploadRequest({ uploadUrl, anonKey: 'anon', file })

    expect(url).toBe(uploadUrl)
    expect(init.method).toBe('PUT')
    expect(init.headers).toEqual({ apikey: 'anon', Authorization: 'Bearer anon', 'x-upsert': 'false' })
    const body = init.body as FormData
    expect(body.get('cacheControl')).toBe('3600')
    const part = body.get('') as File
    expect(part.type).toBe('application/pdf')
    expect(part.size).toBe(file.size)
  })

  it('resolves on a successful storage response', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"Key":"x"}', { status: 200 }))
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    await expect(uploadToSignedDocumentUrl({ uploadUrl, anonKey: 'anon', file }, fetchImpl)).resolves.toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledWith(uploadUrl, expect.objectContaining({ method: 'PUT' }))
  })

  it('reports storage rejections and network failures with the storage-failure message', async () => {
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    const rejected = vi.fn(async () => new Response('{"message":"too large"}', { status: 413 }))
    await expect(uploadToSignedDocumentUrl({ uploadUrl, anonKey: 'anon', file }, rejected)).rejects.toThrow(
      'Failed to store session document'
    )
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(uploadToSignedDocumentUrl({ uploadUrl, anonKey: 'anon', file }, offline)).rejects.toThrow(
      'Failed to store session document'
    )
  })
})
