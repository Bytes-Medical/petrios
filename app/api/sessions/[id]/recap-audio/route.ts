import { NextResponse } from 'next/server'
import { getCurrentOrgId, getCurrentUser, isDepartmentModerator } from '@/lib/auth'
import { opsEnabled } from '@/lib/ops/flags'
import * as audioRecapsDb from '@/lib/db/audio-recaps'
import * as sessionsDb from '@/lib/db/sessions'

export const dynamic = 'force-dynamic'

/**
 * Streams a session's audio recap MP3. Org members can hear APPROVED
 * recaps; drafts are audible only to the session's department moderators
 * (the pre-approval listen). 404 everywhere ops is disabled.
 */
export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  if (!opsEnabled()) {
    return new NextResponse('Not found', { status: 404 })
  }

  const params = await props.params
  const user = await getCurrentUser()
  const orgId = user ? await getCurrentOrgId() : null
  if (!user || !orgId) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const session = await sessionsDb.findSession(params.id, orgId)
  if (!session) {
    return new NextResponse('Not found', { status: 404 })
  }

  const recap = await audioRecapsDb.findRecapAudio(params.id)
  if (!recap) {
    return new NextResponse('Not found', { status: 404 })
  }

  if (recap.status !== 'approved') {
    const canPreview = await isDepartmentModerator(session.department_id)
    if (!canPreview) {
      return new NextResponse('Not found', { status: 404 })
    }
  }

  return new NextResponse(new Uint8Array(recap.audio), {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(recap.audio.byteLength),
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
