import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireOrg } from '@/lib/auth'
import * as sessionsDb from '@/lib/db/sessions'
import * as documentsDb from '@/lib/db/session-documents'

function contentDisposition(filename: string, inline: boolean): string {
  const fallback = filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'document'
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string; documentId: string }> }
) {
  try {
    await requireAuth()
    const orgId = await requireOrg()
    const params = await props.params
    const session = await sessionsDb.findSession(params.id, orgId)
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    const document = await documentsDb.findSessionDocumentAsSystem({
      id: params.documentId,
      orgId,
      sessionId: params.id,
    })
    if (!document) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

    const object = await documentsDb.downloadDocumentObject(document.storage_path)
    const bytes = await object.arrayBuffer()
    const inline = request.nextUrl.searchParams.get('view') === '1' && document.mime_type === 'application/pdf'
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': document.mime_type,
        'Content-Length': String(document.byte_size),
        'Content-Disposition': contentDisposition(document.display_name, inline),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Document download failed' },
      { status: 500 }
    )
  }
}
