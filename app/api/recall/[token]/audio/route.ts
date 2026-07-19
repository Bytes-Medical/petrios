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

  const [set, recap, audio] = await Promise.all([
    recallDb.findSetForSession(verified.sessionId),
    audioRecapsDb.findRecapForSession(verified.sessionId),
    audioRecapsDb.findRecapAudio(verified.sessionId),
  ])
  if (
    !set ||
    set.status !== 'approved' ||
    !set.script_digest ||
    !recap ||
    recap.status !== 'approved' ||
    recap.script_digest !== set.script_digest ||
    !audio ||
    audio.status !== 'approved'
  ) {
    return new NextResponse('Not found', { status: 404 })
  }

  return new NextResponse(new Uint8Array(audio.audio), {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(audio.audio.byteLength),
      'Cache-Control': 'private, no-store',
    },
  })
}
