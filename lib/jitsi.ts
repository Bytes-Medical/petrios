import type { LocationType } from '@/lib/types'

/**
 * Petrios Meet: built-in video rooms backed by Jitsi. Rooms are derived from
 * the session id (a UUID, so the URL is unguessable — the same trust model
 * as a pasted Teams link) rather than stored, which means every JITSI
 * session has a working room with zero setup.
 *
 * NEXT_PUBLIC_JITSI_DOMAIN swaps the backend without code changes:
 * unset = free meet.jit.si (note: the first participant may need to sign in
 * to Jitsi to open the room), or point it at a self-hosted Jitsi instance.
 */
export const JITSI_DOMAIN = process.env.NEXT_PUBLIC_JITSI_DOMAIN || 'meet.jit.si'

export function jitsiRoomName(sessionId: string): string {
  return `Petrios-${sessionId}`
}

export function jitsiMeetingUrl(sessionId: string): string {
  return `https://${JITSI_DOMAIN}/${jitsiRoomName(sessionId)}`
}

/**
 * The join URL for a session, whatever its location type — the single
 * resolver used by every outbound surface (ICS feed, reminder emails,
 * teacher emails, RSVP page). Null when there is nothing to join.
 */
export function sessionMeetingUrl(session: {
  id: string
  location_type: LocationType | string
  teams_meeting_url: string | null
}): string | null {
  if (session.location_type === 'JITSI') return jitsiMeetingUrl(session.id)
  if (session.location_type === 'MS_TEAMS' || session.location_type === 'HYBRID') {
    return session.teams_meeting_url
  }
  return null
}
