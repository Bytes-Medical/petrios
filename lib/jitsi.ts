import 'server-only'
import { getAppUrl } from '@/lib/app-url'
import { getMeetingConfig } from '@/lib/meeting/config'
import { meetingRoomSlug, storedMeetingUrl } from '@/lib/meeting/location'
import type { MeetingAudience, MeetingConfig } from '@/lib/meeting/types'
import type { LocationType } from '@/lib/types'

/**
 * Petrios Meet room naming and THE outbound join-link resolver. Server-only:
 * the meeting mode depends on server environment (lib/meeting/config.ts).
 * Client components use lib/meeting/location.ts instead.
 *
 * Rooms are derived from the session id (a UUID), never stored. Outbound
 * links always point at the Petrios page for the reader (the session page for
 * members, the RSVP page for external teachers), in every meeting mode; the
 * raw room URL (meetingGuestUrl) is only for moderators to share with guests
 * where a room works without a pass.
 */

export type MeetingLinkAudience = MeetingAudience

/** 'Petrios-<uuid>': the room within the meeting service. */
export function jitsiRoomName(sessionId: string): string {
  return meetingRoomSlug(sessionId)
}

/** The roomName the embed joins: JaaS rooms are '<appId>/Petrios-<uuid>'. */
export function meetingRoomName(
  sessionId: string,
  config: Extract<MeetingConfig, { ok: true }>
): string {
  const room = jitsiRoomName(sessionId)
  return config.mode === 'jaas' ? `${config.appId}/${room}` : room
}

/**
 * Raw room URL usable WITHOUT a room pass: public mode
 * (https://meet.jit.si/Petrios-<uuid>) or an open self-hosted room. Null in
 * token modes and when meetings are unavailable.
 */
export function meetingGuestUrl(
  sessionId: string,
  config: MeetingConfig = getMeetingConfig()
): string | null {
  if (!config.ok || config.tokenAuth !== 'none') return null
  return `${config.origin}/${jitsiRoomName(sessionId)}`
}

let appUrlErrorLogged = false

/** The public app URL, or null (logged once) when it cannot be resolved. */
function appUrlOrNull(): string | null {
  try {
    return getAppUrl()
  } catch (error) {
    if (!appUrlErrorLogged) {
      appUrlErrorLogged = true
      console.error(
        '[petrios-meet] no public app URL is configured (set APP_URL or NEXT_PUBLIC_APP_URL); video room links fall back:',
        error instanceof Error ? error.message : 'unknown error'
      )
    }
    return null
  }
}

/** Test hook: forget that the missing-app-URL error was logged. */
export function resetMeetingLinkLogForTests(): void {
  appUrlErrorLogged = false
}

/**
 * The join URL for a session, for one audience: the single resolver used by
 * every outbound surface (ICS feed, reminder emails, teacher emails, RSVP
 * page, API serializer). Null when there is nothing to join.
 *
 *   location           mode                         member               external_teacher
 *   MS_TEAMS / HYBRID  any                          stored Teams link    same
 *   IN_PERSON          any                          null                 null
 *   JITSI              public / open self-hosted    APP_URL/sessions/id  raw room URL
 *   JITSI              jaas / hs256 / unavailable   APP_URL/sessions/id  RSVP page URL
 *
 * Members always go through the session page, in EVERY mode: it mints the
 * room pass (token modes), explains the meet.jit.si new tab and its
 * first-arrival sign-in (public mode), and attempts their self check-in; a
 * raw room URL would skip all of that. Signed-out members keep the link
 * through sign-in (proxy.ts `next`). External teachers have no check-in and
 * cannot read the session page, so they get the raw room where it works
 * without a pass, and their RSVP page (which mints one) otherwise.
 *
 * Never throws. Without a resolvable public app URL (a self-hosted install
 * missing APP_URL in production) it logs once and falls back to the raw room
 * URL where one works without a pass, otherwise null, so one JITSI session
 * cannot break the ICS feed, the API or an email batch.
 */
export function sessionMeetingUrl(
  session: { id: string; location_type: LocationType | string; teams_meeting_url: string | null },
  audience: MeetingLinkAudience,
  config: MeetingConfig = getMeetingConfig()
): string | null {
  if (session.location_type !== 'JITSI') return storedMeetingUrl(session)

  const guestUrl = meetingGuestUrl(session.id, config)
  if (audience.kind === 'external_teacher' && guestUrl) return guestUrl

  const appUrl = appUrlOrNull()
  if (!appUrl) return guestUrl

  const sessionPage = `${appUrl}/sessions/${encodeURIComponent(session.id)}`
  if (audience.kind === 'external_teacher') {
    return `${sessionPage}/teacher-rsvp/${encodeURIComponent(audience.inviteCode)}`
  }
  return sessionPage
}
