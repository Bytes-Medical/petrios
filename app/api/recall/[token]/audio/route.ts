import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { verifyRecallToken } from '@/lib/recall'
import * as recallDb from '@/lib/db/recall'
import * as audioRecapsDb from '@/lib/db/audio-recaps'

export const dynamic = 'force-dynamic'

/** Authenticated, identity-bound stream for an approved catch-up package. */
export async function GET(
  _request: Request,
  props: { params: Promise<{ token: string }> }
) {
  const { token } = await props.params
  const verified = verifyRecallToken(token)
  const user = await getCurrentUser()
  if (!verified || !user || user.id !== verified.userId) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const [set, recap] = await Promise.all([
    recallDb.findSetForSession(verified.sessionId),
    audioRecapsDb.findRecapForSession(verified.sessionId),
  ])
  if (
    !set ||
    set.status !== 'approved' ||
    !set.script_digest ||
    !recap ||
    recap.status !== 'approved' ||
    recap.script_digest !== set.script_digest
  ) {
    return new NextResponse('Not found', { status: 404 })
  }

  const audio = await audioRecapsDb.openRecapAudioStream({
    sessionId: verified.sessionId,
    status: 'approved',
    audioRevision: recap.audio_revision,
  })
  if (!audio) {
    return new NextResponse('Not found', { status: 404 })
  }

  const headers: Record<string, string> = {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'private, no-store',
  }
  if (recap.audio_bytes !== null) headers['Content-Length'] = String(recap.audio_bytes)
  return new NextResponse(audio, { headers })
}
