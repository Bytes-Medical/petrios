import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiRequest, apiError } from '@/lib/api/auth'
import { serializeSession } from '@/lib/api/serializers'
import { assertValidSessionDates } from '@/lib/session-validation'
import { LOCATION_TYPE_LABELS } from '@/lib/types'
import * as apiReads from '@/lib/db/api-reads'

export const dynamic = 'force-dynamic'

/** GET /api/v1/sessions?from=&to=&department_id=&status= */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request, 'read:sessions')
  if (auth instanceof NextResponse) return auth

  const params = request.nextUrl.searchParams
  const sessions = await apiReads.listSessionsForApi(auth.orgId, {
    fromIso: params.get('from') ?? undefined,
    toIso: params.get('to') ?? undefined,
    departmentId: params.get('department_id') ?? undefined,
    status: params.get('status') ?? undefined,
  })

  return NextResponse.json({ data: sessions.map(serializeSession) })
}

/** POST /api/v1/sessions — creates a DRAFT session (write:sessions). */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request, 'write:sessions')
  if (auth instanceof NextResponse) return auth

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return apiError(400, 'invalid_body', 'Request body must be JSON')
  }

  const { department_id, title, description, date_start, date_end, location_type } = body as {
    department_id?: string
    title?: string
    description?: string
    date_start?: string
    date_end?: string
    location_type?: string
  }

  if (!department_id || !title || !date_start || !date_end || !location_type) {
    return apiError(
      400,
      'missing_fields',
      'department_id, title, date_start, date_end, and location_type are required'
    )
  }
  if (!(location_type in LOCATION_TYPE_LABELS)) {
    return apiError(400, 'invalid_location_type', `location_type must be one of ${Object.keys(LOCATION_TYPE_LABELS).join(', ')}`)
  }
  try {
    assertValidSessionDates(date_start, date_end)
  } catch (err) {
    return apiError(400, 'invalid_dates', err instanceof Error ? err.message : 'Invalid dates')
  }

  try {
    const session = await apiReads.insertDraftSessionForApi({
      orgId: auth.orgId,
      departmentId: department_id,
      title: String(title).slice(0, 300),
      description: description ? String(description).slice(0, 5000) : null,
      dateStart: date_start,
      dateEnd: date_end,
      locationType: location_type,
    })
    return NextResponse.json({ data: serializeSession(session) }, { status: 201 })
  } catch (err) {
    return apiError(400, 'create_failed', err instanceof Error ? err.message : 'Create failed')
  }
}
