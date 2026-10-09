/**
 * The Petrios Meet room window: the room is joinable from 30 minutes before
 * the session starts until 30 minutes after it ends. The SERVER clock is
 * authoritative (token issuance); the client uses the same rule, corrected
 * for clock skew, only to decide what to show.
 *
 * This window is independent of the SELF_CHECKIN evidence window (spec/03):
 * being able to enter the room never widens check-in.
 */

export const ROOM_OPEN_MINS_BEFORE = 30
export const ROOM_CLOSE_MINS_AFTER = 30

const MINUTE_MS = 60 * 1000

export function meetingRoomWindow(session: { date_start: string; date_end: string }): {
  opensAt: Date
  closesAt: Date
} {
  return {
    opensAt: new Date(new Date(session.date_start).getTime() - ROOM_OPEN_MINS_BEFORE * MINUTE_MS),
    closesAt: new Date(new Date(session.date_end).getTime() + ROOM_CLOSE_MINS_AFTER * MINUTE_MS),
  }
}

export type MeetingRoomPhase = 'before' | 'open' | 'ended'

/**
 * Inclusive at both ends: now === opensAt → 'open'; now === closesAt →
 * 'open'; later → 'ended'. Unparseable session dates fail closed ('ended').
 */
export function meetingRoomPhase(
  session: { date_start: string; date_end: string },
  now: Date
): MeetingRoomPhase {
  const { opensAt, closesAt } = meetingRoomWindow(session)
  const at = now.getTime()
  if (Number.isNaN(opensAt.getTime()) || Number.isNaN(closesAt.getTime()) || Number.isNaN(at)) {
    return 'ended'
  }
  if (at < opensAt.getTime()) return 'before'
  if (at > closesAt.getTime()) return 'ended'
  return 'open'
}
