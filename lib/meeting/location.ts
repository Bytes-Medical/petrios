/**
 * Client-safe meeting-location helpers. No environment access and no
 * secrets, so client components (SessionCalendar, ManageSessionTabs) may
 * import this module. The audience- and mode-aware join URL resolver is
 * server-only: `sessionMeetingUrl` in lib/jitsi.ts.
 */

/** Prefix of every Petrios Meet room. Rooms are derived, never stored. */
export const MEETING_ROOM_PREFIX = 'Petrios-'

/** The Jitsi room for a session: 'Petrios-<session uuid>'. */
export function meetingRoomSlug(sessionId: string): string {
  return `${MEETING_ROOM_PREFIX}${sessionId}`
}

interface LocatedSession {
  location_type: string
  teams_meeting_url: string | null
}

/** Stored Teams link for MS_TEAMS/HYBRID; null otherwise (never the Jitsi room). */
export function storedMeetingUrl(session: LocatedSession): string | null {
  if (session.location_type === 'MS_TEAMS' || session.location_type === 'HYBRID') {
    return session.teams_meeting_url || null
  }
  return null
}

/** True when the session has an online join path (JITSI, or a stored Teams link). */
export function sessionHasOnlineJoin(session: LocatedSession): boolean {
  return session.location_type === 'JITSI' || storedMeetingUrl(session) !== null
}
