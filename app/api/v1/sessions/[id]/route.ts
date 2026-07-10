import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiRequest, apiError } from '@/lib/api/auth'
import { serializeSession } from '@/lib/api/serializers'
import * as apiReads from '@/lib/db/api-reads'

export const dynamic = 'force-dynamic'

/** GET /api/v1/sessions/[id] */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(request, 'read:sessions')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const session = await apiReads.findSessionForApi(auth.orgId, id)
  if (!session) return apiError(404, 'not_found', 'Session not found')

  return NextResponse.json({ data: serializeSession(session) })
}
