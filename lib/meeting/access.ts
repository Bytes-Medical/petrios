import type { MeetingDenialReason } from './types'
import { meetingRoomPhase, meetingRoomWindow } from './window'

/**
 * Pure room-pass authorization decision. The caller has already established
 * WHO is asking (a signed-in member whose RLS read returned the session, or
 * an accepted external-teacher invitation) and whether they moderate; this
 * decides whether the room is open to them now.
 */

/** UUID (versions 1–8, RFC 9562 variant). Session ids are Postgres UUIDs. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
/** Teacher invite codes (lib/codes.ts alphabet), with headroom. */
const INVITE_CODE_PATTERN = /^[A-Za-z0-9]{4,64}$/

export function isSessionId(value: string): boolean {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function isInviteCode(value: string): boolean {
  return typeof value === 'string' && INVITE_CODE_PATTERN.test(value)
}

export const MEETING_MESSAGES: Record<MeetingDenialReason, string> = {
  not_signed_in: 'Sign in again to join the video room.',
  not_found: 'This session could not be found, or you do not have access to it.',
  invalid_invitation: 'This invitation link is invalid or has expired.',
  not_accepted: 'Accept the invitation first to open the video room.',
  not_video: 'This session does not use a Petrios Meet video room.',
  not_published: 'This session is not published yet, so its video room is closed.',
  cancelled: 'This session was cancelled, so its video room is closed.',
  too_early: 'The video room is not open yet.',
  ended: 'This session has ended, so its video room is closed.',
  not_embedded: 'Video rooms on this site open on meet.jit.si in a new tab.',
  unavailable: 'Video rooms are unavailable right now. Please contact your organiser.',
}

/** Only these denials can succeed on a later attempt without anything changing. */
const RETRYABLE: ReadonlySet<MeetingDenialReason> = new Set(['too_early', 'unavailable'])

export type MeetingDenial = {
  ok: false
  reason: MeetingDenialReason
  message: string
  retryable: boolean
  opensAt?: string
}

export function meetingDenial(reason: MeetingDenialReason, opensAt?: string): MeetingDenial {
  return {
    ok: false,
    reason,
    message: MEETING_MESSAGES[reason],
    retryable: RETRYABLE.has(reason),
    ...(opensAt ? { opensAt } : {}),
  }
}

export type MeetingAccessDecision = { ok: true; moderator: boolean; closesAt: Date } | MeetingDenial

/**
 * Check order: missing → not_found; not JITSI → not_video; CANCELLED →
 * cancelled; not PUBLISHED → not_published; before the room window →
 * too_early (with opensAt); after it → ended; otherwise open.
 */
export function decideMeetingAccess(input: {
  session: { status: string; location_type: string; date_start: string; date_end: string } | null
  now: Date
  moderator: boolean
}): MeetingAccessDecision {
  const { session, now } = input
  if (!session) return meetingDenial('not_found')
  if (session.location_type !== 'JITSI') return meetingDenial('not_video')
  if (session.status === 'CANCELLED') return meetingDenial('cancelled')
  if (session.status !== 'PUBLISHED') return meetingDenial('not_published')

  const phase = meetingRoomPhase(session, now)
  const { opensAt, closesAt } = meetingRoomWindow(session)
  if (phase === 'before') return meetingDenial('too_early', opensAt.toISOString())
  if (phase === 'ended') return meetingDenial('ended')
  return { ok: true, moderator: input.moderator, closesAt }
}
