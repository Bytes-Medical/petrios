import { sessionMeetingUrl } from '@/lib/jitsi'
import type { MeetingAudience, MeetingConfig } from '@/lib/meeting/types'
import type { LocationType } from '@/lib/types'

export interface ReminderLinkSession {
  id: string
  location_type: LocationType | string
  teams_meeting_url: string | null
}

export interface ReminderLinkRecipient {
  /**
   * The ACCEPTED external-teacher invitation code, or null for a registered
   * member. The code is the external teacher's only way into Petrios (they
   * cannot open /sessions/<id>), so it selects their RSVP page instead.
   */
  inviteCode: string | null
}

export interface ReminderLinks {
  /** "Join link" row; null when there is nothing to join (in person, Teams without a link). */
  meetingUrl: string | null
  /** "View Session" button: the session page for members, the RSVP page for external teachers. */
  sessionUrl: string
}

/** The audience a reminder recipient receives links for. */
export function reminderAudience(recipient: ReminderLinkRecipient): MeetingAudience {
  return recipient.inviteCode
    ? { kind: 'external_teacher', inviteCode: recipient.inviteCode }
    : { kind: 'member' }
}

/**
 * Links for one session-reminder email (spec/04 "Session reminders").
 *
 * `meetingUrl` comes from the single resolver `sessionMeetingUrl`, so token-
 * protected rooms (JaaS, self-hosted JWT) send members to the session page and
 * external teachers to their RSVP page, where each can obtain a room pass; a
 * raw room URL would be useless without one. `sessionUrl` sends an external
 * teacher to the RSVP page too, because anonymous visitors cannot read
 * /sessions/<id>.
 */
export function reminderLinksFor(
  session: ReminderLinkSession,
  recipient: ReminderLinkRecipient,
  appUrl: string,
  config?: MeetingConfig,
): ReminderLinks {
  const sessionUrl = recipient.inviteCode
    ? `${appUrl}/sessions/${session.id}/teacher-rsvp/${encodeURIComponent(recipient.inviteCode)}`
    : `${appUrl}/sessions/${session.id}`
  return {
    meetingUrl: sessionMeetingUrl(session, reminderAudience(recipient), config),
    sessionUrl,
  }
}
