import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiRequest, apiError } from '@/lib/api/auth'
import { serializeSession } from '@/lib/api/serializers'
import { assertSessionCanBePublished } from '@/lib/session-validation'
import { emitWebhook } from '@/lib/webhooks'
import * as apiReads from '@/lib/db/api-reads'

export const dynamic = 'force-dynamic'

/** POST /api/v1/sessions/[id]/publish (write:sessions) */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(request, 'write:sessions')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const session = await apiReads.findSessionForApi(auth.orgId, id)
  if (!session) return apiError(404, 'not_found', 'Session not found')
  if (session.status === 'PUBLISHED') {
    return NextResponse.json({ data: serializeSession(session) })
  }

  try {
    assertSessionCanBePublished(session.date_end)
  } catch (err) {
    return apiError(400, 'publish_blocked', err instanceof Error ? err.message : 'Cannot publish')
  }

  const published = await apiReads.publishSessionForApi(auth.orgId, id)
  void emitWebhook(auth.orgId, 'session.published', {
    session_id: published.id,
    title: published.title,
    department_id: published.department_id,
    date_start: published.date_start,
    date_end: published.date_end,
  })

  return NextResponse.json({ data: serializeSession(published) })
}
