/**
 * Browser half of the direct-to-Storage upload. Mirrors storage-js
 * `uploadToSignedUrl` for a File body (PUT, multipart with `cacheControl` and
 * an unnamed file part, `x-upsert: false`) so components need no Supabase
 * client. The signed token in `uploadUrl` is the authorization; the anon key
 * only satisfies API gateways that expect it.
 */
export function signedDocumentUploadRequest(input: {
  uploadUrl: string
  anonKey: string
  file: Blob
}): { url: string; init: RequestInit } {
  const body = new FormData()
  body.append('cacheControl', '3600')
  body.append('', input.file)
  return {
    url: input.uploadUrl,
    init: {
      method: 'PUT',
      headers: {
        apikey: input.anonKey,
        Authorization: `Bearer ${input.anonKey}`,
        'x-upsert': 'false',
      },
      body,
    },
  }
}

export async function uploadToSignedDocumentUrl(
  input: { uploadUrl: string; anonKey: string; file: Blob },
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const { url, init } = signedDocumentUploadRequest(input)
  const response = await fetchImpl(url, init).catch(() => null)
  if (!response?.ok) throw new Error('Failed to store session document')
}
